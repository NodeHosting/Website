// https://nodejs.org/en/docs/guides/nodejs-docker-webapp | docker run -d a/b => returns id you only need the first 12 chars 
const express = require('express');
const session = require('express-session');
const fileUpload = require('express-fileupload');
const app = express();

const path = require('path');
const config = require('../config.json');
const mongoose = require('mongoose');
const docker = require('./docker');
const bythe = require('./utils');

const User = require('./Mongoose/User');
const { default: rateLimit } = require('express-rate-limit');
const fs = require('fs');

const createAccountLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: 'You\'ve created too many accounts from this ip',
  standardHeaders: 'draft-7',
  legacyHeaders: false
});

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
    cookie: { maxAge: 1000 * 60 * 60 * 12 }
  }))
  .use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false
  }))
  .engine('html', require('ejs').renderFile)
  .set('view engine', 'ejs')
  .use(express.static(path.join(__dirname, 'public')))
  .set('views', path.join(__dirname, 'views'))
  .set('trust proxy', 1)
  .get('/', (req, res) => {
    res.render('index');
  })
  .get('/login', (req, res) => {
    res.render('login');
  })
  .get('/register', (req, res) => {
    res.render('register');
  })
  .get('/dashboard', check, async (req, res) => {
    const user = await User.findOne({ username: req.session.user.username });
    const dockers = ObjToMap(user.dockers);
    if(dockers.size > 0) {
      dockers.forEach(async (data, name) => {
        if(data.id !== "") {
          const stats = await docker.stats(data.id);
          if(Number(stats.PIDs) > 0) data.running = true;
          else data.running = false;
        }

        dockers.set(name, data);
      });

      user.dockers = MapToObj(dockers);
      await user.save();
    }
    
    res.render('dashboard', {
      user: user,
      dockers
    });

    user.messages = [];
    await user.save();
    req.session.user = user;
  })
  .get('/addDocker', check, async (req, res) => {
    res.render('addDocker');
  })
  .get('/logs/:id', check, async (req, res) => {
    const name = req.url.split('/')[2]
    const user = await User.findOne({ username: req.session.user.username });
    const logs = await docker.getLogs(user.dockers[name].id);

    console.log({ logs });
    
    res.render('logs', { logs });
  })
  .get('/stats/', check, async (req, res) => {
    const name = req.url.split('/')[2]
    const user = await User.findOne({ username: req.session.user.username });
    const dockers = ObjToMap(user.dockers);
    const stats = [];
    
    dockers.forEach(async (data, _name) => {
      const stat = await docker.stats(data.id);
      if(stat == null) return;

      if(stat.PIDs < 1) data.running = false;
      dockers.set(_name, data);
      
      stats.push(stat);
    });

    user.dockers = MapToObj(dockers);
    user.markModified('dockers');
    await user.save();
    console.log(stats);

    res.render('stats', { stats });
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

    docker.delete(user.username, name);
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
      users: verification
    });
  })
  .post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if(!user) {
      console.log(`No user found with that email`)
      return res.redirect('/login');
    }

    if(bythe(password) !== user.password) {
      console.log(`password incorrect`);
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

    var user = await User.findOne({ email });
    if(user) return res.redirect('/register');

    user = await User.findOne({ username });
    if(user) return res.redirect('/register');

    if(password !== password2) return res.redirect('/register');

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
  .post('/upload', check, async (req, res) => {
    await req.files.zip.mv(`${path.join(__dirname, 'verify', req.files.zip.name)}`, async function(err) {
      if (err) {
        return res.status(500).send(err);
      }
      
      const user = await User.findOne({ username: req.session.user.username });

      user.verifying = true;
      user.fileName = req.files.zip.name;
      await user.save();

      return res.redirect('/dashboard');
    });
    await notify(`${req.session.user.username} uploaded ${req.files.zip.name} and it needs verification`);
    
  })
  .post('/addDocker', check, async (req, res) => {
    const body = req.body;
    const files = req.files;

    if(!fs.existsSync(path.join(__dirname, 'verify', req.session.user.username))) await fs.mkdirSync(path.join(__dirname, 'verify', req.session.user.username), { recursive: true });
    await files.file.mv(path.join(__dirname, 'verify', req.session.user.username, `${body.name}.zip`), async (err) => {
      if(err) {
        console.log(err)
        return res.status(500).send(err);
      }

      const user = await User.findOne({ username: req.session.user.username });
      if(Object.entries(user.dockers).length == 0) user.dockers = {};
      var dockers;
      if (Object.entries(user.dockers).length > 0) dockers = ObjToMap(user.dockers);
      else dockers = new Map();

      const baseContainer = {
        running: false,
        id: '',
        verifying: true,
        verified: false
      }

      dockers.set(body.name, baseContainer);

      user.dockers = MapToObj(dockers);

      await user.save();
    })

    res.redirect('/dashboard')
  })
  .post('/admin/verify', check, async (req, res) => {
    const {name, code} = req.body;
    const user = await User.findOne({ username: name });
    if('verify' in req.body) {
      docker.createDocker(code, name, []).then(async () => {
        const dockers = ObjToMap(user.dockers);
        const data = dockers.get(code);
        
        data.verifying = false;
        data.verified = true;

        user.dockers[code] = data;
        await user.markModified(`dockers`);
        user.messages.push("Your code has been verified and a docker image has been created");

        await user.save();

        
      });
    } else {
      const dockers = ObjToMap(user.dockers);
      dockers.delete(code);

      user.dockers = MapToObj(dockers);
      user.messages.push("Your code has been rejected");

      await user.save();
    }

    res.redirect('/admin');
  })
  .listen(80, () => console.log(`Website online on port 80`));

mongoose.connect(config.mongoose_url).then(() => console.log(`Connected to the database`));

async function notify(message) {
  const data = {
    avatar_url: 'https://i.imgur.com/4M34hi2.png',
    content: message,
  }
  await fetch(config.webhook_url, {
    method: "POST",
    body: JSON.stringify(data)
  });
}

function check(req, res, next) {
  if(!req.session.user) return res.redirect('/login');
  if(req.url.includes('admin') && !req.session.user.admin) return res.redirect('/dashboard');
  
  next();
}

function ObjToMap(obj) { return new Map(Object.entries(obj)) }
function MapToObj(map) { return Object.fromEntries(map.entries()) }