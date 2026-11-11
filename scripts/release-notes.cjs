#!/usr/bin/env node
"use strict";

// Prints the release notes for one version, taken from CHANGELOG.md.
// Usage: node scripts/release-notes.cjs v0.2.0 > notes.md
// Fails when the tag does not match package.json, when the version has no
// section, or when the notes are the usual boilerplate about tests.

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const tag = String(process.argv[2] || "");
const version = tag.replace(/^v/, "");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

function fail(message) {
  process.stderr.write("release-notes: " + message + "\n");
  process.exit(1);
}

if (!/^v\d+\.\d+\.\d+$/.test(tag)) fail('the tag must look like v1.2.3 (got "' + tag + '").');
if (pkg.version !== version) fail("package.json says " + pkg.version + " but the tag is " + tag + ".");

const lines = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8").split(/\r?\n/);
const start = lines.findIndex((l) => l.trim() === "## " + version);
if (start < 0) fail("CHANGELOG.md has no section for " + version + ".");
let end = lines.length;
for (let i = start + 1; i < lines.length; i += 1) {
  if (/^## /.test(lines[i])) {
    end = i;
    break;
  }
}
const body = lines.slice(start + 1, end).join("\n").trim();
if (!body) fail("the " + version + " section is empty.");
if (/passed (all )?tests|tests passed|passed the security gate|security gate/i.test(body)) {
  fail("the notes describe tests or the security gate. Write what changed for the people who use the app.");
}

process.stdout.write(body + "\n");
