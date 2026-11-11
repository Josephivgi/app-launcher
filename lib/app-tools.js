"use strict";

// The app_* MCP tools, shared by the running app (electron/agent-tools.cjs)
// and the stdio server when the app is closed (it then opens the SQLite file
// itself, so agents can add apps any time).

const fs = require("node:fs");
const path = require("node:path");

// Calls from an agent, so the registry applies the approval rules.
const AGENT = { by: "agent" };

const APP_TOOLS = ["launcher_guide", "app_list", "app_add", "app_update", "app_remove", "app_check", "app_launch"];

function text(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function fail(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

function summary(app) {
  return Object.assign({ section: app.section || "mine" }, summaryOf(app));
}

function summaryOf(app) {
  const c = app.check || {};
  const icon = app.icon ? "stored image " + app.icon : app.iconFrom ? "taken from " + app.iconFrom : app.kind === "app" || !app.kind ? "taken from the exe" : "none";
  if (app.kind === "website") {
    return { id: app.id, kind: "website", name: app.name, description: app.description, url: app.launch.url, browser: app.launch.browser || "default", browserFound: app.exeExists, icon };
  }
  if (app.kind === "command") {
    const l = app.launch;
    return { id: app.id, kind: "command", name: app.name, description: app.description, command: l.command, cwd: l.cwd || "(home folder)", shell: l.shell, terminal: l.terminal, folderFound: app.exeExists, icon, approved: app.trusted === true };
  }
  return {
    id: app.id, kind: "app", name: app.name, description: app.description, exe: app.launch.exe, exeExists: app.exeExists, args: app.launch.args, repo: app.repo, icon,
    versionSource: app.versionSource, installed: c.installed || "", latest: c.latest || "", installer: c.installer ? c.installer.name : "", approved: app.trusted === true, status: c.status || "unchecked", error: c.error || "", checkedAt: c.checkedAt || "",
  };
}

// apps: the createApps() registry. onChange: called after a write.
async function callAppTool(name, args, ctx) {
  const { apps, appRoot } = ctx;
  const changed = ctx.onChange || (() => {});
  const a = args || {};
  switch (name) {
    case "launcher_guide":
      return text(fs.readFileSync(path.join(appRoot, "docs", "agent-guide.md"), "utf8"));
    case "app_list":
      return text(apps.list().map(summary));
    case "app_add": {
      const app = await apps.add(a, AGENT);
      changed();
      return text(summary(app));
    }
    case "app_update": {
      const app = await apps.update(a, AGENT);
      changed();
      return text(summary(app));
    }
    case "app_remove":
      if (!apps.remove(String(a.id || ""))) return fail("No app named " + a.id + ".");
      changed();
      return text("Removed " + a.id + ".");
    case "app_check": {
      if (a.id) {
        const app = await apps.check(String(a.id));
        changed();
        return text(summary(app));
      }
      const all = await apps.checkAll();
      changed();
      return text(all.map(summary));
    }
    case "app_launch":
      return text(await apps.launch(String(a.id || ""), AGENT));
    default:
      return null;
  }
}

module.exports = { APP_TOOLS, callAppTool, summary, text, fail };
