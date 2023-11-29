const mongoose = require("mongoose");

module.exports = mongoose.model(
  "User",
  new mongoose.Schema({
    email: { type: String, required: true },
    username: { type: String, required: true },
    password: { type: String, required: true },
    admin: { type: Boolean, default: false },
    maxContainers: { type: mongoose.Types.Decimal128, default: 1 },
    apiKey: { type: String, default: "" },

    messages: {
      type: Array,
      default: [
        {
          id: genMessageId(),
          author: "Server",
          message:
            "Welcome to the website, to get started you can press on the add docker container button",
        },
      ],
    },

    dockers: { type: Object, default: {} },
    fileName: { type: String, default: "" },
  })
);

function genMessageId() {
  let chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123465789";

  var id = "";

  for (let i = 0; i < 25; i++) {
    let index = Math.floor(Math.random() * chars.length);
    id += chars[index];
  }

  return id;
}
