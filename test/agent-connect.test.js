const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { listAgents, syncAgents, setConnected, statusOf } = require("../lib/agent-connect");

// An in-memory settings store with the same two methods as the app's db.
function memoryStore() {
  const data = new Map();
  return {
    getSetting: (key, fallback) => (data.has(key) ? JSON.parse(JSON.stringify(data.get(key))) : fallback),
    setSetting: (key, value) => data.set(key, JSON.parse(JSON.stringify(value))),
  };
}

function scratch(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "al-agent-home-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

const SERVER = path.join("C:", "Apps", "App Launcher", "lib", "mcp-stdio.cjs");

function opts(home, extra) {
  return Object.assign({ home, serverPath: SERVER, execPath: "C:\\Apps\\App Launcher\\App Launcher.exe", store: memoryStore() }, extra || {});
}

test("connect merges into Claude Code settings and keeps everything else", (t) => {
  const home = scratch(t);
  fs.mkdirSync(path.join(home, ".claude"));
  const file = path.join(home, ".claude.json");
  fs.writeFileSync(file, JSON.stringify({ numStartups: 4, mcpServers: { other: { type: "stdio", command: "x", args: [] } } }));
  const o = opts(home);
  assert.equal(statusOf({ id: "claude-code", file: ".claude.json", format: "json", key: "mcpServers" }, o), "missing");
  setConnected("claude-code", true, o);
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(doc.numStartups, 4);
  assert.equal(doc.mcpServers.other.command, "x");
  assert.equal(doc.mcpServers["app-launcher"].type, "stdio");
  assert.equal(doc.mcpServers["app-launcher"].args[0], SERVER);
  assert.equal(doc.mcpServers["app-launcher"].env.ELECTRON_RUN_AS_NODE, "1");
  assert.ok(fs.existsSync(file + ".app-launcher-backup"), "first change keeps a backup");
});

test("sync repairs a moved entry and leaves a current one alone", (t) => {
  const home = scratch(t);
  fs.mkdirSync(path.join(home, ".cursor"));
  const o = opts(home);
  setConnected("cursor", true, o);
  const file = path.join(home, ".cursor", "mcp.json");
  const moved = JSON.parse(fs.readFileSync(file, "utf8"));
  moved.mcpServers["app-launcher"].args = ["D:\\old\\mcp-stdio.cjs"];
  fs.writeFileSync(file, JSON.stringify(moved));
  const first = syncAgents(o);
  assert.ok(first.some((r) => r.id === "cursor" && r.to === "connected"));
  assert.deepEqual(syncAgents(o).filter((r) => r.id === "cursor"), [], "current entry is not rewritten");
});

test("first run connects every installed agent, and never creates a missing one", (t) => {
  const home = scratch(t);
  fs.mkdirSync(path.join(home, ".gemini"));
  const o = opts(home);
  syncAgents(o);
  assert.equal(statusOf({ id: "gemini", file: ".gemini/settings.json", format: "json", key: "mcpServers" }, o), "connected");
  assert.equal(fs.existsSync(path.join(home, ".cursor")), false, "missing agent folder is not created");
  assert.equal(fs.existsSync(path.join(home, ".cursor", "mcp.json")), false);
});

test("disconnect removes only our entry", (t) => {
  const home = scratch(t);
  fs.mkdirSync(path.join(home, ".claude"));
  const o = opts(home);
  setConnected("claude-code", true, o);
  setConnected("claude-code", false, o);
  const doc = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"));
  assert.equal(doc.mcpServers["app-launcher"], undefined);
});

test("Codex TOML: other tables kept, connect is idempotent, disconnect restores", (t) => {
  const home = scratch(t);
  fs.mkdirSync(path.join(home, ".codex"));
  const file = path.join(home, ".codex", "config.toml");
  fs.writeFileSync(file, 'model = "gpt"\n\n[mcp_servers.other]\ncommand = "x"\n');
  const o = opts(home);
  setConnected("codex", true, o);
  let text = fs.readFileSync(file, "utf8");
  assert.ok(text.includes("[mcp_servers.other]") && text.includes("[mcp_servers.app-launcher]") && text.includes("[mcp_servers.app-launcher.env]"));
  assert.equal(text.match(/\[mcp_servers\.app-launcher\]/g).length, 1);
  setConnected("codex", true, o);
  assert.equal(fs.readFileSync(file, "utf8").match(/\[mcp_servers\.app-launcher\]/g).length, 1);
  setConnected("codex", false, o);
  text = fs.readFileSync(file, "utf8");
  assert.ok(text.includes('[mcp_servers.other]') && !text.includes("app-launcher"));
});

test("an unreadable settings file is reported and never overwritten", (t) => {
  const home = scratch(t);
  fs.mkdirSync(path.join(home, ".claude"));
  const file = path.join(home, ".claude.json");
  fs.writeFileSync(file, "{ not json");
  const o = opts(home);
  const row = listAgents(o).find((a) => a.id === "claude-code");
  assert.equal(row.status, "unreadable");
  assert.throws(() => setConnected("claude-code", true, o));
  assert.equal(fs.readFileSync(file, "utf8"), "{ not json");
  syncAgents(o);
  assert.equal(fs.readFileSync(file, "utf8"), "{ not json", "sync leaves it alone too");
});
