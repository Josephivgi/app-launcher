#!/usr/bin/env node
"use strict";

// Stdio MCP server for agents. Claude Code, Cursor, Gemini CLI and Codex start
// it from their own MCP settings (lib/agent-connect.js writes those entries;
// Electron runs as Node via ELECTRON_RUN_AS_NODE). It answers initialize and
// tools/list itself and forwards tools/call to the running app over the
// loopback bridge described in <dataRoot>/bridge.json.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TOOLS } = require("./mcp-tools");
const { APP_TOOLS, callAppTool } = require("./app-tools");

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : "";
}

function defaultDataRoot() {
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "App Launcher");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "App Launcher");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "App Launcher");
}

const dataRoot = argValue("--data-root") || process.env.APP_LAUNCHER_DATA_ROOT || defaultDataRoot();

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function bridge() {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(dataRoot, "bridge.json"), "utf8"));
    if (info && info.url && info.token && info.pid && alive(info.pid)) return info;
  } catch {
    /* app not started */
  }
  return null;
}

// With the app closed, the app_* tools open the SQLite file themselves. The
// app reads it on its next start.
let direct = null;
function directApps() {
  if (direct) return direct;
  const { openDb } = require("./db");
  const { createApps } = require("./apps");
  const { spawn } = require("node:child_process");
  const open = (target) =>
    new Promise((resolve, reject) => {
      const child = spawn("explorer.exe", [target], { stdio: "ignore", detached: true });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve("");
      });
    });
  const db = openDb(dataRoot);
  direct = createApps({ db, dataRoot, openPath: open, openExternal: open });
  return direct;
}

async function callDirect(name, args) {
  return callAppTool(name, args, { apps: directApps(), appRoot: path.join(__dirname, "..") });
}

async function callApp(name, args) {
  const info = bridge();
  if (!info) {
    if (APP_TOOLS.includes(name)) return callDirect(name, args);
    throw new Error("App Launcher is not running. Open App Launcher and try again.");
  }
  let response;
  try {
    response = await fetch(info.url + "/tools/call", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + info.token, Connection: "close" },
      body: JSON.stringify({ name, arguments: args || {} }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    if (APP_TOOLS.includes(name) && error && error.cause && error.cause.code === "ECONNREFUSED") return callDirect(name, args);
    throw new Error("Could not reach App Launcher (" + (error.message || error) + "). Make sure the app is open.");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error((body && body.error) || "App Launcher answered HTTP " + response.status + ".");
  return body;
}

function write(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return {
      protocolVersion: (params && params.protocolVersion) || "2024-11-05",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "app-launcher", version: "0.1.0" },
      instructions: "App Launcher is the user's one-click launcher for apps, websites and shell commands, each with an icon. Call launcher_guide first. app_add takes kind app (exe), website (url) or command (a command line + cwd), plus icon: a full path to an image, an https:// image URL, or a data: URI. Look at the disk before adding: never guess paths. The app_* tools work even when the App Launcher window is closed.",
    };
  }
  if (method === "ping") return {};
  if (method === "tools/list") return { tools: TOOLS };
  if (method === "tools/call") {
    const name = params && params.name;
    if (!TOOLS.some((t) => t.name === name)) throw Object.assign(new Error("Unknown tool: " + name), { code: -32602 });
    try {
      return await callApp(name, params.arguments);
    } catch (error) {
      return { content: [{ type: "text", text: String(error.message || error) }], isError: true };
    }
  }
  if (id === undefined) return undefined;
  throw Object.assign(new Error("Method not found: " + method), { code: -32601 });
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    Promise.resolve(handle(msg)).then(
      (result) => {
        if (msg.id !== undefined && result !== undefined) write({ jsonrpc: "2.0", id: msg.id, result });
      },
      (error) => {
        if (msg.id !== undefined) write({ jsonrpc: "2.0", id: msg.id, error: { code: error.code || -32000, message: String(error.message || error) } });
      },
    );
  }
});
process.stdin.on("end", () => process.exit(0));
