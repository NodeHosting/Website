const User = require('./Mongoose/User');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

var Dockerfile = `FROM node:18
WORKDIR /home/{username}/{name}
COPY package*.json ./
RUN npm install
COPY . .
CMD {cmd}`

/** @returns {Promise<string[]>} */
async function getLogs(id) {
  const logs = await execSync(`docker logs ${id}`).toString().trim().split('\n');
  return logs;
}

async function createDocker(file, username, env) {
  if(file.includes('.')) file = file.split('.')[0];
  const cmd = [];
  var docker = Dockerfile
    .replace('{username}', username)
    .replace('{name}', file)

  if(env.length > 0) env.forEach(envVar => {
    cmd.push(`${envVar.name}=${envVar.value}`);
  })

  cmd.push('node', '.');
  docker = docker.replace(/{cmd}/, JSON.stringify(cmd).replace(/'/gm, ''));


  const pth = path.join(__dirname, 'temp', username, file);
  const dckr = __dirname;
  if(!fs.existsSync(path.join(__dirname, 'temp', username))) await fs.mkdirSync(path.join(__dirname, 'temp', username), { recursive: true });

  return new Promise(async (resolve, reject) => {
    await execSync(`unzip ./src/verify/${username}/${file} -d ${pth}`);
    await fs.writeFileSync(`${pth}/Dockerfile`, docker);
    await execSync(`cp .dockerignore ${pth}`, { cwd: dckr });
    await execSync(`docker build . -t ${username}/${file}`, { cwd: pth });
    await execSync(`rm -rf ${pth}`, { cwd: dckr });
    await execSync(`rm -rf ./src/verify/${username}/${file}.zip`, { cwd: dckr });

    resolve();
  })
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
    const fullId = execSync(`docker run -d --memory="512m" --cpus="1" ${username}/${name}`).toString().trim();
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

async function deleteDocker( username, name ) {
  try {
    var id = await close(username, name);
  } catch (e) {}

  execSync(`docker rmi -f ${username}/${name}`);
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