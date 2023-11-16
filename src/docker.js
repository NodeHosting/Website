const User = require('./Mongoose/User');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const basedir = '/home/yellowy';

const Dockerfile = `FROM node:{version}-bookworm-slim
RUN groupadd --gid 420 {username} && useradd --uid 10420 --gid {username} --shell /bin/bash --create-home {username}
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init
WORKDIR /home/{username}/{name}
COPY --chown={username}:{username} package*.json ./
RUN {install}
COPY --chown={username}:{username} . .
USER {username}
CMD {cmd}`

/** @returns {Promise<string[]>} */
async function getLogs(id) {
  const logs = await execSync(`docker logs ${id}`).toString().trim().split('\n');
  return logs;
}

async function createDocker(file, username, version, envArr = []) {
  if(file.includes('.')) file = file.split('.')[0];
  const cmd = [];
  /** @type {string} */
  var docker = Dockerfile
    .replaceAll(/{username}/g, username)
    .replace('{name}', file)
    .replace('{version}', version);

  if(envArr.length > 0) envArr.forEach(env => {
    cmd.push(`${env.name}=${env.value}`);
  })

  cmd.push('dumb-init', 'node', '.');
  docker = docker.replace(/{cmd}/, JSON.stringify(cmd).replace(/'/gm, ''));


  const pth = path.join(__dirname, 'temp', username, file);
  const dckr = __dirname;
  if(!fs.existsSync(path.join(__dirname, 'temp', username))) await fs.mkdirSync(path.join(__dirname, 'temp', username), { recursive: true });

  return new Promise(async (resolve, reject) => {
    await execSync(`unzip -o ./src/verify/${username}/${file} -d ${pth}`);
    if(await fs.existsSync(`${pth}/package-lock.json`)) docker = docker.replace('{install}', 'npm ci --only=production');
    else docker = docker.replace('{install}', "npm install --omit=dev");
    await fs.writeFileSync(`${pth}/Dockerfile`, docker);
    await execSync(`cp .dockerignore ${pth}`, { cwd: dckr });
    await execSync(`docker build . -t ${username}/${file}`, { cwd: pth });
    await execSync(`rm -rf ${pth}`, { cwd: dckr });
    await execSync(`rm -f ${path.join(__dirname, 'verify', username, file)}.zip`);

    resolve();
  })
}

async function remove(name, username) {
  execSync(`rm -f ${path.join(__dirname, 'verify', username, name)}.zip`);

  return;
}

/** @returns {statsData} */
async function stats(id) {
  try {
    return await JSON.parse(execSync(`docker stats --format json --no-stream ${id}`).toString());
  } catch (e) { return null; }
}

async function startDocker({username, name, id}) {
  if(id) {
    execSync(`docker start ${id}`)
  } else {
    const fullId = execSync(`docker run -d --memory="512m" --cpus="0.25" ${username}/${name}`).toString().trim();
    const id = fullId.slice(0, 11);

    return id;
  }
}

async function close( username, name ) {
  const user = await User.findOne({ username });
  try {
    execSync(`docker kill ${user.dockers[name].id}`);
  } catch (e) {}

  user.dockers[name].running = false;
  user.markModified('dockers');

  await user.save();

  return user.dockers[name].id;
}

async function deleteDocker( username, name, id ) {
  try {
    await close(username, name);
  } catch (e) {}

  execSync(`docker rmi -f ${username}/${name}`);
  if(typeof id == 'string' && id !== "") execSync(`docker rm -f ${id}`);
}

module.exports = {
  delete: deleteDocker,
  shutdown: close,
  createDocker,
  startDocker,
  getLogs,
  remove,
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