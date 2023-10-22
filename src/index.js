// https://nodejs.org/en/docs/guides/nodejs-docker-webapp | docker run -d a/b => returns id you only need the first 12 chars 
const express = require('express');
const session = require('express-session');
const fileUpload = require('express-fileupload');
const app = express();

const path = require('path');
const config = require('../config.json');
const { spawnSync } = require('child_process');

app.use(express.json())
  .use(express.urlencoded({ extended: true }))
  .use(fileUpload({
  useTempFiles: true,
  tempFileDir: '/temp',
  safeFileNames: true,
  limits: { files: 1 }
  }))
  .use(session({
    secret: config.session_secret,
    resave: false, saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 12 }
  }))
  .engine('html', require('ejs').renderFile)
  .set('view engine', 'ejs')
  .use(express.static(path.join(__dirname, 'public')))
  .set('views', path.join(__dirname, 'views'))
  .get('/', (req, res) => {
    res.render('index');
  })
  .get('/dashboard', check, (req, res) => {
    res.render('dashboard');
  })
  .get('/logs', check, async (req, res) => {
    const logs = await getLogs(req.session.user.id);
    res.render('logs');
  })
  .post('/upload', async (req, res) => {
    await req.files.zip.mv('/verify');
    await notify(`${req.session.user.username} uploaded ${req.files.zip.name} and it needs verification`);

  })
  .listen(80, () => console.log(`Website online on port 80`));

async function notify(message) {
  await fetch(config.webhook_url, {
    method: "POST",
    body: message
  })
}

function check(req, res, next) {
  if(!req.session.user) return res.redirect('/login');
  
  next();
}

/** @returns {Promise<string[]>} */
async function getLogs(id) {
  return await spawnSync(`docker logs ${id}`).stdout.toString().trim().split('\n');
}

async function startDocker(name) {}