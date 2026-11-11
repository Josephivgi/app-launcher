import { esc, icon, toast, errorText, monogram } from "./util.js";

let view = null; // { main, ctx, apps, editing, newKind, checking, filter }

// Healthy states are plain text; only problems get a label that stands out.
const STATUS = {
  current: "",
  update: "",
  ahead: "Newer than GitHub",
  unknown: "Version unknown",
  error: "Check failed",
  "no-repo": "",
  unchecked: "",
};

export function onAppsChanged() {
  if (!view) return;
  const local = view;
  local.ctx.shell.apps.list().then((apps) => {
    if (view !== local) return;
    view.apps = apps;
    paint();
  });
}

function host(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function fallbackGlyph(app) {
  if (app.kind === "website") return '<span class="glyph">' + icon("globe") + "</span>";
  if (app.kind === "command") return '<span class="glyph">' + icon("terminal") + "</span>";
  return '<span class="mono">' + monogram(app.name) + "</span>";
}

function cardIcon(app) {
  return app.iconUrl ? '<img src="' + esc(app.iconUrl) + '" alt="" draggable="false">' : fallbackGlyph(app);
}

// One short line under the name, and an optional problem line.
function cardLines(app) {
  if (app.kind === "website") {
    return { sub: esc(host(app.launch.url)), problem: app.exeExists ? "" : "Browser not found" };
  }
  if (app.kind === "command") {
    const problem = !app.exeExists ? "Folder not found" : app.trusted ? "" : "Needs your approval";
    return { sub: '<code>' + esc(app.launch.command.split(/\r?\n/)[0]) + "</code>", problem };
  }
  const c = app.check || {};
  if (!app.exeExists) return { sub: "", problem: "Program not found" };
  if (view.checking.has(app.id)) return { sub: "Checking…", problem: "" };
  const sub = c.installed ? "v" + esc(c.installed) : "";
  // An agent-added program asks once, on its first launch.
  if (!app.trusted) return { sub, problem: "Needs your approval" };
  return { sub, problem: STATUS[c.status || "unchecked"] || "" };
}

function cardTitle(app) {
  if (app.kind === "website") return app.launch.url;
  if (app.kind === "command") return app.launch.command + (app.launch.cwd ? "\nin " + app.launch.cwd : "");
  return app.launch.exe;
}

function cardMarkup(app) {
  const c = app.check || {};
  const { sub, problem } = cardLines(app);
  const ready = app.exeExists;
  const verb = app.kind === "website" ? "Open" : app.kind === "command" ? "Run" : "Launch";
  return (
    '<div class="card' + (ready ? "" : " missing") + '" data-app="' + esc(app.id) + '">' +
    '<button class="card-open" data-act="launch" title="' + esc(verb + " " + app.name + "\n" + cardTitle(app)) + '"' + (ready ? "" : " disabled") + ">" +
    '<span class="card-icon">' + cardIcon(app) + "</span>" +
    '<span class="card-name">' + esc(app.name) + "</span>" +
    (sub ? '<span class="card-sub">' + sub + "</span>" : "") +
    (problem ? '<span class="card-problem">' + icon("alert") + esc(problem) + "</span>" : "") +
    "</button>" +
    (c.status === "update" && app.kind === "app" && c.installer
      ? '<button class="card-update" data-act="install" title="Download ' + esc(c.installer.name) + " from GitHub and open it\"" + (view.installing.has(app.id) ? " disabled" : "") + ">" +
        (view.installing.has(app.id) ? "Downloading…" : "Update to " + esc(c.latest)) + "</button>"
      : c.status === "update" && c.latestUrl
        ? '<button class="card-update" data-act="release" data-url="' + esc(c.latestUrl) + '" title="Open the ' + esc(c.latest) + ' release on GitHub">Update to ' + esc(c.latest) + "</button>"
        : "") +
    '<div class="card-tools">' +
    (app.kind === "app" || !app.kind ? '<button class="tool" data-act="check" title="Check GitHub for a newer version">' + icon("reload") + "</button>" : "") +
    '<button class="tool" data-act="edit" title="Edit">' + icon("edit") + "</button>" +
    '<button class="tool danger" data-act="remove" title="Remove from launcher">' + icon("trash") + "</button>" +
    "</div></div>"
  );
}

const KIND_LABEL = { app: "App on this PC", website: "Website", command: "Command" };

// The two choices for where a card sits.
function sectionOptions(app) {
  const external = Boolean(app && app.section === "external");
  return '<option value="mine"' + (external ? "" : " selected") + '>My apps</option>' +
    '<option value="external"' + (external ? " selected" : "") + '>External</option>';
}

function formMarkup(app, newKind) {
  const kind = app ? app.kind || "app" : newKind || "app";
  const blank = { launch: { exe: "", args: [], url: "", browser: "", command: "", cwd: "", shell: "cmd", terminal: true }, versionSource: { type: "json", path: "", key: "version" } };
  const a = app || blank;
  const l = Object.assign({}, blank.launch, a.launch);
  const vs = a.versionSource || { type: "manual" };
  const title = app ? "Edit " + esc(app.name) : { app: "Add an app", website: "Add a website", command: "Add a command" }[kind];
  const preview = app && app.iconUrl ? '<img src="' + esc(app.iconUrl) + '" alt="">' : fallbackGlyph(a.name ? a : { kind, name: "?" });
  return (
    '<form class="app-form panel" data-form>' +
    "<h2>" + title + "</h2>" +
    '<div class="form-grid">' +
    '<label class="field">Type<select class="select" name="kind">' +
    Object.keys(KIND_LABEL).map((k) => '<option value="' + k + '"' + (kind === k ? " selected" : "") + ">" + KIND_LABEL[k] + "</option>").join("") +
    "</select></label>" +
    '<label class="field">Section<select class="select" name="section">' + sectionOptions(app) + '</select></label>' +
    '<label class="field">Name<input class="input" name="name" required value="' + esc(a.name || "") + '"></label>' +
    // Icon, all kinds
    '<div class="field wide icon-field"><span>Icon</span><div class="icon-row"><span class="icon-preview" data-icon-preview>' + preview + "</span>" +
    '<input class="input" name="icon" placeholder="' + (app && (app.icon || app.iconFrom) ? "Keep the current icon, or paste a new image path or URL" : "Image file path or https:// image URL (optional)") + '">' +
    '<button type="button" class="btn secondary" data-act="pick-icon">Browse</button>' +
    (app && (app.icon || app.iconFrom) ? '<button type="button" class="btn ghost" data-act="clear-icon">Remove icon</button>' : "") +
    '<input type="hidden" name="clearIcon" value=""></div></div>' +
    // Website
    '<label class="field wide" data-k="website">Website address<input class="input" name="url" placeholder="https://example.com" value="' + esc(l.url || "") + '"></label>' +
    '<label class="field wide" data-k="website">Browser (leave empty for your default browser)<span class="pick"><input class="input" name="browser" placeholder="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" value="' + esc(l.browser || "") + '"><button type="button" class="btn secondary" data-act="pick-browser">Browse</button></span></label>' +
    // Command
    '<label class="field wide" data-k="command">Command<textarea class="textarea mono-input" name="command" rows="2" placeholder="npm run dev">' + esc(l.command || "") + "</textarea></label>" +
    '<label class="field wide" data-k="command">Run in folder (leave empty for your home folder)<span class="pick"><input class="input" name="cwd" placeholder="C:\\Users\\you\\project" value="' + esc(kind === "command" ? l.cwd || "" : "") + '"><button type="button" class="btn secondary" data-act="pick-folder">Browse</button></span></label>' +
    '<label class="field" data-k="command">Shell<select class="select" name="shell"><option value="cmd"' + (l.shell !== "powershell" ? " selected" : "") + '>Command Prompt</option><option value="powershell"' + (l.shell === "powershell" ? " selected" : "") + ">PowerShell</option></select></label>" +
    '<label class="field check" data-k="command"><input type="checkbox" name="terminal"' + (l.terminal !== false ? " checked" : "") + "> Show a terminal window with the output</label>" +
    // App
    '<label class="field wide" data-k="app">Program<span class="pick"><input class="input" name="exe" placeholder="C:\\Path\\To\\App.exe" value="' + esc(l.exe || "") + '"><button type="button" class="btn secondary" data-act="pick">Browse</button></span></label>' +
    '<label class="field" data-k="app">GitHub repo<input class="input" name="repo" placeholder="owner/name" value="' + esc(a.repo || "") + '"></label>' +
    '<label class="field" data-k="app">Installed version from<select class="select" name="vtype">' +
    ["json", "text", "exe", "manual"].map((t) => '<option value="' + t + '"' + (vs.type === t ? " selected" : "") + ">" + { json: "A JSON file", text: "A text file", exe: "The program's file version", manual: "A version I type" }[t] + "</option>").join("") +
    "</select></label>" +
    '<label class="field" data-k="app" data-v="file">File path<input class="input" name="vpath" placeholder="C:\\Path\\install.json" value="' + esc(vs.path || "") + '"></label>' +
    '<label class="field" data-k="app" data-v="json">JSON key<input class="input" name="vkey" placeholder="version" value="' + esc(vs.key || "") + '"></label>' +
    '<label class="field" data-k="app" data-v="manual">Version<input class="input" name="vvalue" placeholder="1.2.3" value="' + esc(vs.value || "") + '"></label>' +
    '<label class="field wide">Description<input class="input" name="description" value="' + esc(a.description || "") + '"></label>' +
    "</div>" +
    '<div class="form-actions"><button class="btn primary" type="submit">' + (app ? "Save" : "Add") + '</button><button class="btn ghost" type="button" data-act="cancel">Cancel</button></div></form>'
  );
}

function syncFields(form) {
  const kind = form.elements.kind.value;
  for (const el of form.querySelectorAll("[data-k]")) el.hidden = el.dataset.k !== kind;
  if (kind !== "app") return;
  const t = form.elements.vtype.value;
  form.querySelector('[data-v="file"]').hidden = !(t === "json" || t === "text");
  form.querySelector('[data-v="json"]').hidden = t !== "json";
  form.querySelector('[data-v="manual"]').hidden = t !== "manual";
}

function matches(app, q) {
  if (!q) return true;
  const hay = [app.name, app.description, app.launch.exe, app.launch.url, app.launch.command].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q);
}

function paint() {
  const { main, apps, editing } = view;
  const form = main.querySelector("[data-form-slot]");
  const grid = main.querySelector("[data-grid]");
  const q = view.filter.trim().toLowerCase();
  const shown = apps.filter((a) => matches(a, q));
  const block = (title, list) =>
    list.length ? '<h2 class="section-title">' + title + ' <span class="count">' + list.length + '</span></h2><div class="grid">' + list.map(cardMarkup).join("") + "</div>" : "";
  const mine = shown.filter((a) => a.section !== "external");
  const external = shown.filter((a) => a.section === "external");
  grid.innerHTML = apps.length
    ? shown.length
      ? block("My apps", mine) + block("External", external)
      : '<div class="empty wide">Nothing matches "' + esc(view.filter) + '".</div>'
    : '<div class="empty wide">Nothing here yet. Add an app, a website or a command, or connect an agent on the Agents page and ask it to add one.</div>';
  main.querySelector("[data-count]").textContent = apps.length ? String(apps.length) : "";
  if (editing !== undefined && !form.firstChild) {
    form.innerHTML = formMarkup(editing, view.newKind);
    syncFields(form.querySelector("form"));
    form.querySelector('[name="name"]').focus();
  } else if (editing === undefined) {
    form.innerHTML = "";
  }
}

async function runCheck(id) {
  if (id) view.checking.add(id);
  else for (const a of view.apps) view.checking.add(a.id);
  paint();
  try {
    await view.ctx.shell.apps.check(id || "");
  } catch (error) {
    toast(errorText(error));
  }
  view.checking.clear();
  onAppsChanged();
}

function readForm(form) {
  const f = form.elements;
  const kind = f.kind.value;
  const out = { kind, section: f.section.value, name: f.name.value.trim(), description: f.description.value.trim() };
  const iconText = f.icon.value.trim();
  if (iconText) out.icon = iconText;
  else if (f.clearIcon.value) out.icon = "";
  if (kind === "website") return Object.assign(out, { url: f.url.value.trim(), browser: f.browser.value.trim() });
  if (kind === "command") return Object.assign(out, { command: f.command.value.trim(), cwd: f.cwd.value.trim(), shell: f.shell.value, terminal: f.terminal.checked });
  const type = f.vtype.value;
  const versionSource = { type };
  if (type === "json" || type === "text") versionSource.path = f.vpath.value.trim();
  if (type === "json" && f.vkey.value.trim()) versionSource.key = f.vkey.value.trim();
  if (type === "manual") versionSource.value = f.vvalue.value.trim();
  return Object.assign(out, { repo: f.repo.value.trim(), exe: f.exe.value.trim(), versionSource });
}

function openForm(editing, kind) {
  view.editing = editing;
  view.newKind = kind;
  view.main.querySelector("[data-form-slot]").innerHTML = "";
  paint();
}

export function renderApps(main, ctx) {
  main.innerHTML =
    '<div class="page"><div class="page-inner wide">' +
    '<div class="page-head"><h1>Apps <span class="count" data-count></span></h1>' +
    '<input class="input search" type="search" placeholder="Search" aria-label="Search apps" data-filter>' +
    '<span class="spacer"></span>' +
    '<button class="btn ghost icon-only" data-act="check-all" title="Check every app for a newer GitHub release" aria-label="Check all for updates">' + icon("reload") + "</button>" +
    '<button class="btn secondary" data-act="add" data-kind="app">' + icon("plus") + "App</button>" +
    '<button class="btn secondary" data-act="add" data-kind="website">' + icon("globe") + "Website</button>" +
    '<button class="btn secondary" data-act="add" data-kind="command">' + icon("terminal") + "Command</button>" +
    "</div>" +
    '<div data-form-slot></div><div data-grid></div></div></div>';
  view = { main, ctx, apps: [], editing: undefined, newKind: "app", checking: new Set(), installing: new Set(), filter: "" };
  const local = view;

  main.addEventListener("click", async (event) => {
    if (view !== local) return;
    const btn = event.target.closest("[data-act]");
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    const card = btn.closest("[data-app]");
    const id = card ? card.dataset.app : "";
    const app = view.apps.find((a) => a.id === id);
    const form = btn.closest("form");
    try {
      if (act === "launch") {
        btn.disabled = true;
        try {
          await ctx.shell.apps.launch(id);
          toast((app.kind === "website" ? "Opened " : app.kind === "command" ? "Ran " : "Launched ") + app.name);
        } finally {
          setTimeout(() => (btn.disabled = !app.exeExists), 600);
        }
      } else if (act === "check") await runCheck(id);
      else if (act === "check-all") await runCheck("");
      else if (act === "release") await ctx.shell.openExternal(btn.dataset.url);
      else if (act === "install") {
        view.installing.add(id);
        paint();
        try {
          const res = await ctx.shell.apps.installUpdate(id);
          if (res && res.opened) toast("Opened the " + res.version + " installer" + (res.verified ? "" : " (no checksum to verify it)"));
        } finally {
          view.installing.delete(id);
          onAppsChanged();
        }
      }
      else if (act === "add") openForm(null, btn.dataset.kind);
      else if (act === "edit") openForm(app, app.kind || "app");
      else if (act === "cancel") {
        view.editing = undefined;
        paint();
      } else if (act === "pick" || act === "pick-browser") {
        const picked = await ctx.shell.apps.pickExe();
        if (picked) form.elements[act === "pick" ? "exe" : "browser"].value = picked;
      } else if (act === "pick-folder") {
        const picked = await ctx.shell.apps.pickFolder();
        if (picked) form.elements.cwd.value = picked;
      } else if (act === "pick-icon") {
        const picked = await ctx.shell.apps.pickIcon();
        if (picked) {
          form.elements.icon.value = picked;
          form.elements.clearIcon.value = "";
        }
      } else if (act === "clear-icon") {
        form.elements.icon.value = "";
        form.elements.clearIcon.value = "1";
        form.querySelector("[data-icon-preview]").innerHTML = fallbackGlyph({ kind: form.elements.kind.value, name: form.elements.name.value || "?" });
        btn.remove();
      } else if (act === "remove") {
        if (await ctx.shell.apps.remove(id)) onAppsChanged();
      }
    } catch (error) {
      toast(errorText(error));
    }
  });
  main.addEventListener("input", (event) => {
    if (view !== local || !event.target.matches("[data-filter]")) return;
    view.filter = event.target.value;
    paint();
  });
  main.addEventListener("change", (event) => {
    if (view !== local) return;
    const name = event.target.name;
    if (name === "vtype" || name === "kind") syncFields(event.target.form);
  });
  main.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (view !== local) return;
    const submit = event.target.querySelector('[type="submit"]');
    const input = readForm(event.target);
    submit.disabled = true;
    try {
      if (view.editing) await ctx.shell.apps.update(Object.assign({ id: view.editing.id }, input));
      else await ctx.shell.apps.add(input);
      view.editing = undefined;
      onAppsChanged();
    } catch (error) {
      toast(errorText(error));
    } finally {
      submit.disabled = false;
    }
  });

  ctx.shell.apps.list().then((apps) => {
    if (view !== local) return;
    view.apps = apps;
    paint();
  });
  return () => {
    if (view === local) view = null;
  };
}
