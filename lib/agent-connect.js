"use strict";

// Connects App Launcher's MCP server to the AI agents on this computer by
// writing its entry into each agent's own MCP settings file, the same entry
// `claude mcp add --scope user` writes. No ACP: the agent starts the server
// itself the next time it runs. Entries are kept current: on every start and
// window focus the entry is rewritten if it is missing or points somewhere
// else (the app moved, or was updated into a new folder).

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writeAtomic } = require("./paths");

const SERVER_NAME = "app-launcher";
const CONNECTIONS_KEY = "agent-connections";
const SEEDED_KEY = "agent-connect-seeded";

// file: the agent's MCP settings, relative to the home folder. dir: the
// agent's own folder, which says it is installed here.
const AGENTS = [
  { id: "claude-code", name: "Claude Code", dir: ".claude", file: ".claude.json", format: "json", key: "mcpServers", typed: true },
  { id: "cursor", name: "Cursor", dir: ".cursor", file: ".cursor/mcp.json", format: "json", key: "mcpServers" },
  { id: "gemini", name: "Gemini CLI", dir: ".gemini", file: ".gemini/settings.json", format: "json", key: "mcpServers" },
  { id: "codex", name: "Codex", dir: ".codex", file: ".codex/config.toml", format: "toml" },
];

function findAgent(id) {
  const agent = AGENTS.find((a) => a.id === id);
  if (!agent) throw new Error("Unknown agent: " + id);
  return agent;
}

// What the agent runs. Electron runs as plain Node here, so the server works
// without Node on PATH and follows the app to wherever it is installed.
function serverSpec(opts) {
  return { command: opts.execPath || process.execPath, args: [opts.serverPath], env: { ELECTRON_RUN_AS_NODE: "1" } };
}

function homeOf(opts) {
  return opts.home || os.homedir();
}

function installed(agent, opts) {
  return fs.existsSync(path.join(homeOf(opts), agent.dir));
}

// ---- JSON agents (Claude Code, Cursor, Gemini CLI) ----

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, "utf8");
  if (!text.trim()) return {};
  const doc = JSON.parse(text);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("Not a JSON object");
  return doc;
}

function jsonEntry(agent, spec) {
  const entry = { command: spec.command, args: spec.args, env: spec.env };
  return agent.typed ? Object.assign({ type: "stdio" }, entry) : entry;
}

// ---- TOML agent (Codex): one [mcp_servers.app-launcher] table ----

const TOML_TABLE = /^\s*\[/;
const OWN_TABLE = /^\s*\[mcp_servers\.app-launcher(\.[^\]]*)?\]\s*$/;

function quote(value) {
  // JSON string syntax is valid TOML basic-string syntax.
  return JSON.stringify(String(value));
}

function tomlSection(spec) {
  return [
    "[mcp_servers." + SERVER_NAME + "]",
    "command = " + quote(spec.command),
    "args = [" + spec.args.map(quote).join(", ") + "]",
    "",
    "[mcp_servers." + SERVER_NAME + ".env]",
    "ELECTRON_RUN_AS_NODE = " + quote("1"),
  ].join("\n");
}

function stripTomlSection(text) {
  const out = [];
  let skipping = false;
  for (const line of text.split("\n")) {
    if (TOML_TABLE.test(line)) skipping = OWN_TABLE.test(line);
    if (!skipping) out.push(line);
  }
  return out.join("\n").replace(/\s+$/, "");
}

function tomlOwnText(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => OWN_TABLE.test(l));
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const next = rest.findIndex((l) => TOML_TABLE.test(l) && !OWN_TABLE.test(l));
  return lines.slice(start, next < 0 ? undefined : start + 1 + next).join("\n");
}

// ---- shared ----

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

// The first time App Launcher changes an agent's settings file, keep a copy
// of the original next to it.
function backupOnce(file) {
  const backup = file + ".app-launcher-backup";
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
}

// "connected": our entry points at this app's server. "outdated": an entry
// exists but points elsewhere. "missing": no entry. "unreadable": the file
// is not valid JSON or TOML, so it is left alone.
function statusOf(agent, opts) {
  const file = path.join(homeOf(opts), agent.file);
  const spec = serverSpec(opts);
  try {
    if (agent.format === "toml") {
      const own = tomlOwnText(readText(file));
      if (!own) return "missing";
      return own.includes(quote(spec.command)) && own.includes(quote(spec.args[0])) ? "connected" : "outdated";
    }
    const doc = readJson(file);
    const entry = doc[agent.key] && doc[agent.key][SERVER_NAME];
    if (!entry) return "missing";
    const ok = entry.command === spec.command && Array.isArray(entry.args) && entry.args[0] === spec.args[0];
    return ok ? "connected" : "outdated";
  } catch {
    return "unreadable";
  }
}

function connectAgent(id, opts) {
  const agent = findAgent(id);
  if (!installed(agent, opts)) throw new Error(agent.name + " is not installed on this computer.");
  const file = path.join(homeOf(opts), agent.file);
  const spec = serverSpec(opts);
  if (agent.format === "toml") {
    const text = readText(file);
    const next = stripTomlSection(text);
    backupOnce(file);
    writeAtomic(file, (next ? next + "\n\n" : "") + tomlSection(spec) + "\n");
  } else {
    const doc = readJson(file);
    if (!doc[agent.key] || typeof doc[agent.key] !== "object" || Array.isArray(doc[agent.key])) doc[agent.key] = {};
    doc[agent.key][SERVER_NAME] = jsonEntry(agent, spec);
    backupOnce(file);
    writeAtomic(file, JSON.stringify(doc, null, 2) + "\n");
  }
  return statusOf(agent, opts);
}

function disconnectAgent(id, opts) {
  const agent = findAgent(id);
  const file = path.join(homeOf(opts), agent.file);
  if (!fs.existsSync(file)) return "missing";
  if (agent.format === "toml") {
    const text = readText(file);
    if (!tomlOwnText(text)) return "missing";
    backupOnce(file);
    writeAtomic(file, stripTomlSection(text) + "\n");
  } else {
    const doc = readJson(file);
    if (!doc[agent.key] || !doc[agent.key][SERVER_NAME]) return "missing";
    delete doc[agent.key][SERVER_NAME];
    backupOnce(file);
    writeAtomic(file, JSON.stringify(doc, null, 2) + "\n");
  }
  return "missing";
}

// Every supported agent with what it has now. Used by the Agents page.
function listAgents(opts) {
  return AGENTS.map((agent) => ({
    id: agent.id,
    name: agent.name,
    installed: installed(agent, opts),
    status: statusOf(agent, opts),
    configPath: path.join(homeOf(opts), agent.file),
  }));
}

// Runs on start and on window focus. Agents the user connected get their
// entry rewritten if it went missing or moved. On the first run, every agent
// found on this computer is connected. Agents that are not installed are
// never created: a missing agent folder means nothing to write into.
function syncAgents(opts) {
  const store = opts.store;
  const connections = store.getSetting(CONNECTIONS_KEY, {});
  if (!store.getSetting(SEEDED_KEY, false)) {
    for (const agent of AGENTS) {
      if (installed(agent, opts) && connections[agent.id] === undefined) connections[agent.id] = true;
    }
    store.setSetting(CONNECTIONS_KEY, connections);
    store.setSetting(SEEDED_KEY, true);
  }
  const results = [];
  for (const agent of AGENTS) {
    if (connections[agent.id] !== true || !installed(agent, opts)) continue;
    try {
      const before = statusOf(agent, opts);
      if (before === "connected") continue;
      const after = connectAgent(agent.id, opts);
      results.push({ id: agent.id, from: before, to: after });
    } catch (error) {
      results.push({ id: agent.id, error: String(error && error.message ? error.message : error) });
    }
  }
  return results;
}

// The user's connect/disconnect choice, kept so the sync knows what to keep.
function setConnected(id, connected, opts) {
  const agent = findAgent(id);
  // Write the agent first: if it fails (not installed, unreadable file) the
  // saved choice stays as it was.
  const status = connected ? connectAgent(agent.id, opts) : disconnectAgent(agent.id, opts);
  const connections = opts.store.getSetting(CONNECTIONS_KEY, {});
  connections[agent.id] = connected;
  opts.store.setSetting(CONNECTIONS_KEY, connections);
  return status;
}

module.exports = { AGENTS, SERVER_NAME, listAgents, syncAgents, setConnected, connectAgent, disconnectAgent, statusOf };
