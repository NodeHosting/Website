const detect = require('browser-detect');

module.exports = (req, res, next) => {
  res.locals.mobile = detect(req.headers['user-agent']).mobile;
  next();
}