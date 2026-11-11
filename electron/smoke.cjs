"use strict";

// In-app smoke against a temp data root (APP_LAUNCHER_DATA_ROOT): seeded app,
// version check, the stdio MCP path an agent takes, and an off-screen render.

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { BrowserWindow } = require("electron");
const { listAgents, setConnected, syncAgents } = require("../lib/agent-connect");

// Runs a stdio MCP server the way an agent does and returns its replies.
function mcpRun(command, args, env, messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true });
    let out = "";
    const timer = setTimeout(() => child.kill(), 30_000);
    // Only whole lines parse; a chunk can end mid-reply.
    const replies = () => out.split("\n").slice(0, -1).filter(Boolean).map((l) => JSON.parse(l));
    // The proxy exits when stdin closes, so keep it open until every reply is in.
    child.stdout.on("data", (c) => {
      out += c;
      if (replies().length >= messages.length) child.stdin.end();
    });
    child.on("error", reject);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve(replies());
    });
    for (const m of messages) child.stdin.write(JSON.stringify(m) + "\n");
  });
}

function mcpCall(dataRoot, appRoot, messages) {
  const env = Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: "1", APP_LAUNCHER_DATA_ROOT: dataRoot });
  return mcpRun(process.execPath, [path.join(appRoot, "lib", "mcp-stdio.cjs"), "--data-root", dataRoot], env, messages);
}

// The server a settings entry starts, with that entry's own command and env.
function mcpFromEntry(entry, messages) {
  const env = Object.assign({}, process.env, entry.env || {});
  return mcpRun(entry.command, entry.args || [], env, messages);
}

// 16x16 solid accent square.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGPIC7hDEmIY1TCqYfhqAACJzZoQDZ9zzwAAAABJRU5ErkJggg==";

async function runSmoke(ctx) {
  const { apps, dataRoot, appRoot, shellUrl, preload } = ctx;
  const steps = [];
  const step = async (name, fn) => {
    try {
      const detail = await fn();
      steps.push({ name, ok: true, detail: detail === undefined ? "" : detail });
    } catch (error) {
      steps.push({ name, ok: false, detail: String(error && error.message ? error.message : error) });
    }
  };
  const expect = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };

  await step("seeded Simple Recorder", () => {
    const list = apps.list();
    expect(list.some((a) => a.id === "simple-recorder"), "simple-recorder missing");
    return list.map((a) => a.id).join(",");
  });

  await step("version check reads install + GitHub", async () => {
    const app = await apps.check("simple-recorder");
    const c = app.check;
    if (c.status === "error") return "GitHub unreachable here: " + c.error;
    expect(c.latest, "no latest version");
    return "installed=" + c.installed + " latest=" + c.latest + " status=" + c.status;
  });

  await step("agent adds an app over stdio MCP", async () => {
    const exe = process.execPath;
    const out = await mcpCall(dataRoot, appRoot, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "app_add", arguments: { name: "Smoke Probe", exe, versionSource: { type: "manual", value: "1.0.0" } } } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "app_list", arguments: {} } },
    ]);
    const r2 = out.find((m) => m.id === 2);
    expect(r2, "no tools/list reply; got " + JSON.stringify(out).slice(0, 400));
    const tools = r2.result.tools.map((t) => t.name);
    expect(tools.includes("app_add") && tools.includes("app_launch") && !tools.some((t) => /^(chat|agent|mcp)_/.test(t)), "tool list incomplete");
    const r3 = out.find((m) => m.id === 3);
    expect(r3 && r3.result, "ids " + out.map((m) => m.id).join(",") + " " + JSON.stringify(out.filter((m) => m.id > 2)).slice(0, 600));
    const added = r3.result;
    expect(!added.isError, added.content[0].text);
    expect(apps.list().some((a) => a.id === "smoke-probe"), "app not in registry");
    apps.remove("smoke-probe");
    return tools.length + " tools";
  });

  // A console exe launched for real would open a window on the desktop, so
  // the launch path is exercised with a hidden command that leaves a file.
  await step("agent adds a command with an icon over MCP and runs it hidden", async () => {
    const work = path.join(dataRoot, "cmd-work");
    fs.mkdirSync(work, { recursive: true });
    const marker = path.join(work, "ran.txt");
    const out = await mcpCall(dataRoot, appRoot, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "app_add", arguments: { name: "Smoke Cmd", command: "echo ran from smoke> ran.txt", cwd: work, terminal: false, icon: "data:image/png;base64," + PNG } } },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "app_launch", arguments: { id: "smoke-cmd" } } },
    ]);
    const r2 = out.find((m) => m.id === 2);
    expect(r2 && r2.result && !r2.result.isError, JSON.stringify(out).slice(0, 400));
    // An agent-added command must not run until the person approves it.
    const r3 = out.find((m) => m.id === 3);
    expect(r3 && r3.result && r3.result.isError && /not been approved/.test(r3.result.content[0].text), "agent launch was not refused: " + JSON.stringify(out).slice(0, 400));
    expect(!fs.existsSync(marker), "unapproved command ran");
    // Stands in for the person clicking Run and remember in the window.
    apps.approve("smoke-cmd");
    const again = await mcpCall(dataRoot, appRoot, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "app_launch", arguments: { id: "smoke-cmd" } } },
    ]);
    const r4 = again.find((m) => m.id === 2);
    expect(r4 && r4.result && !r4.result.isError, "approved launch failed: " + JSON.stringify(again).slice(0, 400));
    for (let i = 0; i < 40 && !fs.existsSync(marker); i++) await new Promise((r) => setTimeout(r, 250));
    expect(fs.existsSync(marker), "command did not run");
    const stored = apps.get("smoke-cmd");
    expect(stored.icon && fs.existsSync(path.join(dataRoot, "icons", stored.icon)), "icon not stored");
    return "icon " + stored.icon + ", output " + fs.readFileSync(marker, "utf8").trim();
  });

  await step("agent adds a website over stdio MCP", async () => {
    const out = await mcpCall(dataRoot, appRoot, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "app_add", arguments: { name: "Smoke Site", url: "jsystems.app/discord" } } },
    ]);
    const r = out.find((m) => m.id === 2);
    expect(r && r.result && !r.result.isError, JSON.stringify(out).slice(0, 400));
    const site = apps.get("smoke-site");
    expect(site.kind === "website" && site.launch.url === "https://jsystems.app/discord", "stored as " + JSON.stringify(site));
    apps.remove("smoke-site");
    return r.result.content[0].text.slice(0, 160);
  });

  // Opens a real browser tab. APP_LAUNCHER_SMOKE_NO_BROWSER=1 skips it.
  if (!process.env.APP_LAUNCHER_SMOKE_NO_BROWSER) {
    await step("opens a website in the default browser", async () => {
      await apps.add({ name: "Open Probe", url: "https://jsystems.app/discord" });
      const res = await apps.launch("open-probe");
      apps.remove("open-probe");
      expect(res.browser === "default" && res.url === "https://jsystems.app/discord", JSON.stringify(res));
      return JSON.stringify(res);
    });

    await step("opens a website in a chosen browser", async () => {
      const pf = [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter(Boolean);
      const candidates = pf.flatMap((d) => [path.join(d, "Microsoft", "Edge", "Application", "msedge.exe"), path.join(d, "Google", "Chrome", "Application", "chrome.exe")]);
      const browser = candidates.find((p) => fs.existsSync(p));
      if (!browser) return "no Edge or Chrome found, skipped";
      await apps.add({ name: "Browser Probe", url: "https://jsystems.app/", browser });
      const res = await apps.launch("browser-probe");
      apps.remove("browser-probe");
      expect(res.pid > 0 && res.browser === browser, JSON.stringify(res));
      return browser + " pid " + res.pid;
    });
  }

  await step("rejects bad input", async () => {
    let msg = "";
    await apps.add({ name: "Bad", exe: "relative.exe" }).catch((e) => (msg = e.message));
    expect(/full path/.test(msg), "relative exe accepted");
    await apps.add({ name: "Bad2", exe: process.execPath, repo: "not a repo" }).catch((e) => (msg = e.message));
    expect(/owner\/name/.test(msg), "bad repo accepted");
    await apps.add({ name: "Bad3", url: "file:///C:/Windows/System32/calc.exe" }).catch((e) => (msg = e.message));
    expect(/https:\/\/ or http:\/\//.test(msg), "file URL accepted");
    await apps.add({ name: "Bad4", url: "javascript:alert(1)" }).catch((e) => (msg = e.message));
    expect(/https:\/\/ or http:\/\//.test(msg), "javascript URL accepted");
  });

  // Claude Code, Cursor, Gemini CLI and Codex are connected by writing their
  // MCP settings. Everything runs against a scratch home folder, never the real one.
  await step("connects Claude Code: entry merged, starts the server, repaired after a move, removed", async () => {
    const home = path.join(dataRoot, "fake-home");
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    const settings = path.join(home, ".claude.json");
    fs.writeFileSync(settings, JSON.stringify({ numStartups: 7, mcpServers: { other: { type: "stdio", command: "x", args: [] } } }));
    const serverPath = path.join(appRoot, "lib", "mcp-stdio.cjs");
    const opts = { home, serverPath, execPath: process.execPath, store: ctx.db };
    const before = listAgents(opts).find((a) => a.id === "claude-code");
    expect(before.installed && before.status === "missing", "start state " + JSON.stringify(before));
    setConnected("claude-code", true, opts);
    let doc = JSON.parse(fs.readFileSync(settings, "utf8"));
    expect(doc.numStartups === 7 && doc.mcpServers.other && doc.mcpServers["app-launcher"], "settings not merged");
    const entry = doc.mcpServers["app-launcher"];
    expect(entry.type === "stdio" && entry.args[0] === serverPath, "entry " + JSON.stringify(entry));
    const out = await mcpFromEntry(entry, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);
    const r2 = out.find((m) => m.id === 2);
    expect(r2 && r2.result.tools.some((t) => t.name === "app_add"), "entry does not start the server: " + JSON.stringify(out).slice(0, 300));
    doc.mcpServers["app-launcher"].args = [path.join(dataRoot, "old-place", "mcp-stdio.cjs")];
    fs.writeFileSync(settings, JSON.stringify(doc));
    const repaired = syncAgents(opts);
    expect(repaired.some((r) => r.id === "claude-code" && r.to === "connected"), "sync did not repair: " + JSON.stringify(repaired));
    doc = JSON.parse(fs.readFileSync(settings, "utf8"));
    expect(doc.mcpServers["app-launcher"].args[0] === serverPath, "entry not repaired");
    setConnected("claude-code", false, opts);
    doc = JSON.parse(fs.readFileSync(settings, "utf8"));
    expect(!doc.mcpServers["app-launcher"] && doc.mcpServers.other && doc.numStartups === 7, "disconnect wrong");
    return "entry starts the server (" + r2.result.tools.length + " tools), moved path repaired, disconnected";
  });

  await step("connects Codex TOML: other tables kept, idempotent, removed", async () => {
    const home = path.join(dataRoot, "fake-codex-home");
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
    const file = path.join(home, ".codex", "config.toml");
    fs.writeFileSync(file, 'model = "gpt"\n\n[mcp_servers.other]\ncommand = "x"\n');
    const serverPath = path.join(appRoot, "lib", "mcp-stdio.cjs");
    const opts = { home, serverPath, execPath: process.execPath, store: ctx.db };
    setConnected("codex", true, opts);
    let text = fs.readFileSync(file, "utf8");
    expect(text.includes("[mcp_servers.other]") && text.includes("[mcp_servers.app-launcher]") && text.includes("[mcp_servers.app-launcher.env]"), "toml not written: " + text);
    const again = syncAgents(opts);
    expect(!again.some((r) => r.id === "codex"), "sync rewrote a current entry");
    setConnected("codex", false, opts);
    text = fs.readFileSync(file, "utf8");
    expect(text.includes("[mcp_servers.other]") && !text.includes("app-launcher"), "toml not restored: " + text);
    return "toml ok";
  });

  await step("UI shows icon cards and one click runs a command", async () => {
    const win = new BrowserWindow({ width: 1100, height: 760, show: false, useContentSize: true, webPreferences: { preload, offscreen: true, contextIsolation: true, sandbox: true, nodeIntegration: false } });
    const js = (code) => win.webContents.executeJavaScript(code);
    const consoleLines = [];
    win.webContents.on("console-message", (e) => consoleLines.push(String(e.message || "").slice(0, 200)));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      const work = path.join(dataRoot, "ui-work");
      fs.mkdirSync(work, { recursive: true });
      const marker = path.join(work, "clicked.txt");
      await apps.add({ name: "JSystems", description: "Product site", url: "https://jsystems.app" });
      // Added as the person in the window, so no approval prompt blocks the click.
      await apps.add({ name: "Click Cmd", command: "echo clicked> clicked.txt", cwd: work, terminal: false, icon: "data:image/png;base64," + PNG }, { by: "user" });
      await win.loadURL(shellUrl);
      // Exe icons load in the background and the grid repaints when each one lands.
      // Poll until every exe app card has its icon, and report how long that took.
      const exeIds = apps.list().filter((a) => a.kind === "app" && a.exeExists).map((a) => a.id);
      const iconStart = Date.now();
      const cardCount = apps.list().length;
      let missing = exeIds;
      while (Date.now() - iconStart < 30000) {
        const state = JSON.parse(await js('(() => { const cs = [...document.querySelectorAll(".card")]; return JSON.stringify({ total: cs.length, noIcon: cs.filter((c) => !c.querySelector(".card-icon img")).map((c) => c.dataset.app), loading: cs.filter((c) => { const i = c.querySelector(".card-icon img"); return i && !(i.complete && i.naturalWidth > 0); }).map((c) => c.dataset.app) }); })()'));
        missing = state.noIcon.filter((id) => exeIds.includes(id)).concat(state.loading);
        // The grid renders after the window loads: wait until every app has a card.
        if (!missing.length && state.total >= cardCount) break;
        if (state.total < cardCount) missing = ["grid has " + state.total + " of " + cardCount + " cards"];
        await wait(200);
      }
      const iconMs = Date.now() - iconStart;
      if (missing.length) {
        const states = await js('(() => [...document.querySelectorAll(".card")].filter((c) => { const i = c.querySelector(".card-icon img"); return i && !(i.complete && i.naturalWidth > 0); }).slice(0, 4).map((c) => { const i = c.querySelector(".card-icon img"); return c.dataset.app + " complete=" + i.complete + " w=" + i.naturalWidth + " " + i.src; }).join(" | "))()');
        expect(false, "icons still missing after 30 s: " + missing.join(", ") + " states: " + states);
      }
      const cards =await js('[...document.querySelectorAll(".card")].map((c) => ({ id: c.dataset.app, name: c.querySelector(".card-name").textContent, img: (c.querySelector(".card-icon img") || {}).naturalWidth || 0, src: ((c.querySelector(".card-icon img") || {}).src || "").slice(0, 40) }))');
      const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
      expect(byId["jsystems"] && byId["click-cmd"], "cards missing: " + JSON.stringify(cards) + " console: " + consoleLines.join(" | ") + " body: " + (await js("document.body.innerText")).slice(0, 200));
      if (!(byId["click-cmd"].img === 16 && byId["click-cmd"].src.startsWith("app://icons/"))) {
        const dbg = await js('[...document.querySelectorAll(".card")].map((c) => { const i = c.querySelector(".card-icon img"); return i ? c.dataset.app + ":" + i.complete + ":" + i.naturalWidth + ":" + (i.currentSrc || "").slice(0, 40) : c.dataset.app + ":noimg"; }).join(" | ")');
        expect(false, "stored icon not shown: " + JSON.stringify(byId["click-cmd"]) + " cards " + dbg);
      }
      const shot = process.env.APP_LAUNCHER_SHOT;
      if (shot) fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
      await js('document.querySelector("[data-app=click-cmd] .card-open").click()');
      for (let i = 0; i < 40 && !fs.existsSync(marker); i++) await wait(250);
      expect(fs.existsSync(marker), "clicking the card did not run the command");
      await js('document.querySelector("[data-act=add][data-kind=command]").click()');
      await wait(300);
      const form = await js('(() => { const f = document.querySelector("[data-form]"); return { kind: f.elements.kind.value, cmdShown: !f.elements.command.closest("label").hidden, exeHidden: f.elements.exe.closest("label").hidden, icon: !!f.elements.icon, title: f.querySelector("h2").textContent }; })()');
      expect(form.kind === "command" && form.cmdShown && form.exeHidden && form.icon && form.title === "Add a command", "command form wrong: " + JSON.stringify(form));
      if (shot) fs.writeFileSync(shot.replace(/\.png$/i, "-command-form.png"), (await win.webContents.capturePage()).toPNG());
      await js('document.querySelector("[data-act=cancel]").click()');
      apps.remove("jsystems");
      apps.remove("click-cmd");
      await js('document.querySelector("[data-nav=agents]").click()');
      await wait(900);
      const agentsText = await js("document.body.innerText");
      expect(/Claude Code/.test(agentsText), "agents page missing: " + agentsText.slice(0, 200));
      if (shot) fs.writeFileSync(shot.replace(/\.png$/i, "-agents.png"), (await win.webContents.capturePage()).toPNG());
      return "exe icons in " + iconMs + " ms; " + cards.map((c) => c.id + (c.img ? " (icon " + c.img + "px)" : "")).join(", ");
    } finally {
      win.destroy();
    }
  });

  return { ok: steps.every((s) => s.ok), steps };
}

module.exports = { runSmoke };
