const mongoose = require('mongoose');

module.exports = mongoose.model(
  'User', 
  new mongoose.Schema({
    email: { type: String, required: true },
    username: { type: String, required: true },
    password: { type: String, required: true },
    admin: { type: Boolean, default: false },
    maxContainers: { type: mongoose.Types.Decimal128, default: 1 },

    messages: { type: Array, default: ['Welcome to the website, to get started you can press on the add docker container button'] },

    dockers: { type: Object, default: {} },
    fileName: { type: String, default: '' }
  })
);