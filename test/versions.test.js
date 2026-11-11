"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { normalizeVersion, compareVersions, validRepo, readInstalledVersion } = require("../lib/versions");
const { normalizeApp } = require("../lib/apps");

test("normalizeVersion strips v and fills patch", () => {
  assert.equal(normalizeVersion("v1.2.6"), "1.2.6");
  assert.equal(normalizeVersion("1.2"), "1.2.0");
  assert.equal(normalizeVersion("2.0.0-beta.1"), "2.0.0-beta.1");
  assert.equal(normalizeVersion("nope"), "");
});

test("compareVersions orders releases and prereleases", () => {
  assert.equal(compareVersions("1.2.10", "1.2.9"), 1);
  assert.equal(compareVersions("v1.2.6", "1.2.6"), 0);
  assert.equal(compareVersions("1.0.0", "1.0.1"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0-rc.1"), 1);
  assert.equal(compareVersions("x", "1.0.0"), null);
});

test("validRepo accepts owner/name only", () => {
  assert.ok(validRepo("Josephivgi/simple-recorder"));
  assert.ok(!validRepo("https://github.com/a/b"));
  assert.ok(!validRepo("a/b/c"));
  assert.ok(!validRepo(""));
});

test("readInstalledVersion reads json, text, and manual sources", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "al-"));
  const json = path.join(dir, "install.json");
  const txt = path.join(dir, "version");
  fs.writeFileSync(json, JSON.stringify({ app: { version: "3.1.4" }, version: "1.2.6" }));
  fs.writeFileSync(txt, "44.4.3\n");
  assert.equal(await readInstalledVersion({ versionSource: { type: "json", path: json, key: "version" } }), "1.2.6");
  assert.equal(await readInstalledVersion({ versionSource: { type: "json", path: json, key: "app.version" } }), "3.1.4");
  assert.equal(await readInstalledVersion({ versionSource: { type: "text", path: txt } }), "44.4.3");
  assert.equal(await readInstalledVersion({ versionSource: { type: "manual", value: "v2.0" } }), "2.0.0");
  assert.equal(await readInstalledVersion({ versionSource: { type: "json", path: path.join(dir, "missing.json") } }), "");
});

test("normalizeApp validates and defaults", () => {
  const exe = process.execPath;
  const app = normalizeApp({ name: "My App", exe, repo: "https://github.com/o/n.git", args: "--a \"b c\"" });
  assert.equal(app.id, "my-app");
  assert.equal(app.repo, "o/n");
  assert.deepEqual(app.launch.args, ["--a", "b c"]);
  assert.throws(() => normalizeApp({ name: "x", exe: "rel.exe" }), /full path/);
  assert.throws(() => normalizeApp({ name: "x", exe, repo: "bad repo" }), /owner\/name/);
  assert.throws(() => normalizeApp({ exe }), /name/);
  const edited = normalizeApp({ id: "my-app", description: "d" }, app);
  assert.equal(edited.launch.exe, exe);
  assert.equal(edited.description, "d");
});
