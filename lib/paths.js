"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

// Write a file all at once: a temp file, then a rename, so a reader never sees half of it.
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + "." + randomUUID().slice(0, 8) + ".tmp";
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

module.exports = { writeAtomic };
