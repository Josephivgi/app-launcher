"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeApp, websiteUrl, createApps } = require("../lib/apps");

test("websiteUrl adds https and only allows http and https", () => {
  assert.equal(websiteUrl("jsystems.app"), "https://jsystems.app/");
  assert.equal(websiteUrl("http://localhost:4310/x?y=1"), "http://localhost:4310/x?y=1");
  for (const bad of ["", "file:///C:/Windows/System32/calc.exe", "javascript:alert(1)", "ftp://example.com", "https://"]) {
    assert.throws(() => websiteUrl(bad), undefined, bad);
  }
});

test("normalizeApp stores websites without an exe and infers the kind from url", () => {
  const site = normalizeApp({ name: "JSystems", url: "jsystems.app" });
  assert.equal(site.kind, "website");
  assert.deepEqual(site.launch, { url: "https://jsystems.app/", browser: "" });
  assert.equal(normalizeApp({ name: "X", url: "x.com", browser: "C:\\Browsers\\b.exe" }).launch.browser, "C:\\Browsers\\b.exe");
  assert.throws(() => normalizeApp({ name: "X", url: "x.com", browser: "b.exe" }), /full path/);
  const app = normalizeApp({ name: "Tool", exe: "C:\\Tools\\tool.exe" });
  assert.equal(app.kind, "app");
  // Editing a website keeps it a website.
  assert.equal(normalizeApp({ name: "JSystems 2" }, site).kind, "website");
});

test("launching a website hands the URL to the browser and skips GitHub checks", async () => {
  const rows = new Map();
  const db = {
    listApps: () => [...rows.values()],
    getApp: (id) => rows.get(id) || null,
    saveApp: (a) => rows.set(a.id, Object.assign({}, rows.get(a.id), a)),
    saveCheck: (id, check) => rows.set(id, Object.assign({}, rows.get(id), { check })),
    deleteApp: (id) => rows.delete(id),
    getSetting: () => true,
    setSetting: () => {},
  };
  const opened = [];
  const apps = createApps({ db, openPath: async () => "", openExternal: async (url) => opened.push(url) });
  const added = await apps.add({ name: "Docs", url: "https://example.com/docs" });
  assert.equal(added.check.status, "website");
  assert.equal(added.exeExists, true);
  const res = await apps.launch("docs");
  assert.deepEqual(opened, ["https://example.com/docs"]);
  assert.equal(res.browser, "default");
  await apps.update({ id: "docs", browser: "C:\\Nope\\browser.exe" });
  assert.equal(apps.list()[0].exeExists, false);
  await assert.rejects(apps.launch("docs"), /browser for Docs is not at/);
});

test("normalizeApp stores commands and infers the kind from command", () => {
  const cmd = normalizeApp({ name: "Dev server", command: "npm run dev", cwd: "C:\\Work\\blog" });
  assert.equal(cmd.kind, "command");
  assert.deepEqual(cmd.launch, { command: "npm run dev", cwd: "C:\\Work\\blog", shell: "cmd", terminal: true });
  assert.equal(normalizeApp({ name: "Q", command: "code .", terminal: false, shell: "powershell" }).launch.terminal, false);
  assert.throws(() => normalizeApp({ name: "Q", kind: "command" }), /command line/);
  assert.throws(() => normalizeApp({ name: "Q", command: "x", cwd: "relative" }), /full path/);
  assert.throws(() => normalizeApp({ name: "Q", command: "x", shell: "bash" }), /cmd or powershell/);
  // Editing keeps the kind and the stored icon.
  const edited = normalizeApp({ name: "Dev 2" }, Object.assign({}, cmd, { icon: "dev-server-0123456789.png" }));
  assert.equal(edited.kind, "command");
  assert.equal(edited.icon, "dev-server-0123456789.png");
});

test("commandSpawn writes a script so quotes and & survive", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { commandSpawn } = require("../lib/apps");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "al-cmd-"));
  const app = normalizeApp({ id: "t", name: "T & Co", command: 'echo "a & b"', cwd: root, terminal: false });
  const run = commandSpawn(root, app);
  const script = fs.readFileSync(path.join(root, "commands", "t.cmd"), "utf8");
  assert.match(script, /echo "a & b"\r\n$/);
  assert.match(script, /^@title T  Co\r\n/);
  assert.equal(run.args.at(-1), '""' + path.join(root, "commands", "t.cmd") + '""');
  const shown = commandSpawn(root, Object.assign({}, app, { launch: Object.assign({}, app.launch, { terminal: true }) }));
  assert.match(shown.args.at(-1), /^start "T  Co" \/D /);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a hidden command runs when the data folder has a space in its path", { skip: process.platform !== "win32" }, () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { spawnSync } = require("node:child_process");
  const { commandSpawn, normalizeApp } = require("../lib/apps");
  // The real data folder is "%APPDATA%\App Launcher", so the script path
  // always has a space in it.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "al cmd "));
  const marker = path.join(root, "ran.txt");
  const app = normalizeApp({ id: "t", name: "T", command: 'echo ran>"' + marker + '"', cwd: root, terminal: false });
  const run = commandSpawn(root, app);
  const result = spawnSync(run.file, run.args, { cwd: run.cwd, encoding: "utf8", windowsVerbatimArguments: run.verbatim });
  assert.equal(result.status, 0, String(result.stderr || ""));
  assert.ok(fs.existsSync(marker), "the command script did not run");
  fs.rmSync(root, { recursive: true, force: true });
});

test("importIcon stores real images, keeps exe paths, and rejects non-images", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { importIcon, iconFile } = require("../lib/icons");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "al-icon-"));
  const png = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGPIC7hDEmIY1TCqYfhqAACJzZoQDZ9zzwAAAABJRU5ErkJggg==";
  const fromData = await importIcon(root, "x", "data:image/png;base64," + png);
  assert.match(fromData.icon, /^x-[0-9a-f]{10}\.png$/);
  assert.ok(fs.existsSync(iconFile(root, fromData.icon)));
  const svg = path.join(root, "logo.svg");
  fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>');
  assert.match((await importIcon(root, "y", svg)).icon, /\.svg$/);
  const exe = process.execPath;
  assert.deepEqual(await importIcon(root, "z", exe), { icon: "", iconFrom: exe });
  const fake = path.join(root, "fake.png");
  fs.writeFileSync(fake, "<html>not an image</html>");
  await assert.rejects(importIcon(root, "w", fake), /not an image/);
  await assert.rejects(importIcon(root, "w", "relative.png"), /full path/);
  assert.equal(iconFile(root, "../app-launcher.db"), "");
  fs.rmSync(root, { recursive: true, force: true });
});

test("websiteUrl treats host:port as a host, not a scheme", () => {
  assert.equal(websiteUrl("localhost:4310"), "http://localhost:4310/");
  assert.equal(websiteUrl("127.0.0.1:8080?x=1"), "http://127.0.0.1:8080/?x=1");
  assert.equal(websiteUrl("[::1]:5000#a"), "http://[::1]:5000/#a");
  assert.equal(websiteUrl("example.com:3000/x"), "https://example.com:3000/x");
  assert.equal(websiteUrl("https://localhost:4310"), "https://localhost:4310/");
  assert.equal(websiteUrl("0.0.0.0:3000"), "http://0.0.0.0:3000/");
  assert.throws(() => websiteUrl("tel:12345"), /https:\/\/ or http:\/\//);
  assert.throws(() => websiteUrl("javascript:alert(1)"));
});
