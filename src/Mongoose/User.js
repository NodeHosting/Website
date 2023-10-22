const mongoose = require('mongoose');

module.exports = mongoose.model('User', new mongoose.Schema({
  email: { type: String, required: true },
  username: { type: String },
  password: { type: String },
  admin: { type: Boolean, default: false },

  running: { type: Boolean, default: false },
  verifying: { type: Boolean, default: false },
  verified: { type: Boolean, default: false },
  messages: { type: Array, default: [] },

  dockerid: { type: String, default: '' },
  fileName: { type: String }
}));