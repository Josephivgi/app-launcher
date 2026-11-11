"use strict";

// The app registry: validating what people and agents hand us, seeding the
// built-in entry, launching, and running version checks.

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const os = require("node:os");
const { validRepo, checkApp, readInstalledVersion } = require("./versions");
const { importIcon, dropIcon } = require("./icons");
const { downloadInstaller, assertReleaseUrl } = require("./releases");

const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const SOURCE_TYPES = ["json", "text", "exe", "manual"];
const KINDS = ["app", "website", "command"];
const SHELLS = ["cmd", "powershell"];
const SECTIONS = ["mine", "external"];

// Websites open in the default browser, or in `browser` (a full path) when set.
// Only http and https: a "url" must never run a local file or script.
function websiteUrl(raw) {
  let text = String(raw || "").trim();
  if (!text) throw new Error("A website needs a URL, like https://example.com.");
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = "https://" + text;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('That URL does not look right (got "' + raw + '").');
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("A website URL must start with https:// or http://.");
  if (!url.hostname) throw new Error("A website URL needs a host name.");
  return url.href;
}

function slug(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

function argList(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  const text = String(raw == null ? "" : raw).trim();
  return text ? text.match(/"[^"]*"|\S+/g).map((s) => s.replace(/^"|"$/g, "")) : [];
}

// Turns loose input (UI form or agent tool call) into a stored record, or
// throws a message the caller can show. `existing` supplies fields not given.
function normalizeRecord(input, existing) {
  const a = Object.assign({}, existing || {}, input || {});
  const name = String(a.name || "").trim();
  if (!name) throw new Error("An app needs a name.");
  const id = String(a.id || slug(name));
  if (!ID_RE.test(id)) throw new Error("App id must be lowercase letters, digits, and dashes (got \"" + id + "\").");

  const launchIn = Object.assign({}, existing && existing.launch, input && input.launch);
  const given = input || {};
  const inferred = given.command && !(given.exe || launchIn.exe) ? "command" : given.url && !(given.exe || launchIn.exe) ? "website" : "app";
  const kind = String(given.kind || (existing && existing.kind) || inferred);
  if (!KINDS.includes(kind)) throw new Error("kind must be app, website or command.");
  // Icons are imported by createApps (it needs the data folder); here they
  // only carry over from the stored record.
  const icons = { icon: String((existing && existing.icon) || ""), iconFrom: String((existing && existing.iconFrom) || "") };
  if (kind === "command") {
    const command = String(a.command !== undefined ? a.command : launchIn.command || "").trim();
    if (!command) throw new Error('A command needs the command line to run, like "npm run dev".');
    if (command.length > 4000) throw new Error("That command is over 4000 characters.");
    const cwd = String(a.cwd !== undefined ? a.cwd : launchIn.cwd || "").trim().replace(/^"+|"+$/g, "");
    if (cwd && !path.isAbsolute(cwd)) throw new Error("cwd must be a full path to a folder.");
    const shell = String(a.shell !== undefined ? a.shell : launchIn.shell || "cmd").toLowerCase();
    if (!SHELLS.includes(shell)) throw new Error("shell must be cmd or powershell.");
    const rawTerminal = a.terminal !== undefined ? a.terminal : launchIn.terminal;
    const terminal = rawTerminal === undefined ? true : rawTerminal === true || rawTerminal === "true";
    return Object.assign({
      id,
      kind,
      name: name.slice(0, 80),
      description: String(a.description == null ? "" : a.description).slice(0, 300),
      launch: { command, cwd, shell, terminal },
      repo: "",
      versionSource: { type: "manual", value: "" },
    }, icons);
  }
  if (kind === "website") {
    const browser = String(a.browser !== undefined ? a.browser : launchIn.browser || "").trim();
    if (browser && !path.isAbsolute(browser)) throw new Error("browser must be a full path to the browser program, or empty for the default browser.");
    return Object.assign({
      id,
      kind,
      name: name.slice(0, 80),
      description: String(a.description == null ? "" : a.description).slice(0, 300),
      launch: { url: websiteUrl(a.url !== undefined ? a.url : launchIn.url), browser },
      repo: "",
      versionSource: { type: "manual", value: "" },
    }, icons);
  }

  const exe = String(a.exe || launchIn.exe || "").trim();
  if (!exe) throw new Error("An app needs an exe: the full path of the program to launch.");
  if (!path.isAbsolute(exe)) throw new Error("exe must be a full path (got \"" + exe + "\").");
  const args = a.args !== undefined ? argList(a.args) : argList(launchIn.args);
  const cwd = String(a.cwd !== undefined ? a.cwd : launchIn.cwd || "").trim();
  if (cwd && !path.isAbsolute(cwd)) throw new Error("cwd must be a full path.");

  const repo = String(a.repo == null ? "" : a.repo).trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  if (repo && !validRepo(repo)) throw new Error('repo must look like "owner/name" (got "' + repo + '").');

  const src = Object.assign({}, a.versionSource);
  if (!src.type) src.type = a.versionPath ? "json" : "manual";
  if (a.versionPath) src.path = String(a.versionPath);
  if (a.versionKey) src.key = String(a.versionKey);
  if (a.installedVersion != null && a.installedVersion !== "") src.value = String(a.installedVersion);
  if (!SOURCE_TYPES.includes(src.type)) throw new Error("versionSource.type must be one of " + SOURCE_TYPES.join(", ") + ".");
  if ((src.type === "json" || src.type === "text") && !path.isAbsolute(String(src.path || ""))) throw new Error("A " + src.type + " version source needs a full path.");
  const versionSource = { type: src.type };
  if (src.path) versionSource.path = String(src.path);
  if (src.key) versionSource.key = String(src.key);
  if (src.type === "manual") versionSource.value = String(src.value || "");

  return Object.assign({
    id,
    kind,
    name: name.slice(0, 80),
    description: String(a.description == null ? "" : a.description).slice(0, 300),
    launch: { exe, args, cwd },
    repo,
    versionSource,
  }, icons);
}

// Writes the command into a small script and runs that, which avoids every
// layer of cmd/PowerShell quoting. With terminal on, `start` opens a new
// console that stays open; with it off the shell runs with no window.
function commandSpawn(dataRoot, app) {
  const { command, shell, terminal } = app.launch;
  const cwd = app.launch.cwd || os.homedir();
  if (!fs.existsSync(cwd)) throw new Error("The folder for " + app.name + " is not at " + cwd + ". Edit the command.");
  const dir = path.join(dataRoot, "commands");
  fs.mkdirSync(dir, { recursive: true });
  const comspec = process.env.ComSpec || path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe");
  const title = app.name.replace(/["^&|<>%]/g, "") || app.id;
  if (shell === "powershell") {
    const script = path.join(dir, app.id + ".ps1");
    fs.writeFileSync(script, "\uFEFF$Host.UI.RawUI.WindowTitle = '" + title.replace(/'/g, "''") + "'\r\n" + command + "\r\n", "utf8");
    const ps = ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass"];
    if (terminal) return { file: comspec, args: ["/d", "/c", 'start "' + title + '" /D "' + cwd + '" powershell.exe ' + ps.join(" ") + ' -NoExit -File "' + script + '"'], cwd, verbatim: true };
    return { file: "powershell.exe", args: ps.concat(["-NonInteractive", "-File", script]), cwd, verbatim: false };
  }
  const script = path.join(dir, app.id + ".cmd");
  const lines = command.split(/\r?\n/);
  const echo = lines.map((l) => "@echo ^> " + l.replace(/[\^&|<>%]/g, "^$&")).join("\r\n");
  fs.writeFileSync(script, "@title " + title + "\r\n" + echo + "\r\n" + lines.join("\r\n") + "\r\n", "utf8");
  if (terminal) return { file: comspec, args: ["/d", "/c", 'start "' + title + '" /D "' + cwd + '" "' + comspec + '" /d /k "' + script + '"'], cwd, verbatim: true };
  return { file: comspec, args: ["/d", "/s", "/c", '"' + script + '"'], cwd, verbatim: true };
}

function createApps(options) {
  const { db, openPath, openExternal } = options;
  const dataRoot = options.dataRoot || "";
  // Asks the person before anything is downloaded. Missing means no installs.
  const confirmInstall = options.confirmInstall || (async () => false);
  const installing = new Set();
  let checking = false;

  function describe(app) {
    const kind = app.kind || "app";
    const target = kind === "website" ? app.launch.browser : kind === "command" ? app.launch.cwd : app.launch.exe;
    return Object.assign({}, app, { kind, exeExists: target ? fs.existsSync(target) : true });
  }

  function list() {
    return db.listApps().map(describe);
  }

  function get(id) {
    const app = db.getApp(String(id || ""));
    if (!app) throw new Error('No app named "' + id + '".');
    return app;
  }

  function iconInUse(name, exceptId) {
    return db.listApps().some((a) => a.id !== exceptId && a.icon === name);
  }

  // `icon` in the input is a source (path, URL, data URI); "" clears it.
  async function withIcon(app, input, previous) {
    if (!input || input.icon === undefined) return app;
    if (!dataRoot) throw new Error("Icons need the data folder.");
    const next = Object.assign({}, app, await importIcon(dataRoot, app.id, input.icon));
    if (previous && previous.icon && previous.icon !== next.icon && !iconInUse(previous.icon, app.id)) dropIcon(dataRoot, previous.icon);
    return next;
  }

  async function add(input) {
    let app = normalizeApp(input);
    if (db.getApp(app.id)) throw new Error('An app "' + app.id + '" already exists. Use app_update to change it.');
    app = await withIcon(app, input, null);
    db.saveApp(app);
    await check(app.id).catch(() => {});
    return describe(db.getApp(app.id));
  }

  async function update(input) {
    const current = get(input && input.id);
    const base = normalizeApp(Object.assign({}, input, { id: current.id }), current);
    const next = await withIcon(base, input, current);
    db.saveApp(next);
    await check(next.id).catch(() => {});
    return describe(db.getApp(next.id));
  }

  function remove(id) {
    const found = db.getApp(String(id || ""));
    const ok = db.deleteApp(String(id || ""));
    if (ok && found && found.icon && dataRoot && !iconInUse(found.icon, found.id)) dropIcon(dataRoot, found.icon);
    return ok;
  }

  async function check(id) {
    const app = get(id);
    // Websites have no installed version to compare.
    const result = app.kind === "website" || app.kind === "command" ? { status: app.kind, checkedAt: new Date().toISOString() } : await checkApp(app);
    db.saveCheck(app.id, result);
    return describe(db.getApp(app.id));
  }

  async function checkAll() {
    if (checking) return list();
    checking = true;
    try {
      const apps = db.listApps();
      await Promise.all(apps.map((app) => check(app.id).catch(() => {})));
    } finally {
      checking = false;
    }
    return list();
  }

  async function launch(id) {
    const app = get(id);
    if (app.kind === "command") {
      if (!dataRoot) throw new Error("Commands need the data folder.");
      const run = commandSpawn(dataRoot, app);
      // The outer shell never shows a window: `start` opens the terminal when
      // one is wanted, and hidden commands stay hidden all the way down.
      const child = spawn(run.file, run.args, { cwd: run.cwd, stdio: "ignore", windowsHide: true, windowsVerbatimArguments: run.verbatim });
      await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("spawn", resolve);
      });
      child.unref();
      return { launched: app.id, command: app.launch.command, cwd: run.cwd, terminal: app.launch.terminal, pid: child.pid };
    }
    if (app.kind === "website") {
      const url = websiteUrl(app.launch.url);
      const browser = app.launch.browser;
      if (!browser) {
        await openExternal(url);
        return { launched: app.id, url, browser: "default" };
      }
      if (!fs.existsSync(browser)) throw new Error("The browser for " + app.name + " is not at " + browser + ". Edit the website or clear the browser to use your default one.");
      const child = spawn(browser, [url], { detached: true, stdio: "ignore", windowsHide: false });
      await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("spawn", resolve);
      });
      child.unref();
      return { launched: app.id, url, browser, pid: child.pid };
    }
    const { exe, args, cwd } = app.launch;
    if (!fs.existsSync(exe)) throw new Error(app.name + " is not at " + exe + ". Edit the app or reinstall it.");
    if (/\.(exe|com)$/i.test(exe)) {
      const child = spawn(exe, args, { cwd: cwd || path.dirname(exe), detached: true, stdio: "ignore", windowsHide: false });
      await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("spawn", resolve);
      });
      child.unref();
      return { launched: app.id, pid: child.pid };
    }
    const error = await openPath(exe);
    if (error) throw new Error(error);
    return { launched: app.id };
  }

  // Downloads the newest release's Windows installer from GitHub, checks it,
  // and opens it the way a double-click would. The person's own installer
  // window does the rest; the next check shows the new version.
  async function installUpdate(id) {
    const app = get(id);
    if (app.kind !== "app") throw new Error("Only apps have releases to install.");
    if (!dataRoot) throw new Error("Updates need the data folder.");
    if (installing.has(app.id)) throw new Error(app.name + " is already downloading.");
    const c = app.check || {};
    if (c.status !== "update") throw new Error(app.name + " has no newer release to install. Check for updates first.");
    if (!c.installer) throw new Error("The " + c.latest + " release has no Windows installer (.exe or .msi). Use the release page instead.");
    assertReleaseUrl(c.installer.url, app.repo);
    installing.add(app.id);
    try {
      const size = c.installer.size ? " (" + Math.max(1, Math.round(c.installer.size / 1048576)) + " MB)" : "";
      const check = c.installer.sha256 ? "It is checked against the SHA-256 checksum GitHub publishes for it." : "GitHub publishes no checksum for this file, so it cannot be checked.";
      const ok = await confirmInstall(
        "Install " + app.name + " " + c.latest + "?",
        "Download " + c.installer.name + size + " from github.com/" + app.repo + " and open its installer. " + check,
        "Download and install",
      );
      if (!ok) return { cancelled: true };
      const file = await downloadInstaller(c.installer, path.join(dataRoot, "updates", app.id));
      const error = await openPath(file.path);
      if (error) throw new Error(error);
      return { opened: file.path, version: c.latest, verified: file.verified };
    } finally {
      installing.delete(app.id);
    }
  }

  // The built-in entry is added once. Removing it later sticks.
  function seed() {
    if (db.getSetting("seeded:simple-recorder", false)) return;
    db.setSetting("seeded:simple-recorder", true);
    const dir = path.join(process.env.LOCALAPPDATA || "", "Programs", "Simple Recorder");
    const app = normalizeApp({
      id: "simple-recorder",
      name: "Simple Recorder",
      description: "Screen recorder with a floating always-on-top bar.",
      exe: path.join(dir, "Simple Recorder.exe"),
      repo: "Josephivgi/simple-recorder",
      versionSource: { type: "json", path: path.join(dir, "install.json"), key: "version" },
    });
    if (!db.getApp(app.id)) db.saveApp(app);
  }

  return { list, get, add, update, remove, check, checkAll, launch, installUpdate, seed, installedVersion: (id) => readInstalledVersion(get(id)) };
}

// Which list a card sits in. "mine" (the default) is for apps the user made.
// "external" is for apps someone else made that the user launches from here.
function normalizeApp(input, existing) {
  const given = input && input.section !== undefined ? input.section : existing && existing.section;
  const section = String(given || "mine");
  if (!SECTIONS.includes(section)) throw new Error("section must be mine or external.");
  return Object.assign(normalizeRecord(input, existing), { section });
}

module.exports = { createApps, normalizeApp, slug, websiteUrl, commandSpawn };
