const express = require("express");
const session = require("express-session");
const fileUpload = require("express-fileupload");
const app = express();

const path = require("path");
const mobile = require("./middleware/browser");
const config = require("../config.json");
const mongoose = require("mongoose");

/** @type {boolean} weather or not the application is in production mode */
var production;
if (process.env["NODE_ENV"] == "production") production = true;
else production = false;

var routes = require("./routers");

app
  .use(express.json())
  .use(express.urlencoded({ extended: true }))
  .use(
    fileUpload({
      useTempFiles: true,
      tempFileDir: "/tmp",
      limits: { files: 1, fileSize: 1e9 },
    })
  )
  .use(
    session({
      secret: config.session_secret,
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 1000 * 60 * 60 * 12, secure: production },
    })
  )
  .use(require("cookie-parser")())
  .use(require("connect-flash")())
  .use(mobile)
  .engine("html", require("ejs").renderFile)
  .set("view engine", "ejs")
  .use(express.static(path.join(__dirname, "public")))
  .set("views", path.join(__dirname, "views"))
  .set("trust proxy", 1)
  .use("/", routes)
  .use(check, (_, res) => {
    res.status(404).render("404");
  })
  .post("/admin/update", check, async (req, res) => {
    delete require.cache[require.resolve("./routers.js")];
    routes = require("./routers");

    res.redirect("/admin");
  })
  .listen(80, () => console.log("Website online on port 80"));

mongoose
  .connect(config.mongoose_url)
  .then(() => console.log("Connected to the database"));

function check(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  if (req.url.includes("admin") && !req.session.user.admin)
    return res.redirect("/dashboard");

  next();
}
