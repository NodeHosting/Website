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
  .get('/ip', (req, res) => {
    res.send(req.ip);
  })
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
    if(user.dockerid !== '') {
      const stats = await docker.stats(user.dockerid);
      if(stats.PIDs == "0") user.running = false;

      await user.save();
    }
    
    res.render('dashboard', {
      user: user
    });

    user.messages = [];
    await user.save();
    req.session.user = user;
  })
  .get('/logs', check, async (req, res) => {
    const user = await User.findOne({ username: req.session.user.username });
    const logs = await docker.getLogs(user.dockerid);
    res.render('logs', { logs });
  })
  .get('/start', check, async (req, res) => {
    await docker.startDocker(req.session.user.username).then(async () => {
      const user = await User.findOne({ username: req.session.user.username });
      user.running = true;
      await user.save();
    });

    res.redirect('/dashboard');
  })
  .get('/shutdown', check, async (req, res) => {
    const user = await User.findOne({ username: req.session.user.username });
    await docker.shutdown(user.dockerid);

    res.redirect('/dashboard');
  })
  .get('/delete', check, async (req, res) => {
    const user = await User.findOne({ username: req.session.user.username });
    await docker.delete(user.dockerid, user.username);

    user.dockerid = '';
    user.verified = false;

    await user.save();

    res.redirect('/dashboard');
  })
  .get('/admin', check, async (req, res) => {
    const users = await User.find({ verifying: true });
    res.render('admin', {
      users
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
  .post('/admin/verify', check, async (req, res) => {
    const { username } = req.body;
    const user = await User.findOne({ username });
    if('verify' in req.body) {
      docker.createDocker(user.fileName, username).then(async () => {
        user.verifying = false;
        user.verified = true;
        user.fileName = '';
        user.messages.push("Your code has been verified and a docker image has been created");
      });
    }
    else {
      user.verifying = false;
      user.fileName = '';
      user.messages.push("Your code has been rejected");
    }

    await user.save();

    res.redirect('/admin')
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
    body: message
  });
}

function check(req, res, next) {
  if(!req.session.user) return res.redirect('/login');
  if(req.url.includes('admin') && !req.session.user.admin) return res.redirect('/dashboard');
  
  next();
}