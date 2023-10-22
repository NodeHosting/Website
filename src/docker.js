const User = require('./Mongoose/User');
const { execSync } = require('child_process');
const path = require('path');

/** @returns {Promise<string[]>} */
async function getLogs(id) {
  return await execSync(`docker logs ${id}`).toString().trim().split('\n');
}

async function createDocker(file, username) {
  if(file.includes('.')) file = file.split('.')[0];
  const pth = path.join(__dirname, 'temp', file);
  const dckr = __dirname;
  execSync(`unzip ./src/verify/${file} -d ${pth}`);
  execSync(`cp Dockerfile ${pth}`, { cwd: dckr });
  execSync(`cp .dockerignore ${pth}`, { cwd: dckr });
  execSync(`docker build . -t ${username}/program`, { cwd: pth });
  execSync(`rm -rf ${pth}`, { cwd: dckr });
  execSync(`rm -rf ./src/verify/${file}`);
}

/** @returns {statsData} */
async function stats(id) {
  return await JSON.parse(execSync(`docker stats --format json --no-stream ${id}`).toString());
}

async function startDocker(username) {
  const fullId = execSync(`docker run -d ${username}/program`).toString().trim();
  const id = fullId.slice(0, 11);
  const user = await User.findOne({ username });
  user.dockerid = id;

  await user.save();
  return;
}

async function close( id ) {
  const user = await User.findOne({ dockerid: id });
  try {
    execSync(`docker kill ${id}`);
  } catch (e) {}

  user.running = false;

  await user.save();
}

async function deleteDocker( id, username ) {
  try {
    await close(id);
  } catch (e) {}

  execSync(`docker rmi -f ${username}/program`);
  execSync(`docker rm -f ${id}`);
}

module.exports = {
  delete: deleteDocker,
  shutdown: close,
  createDocker,
  startDocker,
  getLogs,
  stats,
  close,
}

/**
 * @typedef statsData
 * @property {string} BlockIO
 * @property {string} CPUPerc
 * @property {string} Container
 * @property {string} ID
 * @property {string} MemPerc
 * @property {string} MemUsage
 * @property {string} Name
 * @property {string} NetIO
 * @property {string} PIDs
 */