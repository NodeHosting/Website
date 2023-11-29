/** @param {string} s */
module.exports = function hash(s) {
  let hashed = "";

  s.split("").forEach((char) => {
    const code = char.charCodeAt(0);

    hashed += String.fromCharCode(code + 2);
  });

  return Buffer.from(hashed).toString("base64");
};
