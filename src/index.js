const express = require('express');
const session = require('express-session');
const fileUpload = require('express-fileupload');
const { JSDOM } = require('jsdom');
const createPurify = require('dompurify');
const app = express();

const path = require('path');
const mobile = require('./middleware/browser');
const config = require('../config.json');
const mongoose = require('mongoose');
const docker = require('./docker');
const bythe = require('./utils');

const User = require('./Mongoose/User');
const { default: rateLimit } = require('express-rate-limit');
const fs = require('fs');

if(process.env['NODE_ENV'] == 'production') var production = true;
else var production = false;

const createAccountLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: 'You\'ve created too many accounts from this ip',
  standardHeaders: 'draft-7',
  legacyHeaders: false
});
const purifier = createPurify(new JSDOM('').window);

app.use(express.json())
  .use(express.urlencoded({ extended: true }))
  .use(fileUpload({
    useTempFiles: true,
    tempFileDir: '/tmp',
    limits: { files: 1, fileSize: 1e+9 }
  }))
  .use(session({
    secret: config.session_secret,
    resave: false, saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 12, secure: production }
  }))
  .use(require('cookie-parser')())
  .use(require('connect-flash')())
  .use(mobile)
  .engine('html', require('ejs').renderFile)
  .set('view engine', 'ejs')
  .use(express.static(path.join(__dirname, 'public')))
  .set('views', path.join(__dirname, 'views'))
  .set('trust proxy', 1)
  .get('/legal/:page', (req, res) => {
    res.render(`legal/${req.params.page}`);
  })
  .get('/', (req, res) => {
    res.render('index');
  })
  .get('/login', (req, res) => {
    res.render('login', { message: req.flash('login-message') });
  })
  .get('/register', (req, res) => {
    res.render('register', { message: req.flash('register-message') });
  })
  .get('/dashboard', check, async (req, res) => {
    const user = await User.findOne({ username: req.session.user.username });
    const dockers = ObjToMap(user.dockers);
    const statObj = [];
    if(dockers.size > 0) {
      dockers.forEach(async (data, name) => {
        if(data.id !== "") {
          const stats = await docker.stats(data.id);
          if(Number(stats.PIDs) > 0) data.running = true;
          else data.running = false;

          statObj[name] = stats;
        } else {
          statObj[name] = {
            CPUPerc: "0.00%",
            MemUsage: "0B / 0B"
          }
        }

        dockers.set(name, data);
      });

      user.dockers = MapToObj(dockers);
      await user.save();
    }
    
    res.render(res.locals.mobile ? 'mobile/dashboard' : 'desktop/dashboard', {
      user: user,
      dockers,
      stats: statObj
    });

    req.session.user = user;
  })
  .get('/read/:id', check, async (req, res) => {
    const user = await User.findOne({ username: req.session.user.username });
    user.messages = user.messages.filter(msg => {
      return msg.id !== req.params.id;
    });

    user.markModified('messages');
    await user.save();

    res.redirect('/dashboard');
  })
  .get('/addDocker', check, async (req, res) => {
    res.render(res.locals.mobile ? 'mobile/addDocker' : 'desktop/addDocker', { message: req.flash('add-docker'), user: req.session.user });
  })
  .get('/logs/:id', check, async (req, res) => {
    const name = req.params.id;
    const user = await User.findOne({ username: req.session.user.username });
    const unsanitized = await docker.getLogs(user.dockers[name].id);
    const logs = purifier.sanitize(unsanitized.join('\n')).split('\n');
    
    res.render(res.locals.mobile ? 'mobile/logs' : 'desktop/logs', { logs, username: user.username, user: req.session.user });
  })
  .get('/stats/', check, async (req, res) => {
    const user = await User.findOne({ username: req.session.user.username });
    const dockers = ObjToMap(user.dockers);
    const stats = [];

    dockers.forEach(async (data, _name) => {
      const stat = await docker.stats(data.id);
      if(stat == null) return stats.push({
        CPUPerc: "0.00%",
        MemPerc: "0.00%",
        MemUsage: "0B / 0B",
        online: data.verifying ? "verifying" : data.running
      });

      if(stat.PIDs < 1) data.running = false;
      dockers.set(_name, data);
      
      stats.push({ ...stat, online: data.verifying ? "verifying" : data.running });
    });

    user.dockers = MapToObj(dockers);
    user.markModified('dockers');
    await user.save();

    res.render(res.locals.mobile ? 'mobile/stats' : 'desktop/stats', { stats, username: user.username, user });
  })
  .get('/stream/:name/:username/:id?', async (req, res) => {
    const { name, username, id } = req.params;
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    var user = await User.findOne({ username });
    var interval;
    var i = 0;
    const statObj = {};

    switch (name) {
      case 'logs': {
        interval = setInterval(async () => {
          const unsanitized = await docker.getLogs(user.dockers[id].id);
          const logs = purifier.sanitize(unsanitized.join('\n')).split('\n');

          res.write(`data: ${JSON.stringify(purifier.sanitize(logs.join('\n')))}\n\n`);
        }, 2000);

        break;
      }
      case 'stats': {
        interval = setInterval(async () => {
          const dockers = ObjToMap(user.dockers);
          if(i > 5) {
            user = await User.findOne({ username });
            i = 0;
          }

          dockers.forEach(async (data, name) => {
            if(data.id !== "") {
              const stat = await docker.stats(data.id);
              if(Number(stat.PIDs) < 1 && data.running) data.running = false;
    
              statObj[name] = {...stat, online: data.running};
            } else {
              statObj[name] = {
                CPUPerc: "0.00%",
                MemPerc: "0.00%",
                MemUsage: "0B / 0B",
                online: data.verifying ? "verifying" : false
              }
            }
          });
    
          res.write(`data: ${JSON.stringify(statObj)}\n\n`);
          i++;
        }, 2000);

        break;
      }

      default: break;
    }

    res.on('close',() => {
      clearInterval(interval);
      user = undefined;
      interval = undefined;
      i = undefined;
      global.gc();
      res.end();
    })
  })
  .get('/start/:id', check, async (req, res) => {
    const name = req.url.split('/')[2]
    const user = await User.findOne({ username: req.session.user.username });
    const dockers = ObjToMap(user.dockers)
    if(dockers.has(name)) {
      const data = dockers.get(name);
      if(data.id !== '') {
        await docker.startDocker({ id: data.id}).then(async () => {
          data.running = true;
          dockers.set(name, data);
          user.dockers = MapToObj(dockers);
        });
      } else {
        await docker.startDocker({username: user.username, name: name}).then(async (id) => {
          data.running = true;
          data.id = id;
          dockers.set(name, data);
          user.dockers = MapToObj(dockers);
        });
      }
      
      user.markModified('dockers');
      await user.save();
    }

    res.redirect('/dashboard');
  })
  .get('/shutdown/:id', check, async (req, res) => {
    const name = req.url.split('/')[2]
    const user = await User.findOne({ username: req.session.user.username });
    await docker.shutdown(user.username, name);

    res.redirect('/dashboard');
  })
  .get('/delete/:id', check, async (req, res) => {
    const name = req.url.split('/')[2]
    const user = await User.findOne({ username: req.session.user.username });
    const dockers = ObjToMap(user.dockers);

    docker.delete(user.username, name, user.dockers[name].id);
    dockers.delete(name);

    user.dockers = MapToObj(dockers);
    user.markModified('dockers');

    await user.save();

    res.redirect('/dashboard');
  })
  .get('/remove/:name', check, async(req, res) => {
    const name = req.params.name;
    const user = await User.findOne({ username: req.session.user.username });
    const dockers = ObjToMap(user.dockers);

    docker.remove(name, user.username);

    dockers.delete(name);

    user.dockers = MapToObj(dockers);
    user.markModified('dockers');

    await user.save();

    res.redirect('/dashboard');
  })
  .get('/admin', check, async (req, res) => {
    const users = await User.find({});
    const verification = [];
    users.forEach(user => {
      const data = {
        username: user.username,
        codes: []
      }
      const map = ObjToMap(user.dockers);
      map.forEach((value, name) => {
        if(value.verifying) data.codes.push(name);
      })

      if(data.codes.length > 0) verification.push(data);
    })

    res.render('admin', {
      users: verification,
      user: req.session.user
    });
  })
  .post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if(!user) {
      req.flash('login-message', `Username / Password is incorrect`);
      return res.redirect('/login');
    }

    if(bythe(password) !== user.password) {
      req.flash('login-message', `Username / Password is incorrect`)
      return res.redirect('/login');
    }
    else {
      req.session.user = user;
      res.redirect('/dashboard');
    }
  })
  .post('/register', createAccountLimiter, async (req, res) => {
    var { email, password, password2, username } = req.body;
    username = username.toLowerCase();
    if(username == 'root') {
      req.flash('register-message', `That username is unavailable`)
      return res.redirect('/register');
    }

    var user = await User.findOne({ email });
    if(user) {
      req.flash('register-message', 'There is already an account with that email');
      return res.redirect('/register');
    }

    user = await User.findOne({ username });
    if(user) {
      req.flash('register-message', 'That username is unavailable');
      return res.redirect('/register');
    }

    if(password !== password2) {
      req.flash('register-message', 'Passwords don\'t match');
      return res.redirect('/register');
    }

    const pswd = bythe(password);

    user = await User.create({
      email,
      password: pswd,
      username
    });

    req.session.user = user;
    await user.save();
    return res.redirect('/dashboard');
  })
  .post('/addDocker', check, async (req, res) => {
    /** @type {body} */
    const body = req.body;
    const files = req.files;

    for(const illegal in ['\\', '/']) {
      if(body.name.includes(illegal)) {
        req.flash('add-docker', `The filename contains illigal characters`);
        return res.redirect('/addDocker');
      }
    }

    if(!fs.existsSync(path.join(__dirname, 'verify', req.session.user.username))) await fs.mkdirSync(path.join(__dirname, 'verify', req.session.user.username), { recursive: true });
    await files.code.mv(path.join(__dirname, 'verify', req.session.user.username, `${body.name}.zip`), async (err) => {
      if(err) {
        console.log(err)
        return res.status(500);
      }

      const user = await User.findOne({ username: req.session.user.username });
      if(Object.entries(user.dockers).length == 0) user.dockers = {};
      var dockers;
      if (Object.entries(user.dockers).length > 0) dockers = ObjToMap(user.dockers);
      else dockers = new Map();

      const temp = [];

      if(Array.isArray(body.key) && Array.isArray(body.value)) {
        body.key.forEach((key, i) => {
          temp.push({
            key,
            value: body.value[i]
          });
        });
      }

      dockers.set(body.name, {
        running: false,
        id: "",
        version: body.version,
        verifying: true,
        verified: false,
        temp
      });

      user.dockers = MapToObj(dockers);

      user.markModified('dockers');
      notify(user.username, body.name);
      await user.save();
    })

    res.redirect('/dashboard')
  })
  .post('/admin/verify', check, async (req, res) => {
    const {name, code} = req.body;

    if(name == 'none' || code == 'none') return res.redirect('/admin');

    const user = await User.findOne({ username: name });
    if('verify' in req.body) {
      docker.createDocker(code, name, user.dockers[code].version, user.dockers[code].temp).then(async () => {
        const dockers = ObjToMap(user.dockers);
        const data = dockers.get(code);
        
        data.verifying = false;
        data.verified = true;
        delete data.temp;

        user.dockers[code] = data;
        await user.markModified(`dockers`);
        user.messages.push({
          id: genMessageId(),
          author: "Server",
          message: "Your code has been verified and a docker image has been created"
        })

        await user.save();
      });
    } else {
      const dockers = ObjToMap(user.dockers);
      dockers.delete(code);

      user.dockers = MapToObj(dockers);
      user.messages.push({
        id: genMessageId(),
        author: "Server",
        message: "Your code has been rejected"
      })

      await user.save();
    }

    return res.redirect('/admin');
  })
  .post('/admin/announce', check, async (req, res) => {
    const { announcement } = req.body;
    
    const users = await User.find({});

    users.forEach(async user => {
      user.messages.push({
        id: genMessageId(),
        author: req.session.user.username,
        message: announcement
      });

      await user.save();
    });

    res.redirect('/admin');
  })
  .post('/admin/download', check, async (req, res) => {
    const { code, name } = req.body;

    res.download(path.join(__dirname, 'verify', name, `${code}.zip`));
  })
  .listen(80, () => console.log(`Website online on port 80`));

mongoose.connect(config.mongoose_url).then(() => console.log(`Connected to the database`));

async function notify(username, code) {
  const data = {
    avatar_url: 'https://i.imgur.com/4M34hi2.png',
    content: `A user is awating verification\n\n**User**  | ${username}\n**Code** | ${code}`,
  }
  await fetch(config.webhook_url, {
    method: "POST",
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
}

function check(req, res, next) {
  if(!req.session.user) return res.redirect('/login');
  if(req.url.includes('admin') && !req.session.user.admin) return res.redirect('/dashboard');
  
  next();
}

function genMessageId() {
  let chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123465789';

  var id = '';

  for(let i = 0; i < 25; i++) {
    let index = Math.floor(Math.random() * chars.length);
    id += chars[index];
  }

  return id;
}

function ObjToMap(obj) { return new Map(Object.entries(obj)) }
function MapToObj(map) { return Object.fromEntries(map.entries()) }

/**
 * @typedef body
 * @property {string} name
 * @property {string} version
 * @property {string[] | string} key
 * @property {string[] | string} value
 */