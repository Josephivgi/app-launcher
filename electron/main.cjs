"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, ipcMain, protocol, shell, dialog } = require("electron");
const { openDb } = require("../lib/db");
const { createApps } = require("../lib/apps");
const { APP_TOOLS, callAppTool } = require("../lib/app-tools");
const { listAgents, setConnected, syncAgents } = require("../lib/agent-connect");
const { startBridge } = require("./bridge.cjs");
const { iconFile } = require("../lib/icons");
const { createSelfUpdate } = require("../lib/self-update");

const APP_ROOT = path.join(__dirname, "..");
const RENDERER = path.join(APP_ROOT, "renderer");
const SHELL_URL = "app://shell/index.html";
const PRELOAD = path.join(__dirname, "preload.cjs");
const MCP_SERVER = path.join(APP_ROOT, "lib", "mcp-stdio.cjs");

app.setName("App Launcher");
// One taskbar identity for the window and the Start Menu shortcut, so a pin
// starts App Launcher and not bare electron.exe.
const APP_ID = "com.jsystems.app-launcher";
const APP_ICON = path.join(APP_ROOT, "build", "icon.ico");
if (process.platform === "win32") app.setAppUserModelId(APP_ID);
const DATA_ROOT = process.env.APP_LAUNCHER_DATA_ROOT ? path.resolve(process.env.APP_LAUNCHER_DATA_ROOT) : path.join(app.getPath("appData"), "App Launcher");
app.setPath("userData", DATA_ROOT);

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let db = null;
let apps = null;
let selfUpdate = null;
let bridge = null;
let mainWindow = null;

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".jpg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
};

function theme() {
  return db ? (db.getSetting("theme", "light") === "dark" ? "dark" : "light") : "light";
}

function broadcast(type, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("app-event", { type, payload });
  }
}

function insideDir(root, rel) {
  const abs = path.resolve(root, "." + path.sep + rel);
  return abs === path.resolve(root) || abs.startsWith(path.resolve(root) + path.sep) ? abs : null;
}

function respond(body, type, status, cache) {
  return new Response(body, { status: status || 200, headers: { "Content-Type": type, "Cache-Control": cache || "no-store" } });
}

async function serveFile(file, cache) {
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile()) return respond("Not found", "text/plain", 404);
    return respond(await fs.promises.readFile(file), MIME[path.extname(file).toLowerCase()] || "application/octet-stream", 200, cache);
  } catch {
    return respond("Not found", "text/plain", 404);
  }
}

function registerProtocols() {
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    if (url.host === "icons") {
      const file = iconFile(DATA_ROOT, decodeURIComponent(url.pathname.replace(/^\/+/, "")));
      // Icons only change when their file name changes, so the browser may keep them.
      return file ? serveFile(file, "max-age=86400") : respond("Not found", "text/plain", 404);
    }
    if (url.host !== "shell") return respond("Not found", "text/plain", 404);
    const file = insideDir(RENDERER, decodeURIComponent(url.pathname));
    return file ? serveFile(file) : respond("Not found", "text/plain", 404);
  });
}

// Icon URL for each card: a stored image, else the icon inside the exe (or
// the iconFrom file). Exe icons are pulled in the background, a few at a time,
// and cached. Only real icons are cached: a failed or empty extraction is
// retried (up to 3 times), and the window repaints when an icon lands.
const fileIcons = new Map(); // lower-case path -> data URL, only for icons that loaded
const pendingIcons = new Set();
const iconAttempts = new Map(); // lower-case path -> failed tries so far
const iconQueue = [];
let iconsRunning = 0;
const ICON_CONCURRENCY = 3;
const ICON_TRIES = 3;
const ICON_RETRY_MS = 4000;
let iconRepaint = null;

function repaintSoon() {
  if (!iconRepaint) {
    iconRepaint = setTimeout(() => {
      iconRepaint = null;
      broadcast("apps-changed");
    }, 50);
  }
}

function pumpIcons() {
  while (iconsRunning < ICON_CONCURRENCY && iconQueue.length) {
    const job = iconQueue.shift();
    iconsRunning += 1;
    Promise.resolve()
      .then(() => app.getFileIcon(job.file, { size: "large" }))
      .then((img) => (img && !img.isEmpty() ? img.toDataURL() : ""))
      .catch(() => "")
      .then((url) => {
        iconsRunning -= 1;
        pendingIcons.delete(job.key);
        if (url) {
          fileIcons.set(job.key, url);
          repaintSoon();
        } else {
          const tries = (iconAttempts.get(job.key) || 0) + 1;
          iconAttempts.set(job.key, tries);
          if (tries < ICON_TRIES) {
            // Try again later so the card fills in without a restart.
            setTimeout(() => repaintSoon(), ICON_RETRY_MS);
          }
        }
        pumpIcons();
      });
  }
}

function exeIcon(file) {
  if (!file) return "";
  const key = file.toLowerCase();
  if (fileIcons.has(key)) return fileIcons.get(key);
  const tries = iconAttempts.get(key) || 0;
  if (!pendingIcons.has(key) && tries < ICON_TRIES && fs.existsSync(file)) {
    pendingIcons.add(key);
    iconQueue.push({ key, file });
    pumpIcons();
  }
  return "";
}

function withIcons(list) {
  return list.map((a) => {
    let iconUrl = "";
    if (a.icon && iconFile(DATA_ROOT, a.icon)) iconUrl = "app://icons/" + encodeURIComponent(a.icon);
    else if (a.iconFrom) iconUrl = exeIcon(a.iconFrom);
    else if (a.kind === "app" || !a.kind) iconUrl = exeIcon(a.launch.exe);
    return Object.assign({}, a, { iconUrl });
  });
}

// Start Menu shortcut: electron.exe + this folder, with the app id and icon.
// Rewritten when it points somewhere else (the folder or Electron moved).
function ensureShortcut() {
  if (process.platform !== "win32" || process.env.APP_LAUNCHER_SMOKE || process.env.APP_LAUNCHER_DATA_ROOT || app.isPackaged) return;
  const lnk = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "App Launcher.lnk");
  const want = { target: process.execPath, args: '"' + APP_ROOT + '"', cwd: APP_ROOT, icon: APP_ICON, iconIndex: 0, appUserModelId: APP_ID, description: "One-click launcher for your apps, websites and commands" };
  try {
    const have = shell.readShortcutLink(lnk);
    if (have.target === want.target && have.args === want.args && have.appUserModelId === want.appUserModelId && have.icon === want.icon) return;
  } catch {
    /* no shortcut yet */
  }
  try {
    shell.writeShortcutLink(lnk, "create", want);
  } catch {
    /* Start Menu not writable; the app still runs */
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    title: "App Launcher",
    backgroundColor: theme() === "dark" ? "#1f2229" : "#f5f6f8",
    autoHideMenuBar: true,
    icon: fs.existsSync(APP_ICON) ? APP_ICON : undefined,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("app://shell/")) event.preventDefault();
  });
  mainWindow.loadURL(SHELL_URL);
  mainWindow.on("closed", () => (mainWindow = null));
}

async function confirm(message, detail, okLabel) {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const res = await dialog.showMessageBox(win, { type: "warning", buttons: [okLabel, "Cancel"], defaultId: 1, cancelId: 1, message, detail, noLink: true });
  return res.response === 0;
}

// Where agent settings files live. APP_LAUNCHER_HOME points tests at a scratch
// folder so they never touch the real Claude Code or Cursor settings.
function agentOpts() {
  return { store: db, serverPath: MCP_SERVER, execPath: process.execPath, home: process.env.APP_LAUNCHER_HOME || os.homedir() };
}

// The MCP tools. app_* run against the live registry and tell the window when
// they change it.
function callTool(name, args) {
  if (!APP_TOOLS.includes(name)) throw new Error("Unknown tool: " + name);
  return callAppTool(name, args || {}, { apps, appRoot: APP_ROOT, onChange: () => broadcast("apps-changed") });
}

// What any other MCP-capable agent needs to start the server by hand.
function serverCommand() {
  return { command: process.execPath, args: [MCP_SERVER], env: { ELECTRON_RUN_AS_NODE: "1" } };
}

// Keeps every connected agent pointing at this copy of App Launcher. Never
// runs in tests or smoke mode, which would otherwise write to the real settings.
function syncConnections() {
  if (process.env.APP_LAUNCHER_HOME || process.env.APP_LAUNCHER_SMOKE) return;
  try {
    syncAgents(agentOpts());
    broadcast("agents-changed");
  } catch {
    /* an agent settings file that is not valid JSON is left alone */
  }
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => fn(...args));
}

function registerIpc() {
  handle("app-info", () => ({ dataRoot: DATA_ROOT, version: app.getVersion(), theme: theme(), platform: process.platform }));
  handle("set-theme", (value) => {
    const next = value === "dark" ? "dark" : "light";
    db.setSetting("theme", next);
    for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(next === "dark" ? "#1f2229" : "#f5f6f8");
    broadcast("theme", next);
    return next;
  });

  handle("apps-list", () => withIcons(apps.list()));
  handle("apps-pick-icon", async () => {
    const res = await dialog.showOpenDialog(mainWindow, { title: "Choose an icon", properties: ["openFile"], filters: [{ name: "Images or programs", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "exe", "lnk"] }] });
    return res.canceled ? "" : res.filePaths[0];
  });
  handle("apps-pick-folder", async () => {
    const res = await dialog.showOpenDialog(mainWindow, { title: "Choose the folder the command runs in", properties: ["openDirectory"] });
    return res.canceled ? "" : res.filePaths[0];
  });
  handle("apps-add", async (body) => {
    const added = await apps.add(body);
    broadcast("apps-changed");
    return added;
  });
  handle("apps-update", async (body) => {
    const updated = await apps.update(body);
    broadcast("apps-changed");
    return updated;
  });
  handle("apps-remove", async (id) => {
    const found = apps.get(String(id));
    const ok = await confirm('Remove "' + found.name + '" from App Launcher?', "The program itself is not uninstalled.", "Remove");
    if (!ok) return false;
    apps.remove(found.id);
    broadcast("apps-changed");
    return true;
  });
  handle("apps-check", async (id) => {
    const result = id ? await apps.check(String(id)) : await apps.checkAll();
    broadcast("apps-changed");
    return result;
  });
  handle("apps-launch", (id) => apps.launch(String(id)));
  handle("apps-install-update", (id) => apps.installUpdate(String(id)));
  handle("self-update-state", () => selfUpdate.get());
  handle("self-update-check", () => selfUpdate.check());
  handle("self-update-install", () => selfUpdate.install());
  handle("apps-pick-exe", async () => {
    const res = await dialog.showOpenDialog(mainWindow, { title: "Choose the program to launch", properties: ["openFile"], filters: [{ name: "Programs", extensions: ["exe", "bat", "cmd", "lnk"] }] });
    return res.canceled ? "" : res.filePaths[0];
  });
  handle("open-external", async (url) => {
    if (!/^https:\/\/github\.com\//i.test(String(url))) throw new Error("Only github.com links open from here.");
    await shell.openExternal(String(url));
    return true;
  });

  handle("agents-list", () => ({ agents: listAgents(agentOpts()), server: serverCommand() }));
  handle("agents-connect", (id) => setConnected(String(id), true, agentOpts()));
  handle("agents-disconnect", (id) => setConnected(String(id), false, agentOpts()));
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  db = openDb(DATA_ROOT);
  apps = createApps({
    db,
    dataRoot: DATA_ROOT,
    openPath: (p) => shell.openPath(p),
    openExternal: (url) => shell.openExternal(url),
    confirmInstall: (message, detail, okLabel) => confirm(message, detail, okLabel),
  });
  selfUpdate = createSelfUpdate({
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    dataRoot: DATA_ROOT,
    quit: () => app.quit(),
    onChange: (state) => broadcast("self-update", state),
  });
  apps.seed();
  registerProtocols();
  registerIpc();
  bridge = await startBridge({ dataRoot: DATA_ROOT, callTool });
  syncConnections();
  if (process.env.APP_LAUNCHER_SMOKE) {
    const { runSmoke } = require("./smoke.cjs");
    const result = await runSmoke({ apps, db, dataRoot: DATA_ROOT, appRoot: APP_ROOT, shellUrl: SHELL_URL, preload: PRELOAD });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exitCode = result.ok ? 0 : 1;
    return app.quit();
  }
  ensureShortcut();
  createWindow();
  // An agent may have added apps straight to the database while the window
  // was closed or hidden; refresh when the window comes back.
  mainWindow.on("focus", () => {
    broadcast("apps-changed");
    syncConnections();
  });
  apps.checkAll().then(() => broadcast("apps-changed")).catch(() => {});
  // App Launcher's own updates: now, then every hour.
  selfUpdate.start();
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !process.env.APP_LAUNCHER_SMOKE) app.quit();
});

let quitting = false;
app.on("before-quit", (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  (async () => {
    try {
      if (bridge) bridge.close();
      if (db) db.close();
    } finally {
      app.exit(process.exitCode || 0);
    }
  })();
});
