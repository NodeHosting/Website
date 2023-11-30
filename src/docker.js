const User = require("./Mongoose/User");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const Dockerfile = `FROM node:{version}-bookworm-slim
RUN groupadd --gid 420 {username} && useradd --uid 10420 --gid {username} --shell /bin/bash --create-home {username}
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init
WORKDIR /home/{username}/{name}
COPY --chown={username}:{username} package*.json ./
RUN {install}
COPY --chown={username}:{username} . .
USER {username}
CMD {cmd}`;

/** @returns {Promise<string[]>} */
async function getLogs(id) {
  const logs = (await runCommand(`docker logs ${id}`)).trim().split("\n");
  return logs;
}

async function createDocker(file, username, version, envArr = []) {
  if (file.includes(".")) file = file.split(".")[0];
  if (version == undefined) version = "current";
  const cmd = [];
  /** @type {string} */
  var docker = Dockerfile.replaceAll(/{username}/g, username)
    .replace("{name}", file)
    .replace("{version}", version);

  if (envArr.length > 0)
    envArr.forEach((env) => {
      cmd.push(`${env.name}=${env.value}`);
    });

  cmd.push("dumb-init", "node", ".");
  docker = docker.replace(/{cmd}/, JSON.stringify(cmd).replace(/'/gm, ""));

  const pth = path.join(__dirname, "temp", username, file);
  const dckr = __dirname;
  if (!fs.existsSync(path.join(__dirname, "temp", username)))
    await fs.mkdirSync(path.join(__dirname, "temp", username), {
      recursive: true,
    });

  return new Promise((resolve, reject) => {
    if (fs.existsSync(`${pth}/package-lock.json`))
      docker = docker.replace("{install}", "npm ci --omit=dev");
    else docker = docker.replace("{install}", "npm install --omit=dev");

    runCommand(`unzip -o ./src/verify/${username}/${file} -d ${pth}`)
      .then(async () => {
        fs.writeFileSync(`${pth}/Dockerfile`, docker);
        runCommand(`cp .dockerignore ${pth}`, { cwd: dckr })
          .then(async () => {
            runCommand(`docker build . -t ${username}/${file}`, { cwd: pth })
              .then(async () => {
                runCommand(`rm -rf ${pth}`, { cwd: dckr })
                  .then(async () => {
                    runCommand(
                      `rm -f ${path.join(
                        __dirname,
                        "verify",
                        username,
                        file
                      )}.zip`
                    ).catch((err) => {
                      return reject(err);
                    });
                  })
                  .catch((err) => {
                    return reject(err);
                  });
              })
              .catch((err) => {
                return reject(err);
              });
          })
          .catch((err) => {
            return reject(err);
          });
      })
      .catch((err) => {
        return reject(err);
      });

    resolve();
  });
}

async function remove(name, username) {
  await runCommand(
    `rm -f ${path.join(__dirname, "verify", username, name)}.zip`
  );

  return;
}

/** @returns {statsData} */
async function stats(id) {
  try {
    return await JSON.parse(
      await runCommand(`docker stats --format json --no-stream ${id}`)
    );
  } catch (_) {
    return {
      BlockIO: "0B / 0B",
      CPUPerc: "0.00%",
      Container: "",
      ID: "",
      MemPerc: "0.00%",
      MemUsage: "0B / 0B",
      Name: "",
      NetIO: "0B / 0B",
      PIDs: "0",
    };
  }
}

async function startDocker({ username, name, id }) {
  if (id) {
    await runCommand(`docker start ${id}`);
  } else {
    const fullId = execSync(
      `docker run -d --memory="512m" --cpus="0.25" ${username}/${name}`
    )
      .toString()
      .trim();
    const id = fullId.slice(0, 11);

    return id;
  }
}

async function close(username, name) {
  const user = await User.findOne({ username });

  await runCommand(`docker kill ${user.dockers[name].id}`);

  user.dockers[name].running = false;
  user.markModified("dockers");

  await user.save();

  return user.dockers[name].id;
}

async function deleteDocker(username, name, id) {
  await close().catch(() => {});

  await runCommand(`docker rmi -f ${username}/${name}`);
  if (typeof id == "string" && id !== "")
    await runCommand(`docker rm -f ${id}`);
}

/** @returns {Promise<string>} */
async function runCommand(cmd, opt = {}) {
  return new Promise((resolve, reject) => {
    try {
      resolve(execSync(cmd, opt).toString());
    } catch (error) {
      reject(error);
    }
  });
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
};

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
