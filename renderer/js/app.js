import { esc, icon, toast, errorText } from "./util.js";
import { renderApps, onAppsChanged } from "./apps.js";
import { renderAgents, onAgentsChanged } from "./agents.js";
import { renderSettings } from "./settings.js";

const shell = window.shell;
const root = document.getElementById("app");

const state = { page: "apps", theme: "light", info: null, update: null };
let mainCleanup = null;

function setTheme(theme) {
  state.theme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = state.theme;
}

function tab(page, label) {
  return '<button class="tab' + (state.page === page ? " on" : "") + '" data-nav="' + page + '" role="tab" aria-selected="' + (state.page === page) + '">' + esc(label) + "</button>";
}

function clock(iso) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
}

// App Launcher's own version and updates, from its GitHub releases.
function updatesMarkup() {
  const u = state.update;
  if (!u) return "";
  const button = (act, label, cls, disabled, title) => '<button class="btn sm ' + cls + '" data-upd="' + act + '"' + (title ? ' title="' + title + '"' : "") + (disabled ? " disabled" : "") + ">" + label + "</button>";
  const checkNow = button("check", "Check now", "ghost", u.status === "checking", "Check for a newer version of App Launcher itself");
  const checked = u.checkedAt ? "Last checked at " + clock(u.checkedAt) + ". Checks again every hour." : "Checks every hour.";
  const v = "v" + esc(u.version);
  if (u.status === "downloading") return '<span class="upd-text">Downloading v' + esc(u.latest) + "…</span>";
  if (u.status === "installing") return '<span class="upd-text">Installing v' + esc(u.latest) + ". App Launcher restarts by itself.</span>";
  if (u.status === "error") {
    return '<span class="upd-problem" title="' + esc(u.error + "\n" + checked) + '">' + icon("alert") + "Update check failed</span>" + checkNow;
  }
  if (u.status === "update") {
    const text = u.packaged ? "App Launcher v" + esc(u.latest) + " is available" : "App Launcher v" + esc(u.latest) + " is out. Run the beta installer to update.";
    const act = u.packaged ? button("install", "Update now", "primary") : button("notes", "Release notes", "secondary");
    return '<span class="upd-text" title="' + esc("You have " + v + ". " + checked) + '">' + text + "</span>" + act + checkNow;
  }
  const text = "App Launcher " + (u.status === "checking" ? v + ", checking…" : u.status === "current" ? v + ", up to date" : v);
  return '<span class="upd-text" title="' + esc(checked) + '">' + text + "</span>" + checkNow;
}

function renderUpdates() {
  const box = root.querySelector("[data-updates]");
  const html = updatesMarkup();
  if (box && box.innerHTML !== html) box.innerHTML = html;
}

function renderTop() {
  const top = root.querySelector(".topbar");
  if (!top) return;
  top.innerHTML =
    '<div class="wordmark">App Launcher</div>' +
    '<nav class="tabs" role="tablist" aria-label="Sections">' + tab("apps", "Apps") + tab("agents", "Agents") + tab("settings", "Settings") + "</nav>" +
    '<div class="updates" data-updates>' + updatesMarkup() + "</div>" +
    '<div class="seg look" role="group" aria-label="Look"><button data-theme-pick="light" class="' + (state.theme === "light" ? "on" : "") + '">Light</button><button data-theme-pick="dark" class="' + (state.theme === "dark" ? "on" : "") + '">Dark</button></div>';
}

function navigate(page) {
  state.page = page;
  renderTop();
  renderMain();
}

function renderMain() {
  const main = root.querySelector(".main");
  if (mainCleanup) mainCleanup();
  mainCleanup = null;
  const ctx = { state, navigate, shell };
  if (state.page === "agents") mainCleanup = renderAgents(main, ctx);
  else if (state.page === "settings") mainCleanup = renderSettings(main, ctx);
  else mainCleanup = renderApps(main, ctx);
}

function onEvent(message) {
  const { type, payload } = message || {};
  if (type === "apps-changed") onAppsChanged();
  else if (type === "agents-changed") onAgentsChanged();
  else if (type === "toast" && payload) toast(String(payload));
  else if (type === "self-update" && payload) {
    state.update = payload;
    renderUpdates();
  }
  else if (type === "theme") {
    setTheme(payload);
    renderTop();
  }
}

async function boot() {
  state.info = await shell.appInfo();
  state.update = await shell.selfUpdate.state();
  setTheme(state.info.theme);
  root.innerHTML = '<div class="shell"><header class="topbar"></header><main class="main"></main></div>';
  root.addEventListener("click", async (event) => {
    const nav = event.target.closest("[data-nav]");
    if (nav) return navigate(nav.dataset.nav);
    const upd = event.target.closest("[data-upd]");
    if (upd && !upd.disabled) {
      try {
        if (upd.dataset.upd === "check") await shell.selfUpdate.check();
        else if (upd.dataset.upd === "install") await shell.selfUpdate.install();
        else if (upd.dataset.upd === "notes" && state.update.latestUrl) await shell.openExternal(state.update.latestUrl);
      } catch (error) {
        toast(errorText(error));
      }
      return;
    }
    const pick = event.target.closest("[data-theme-pick]");
    if (pick) {
      setTheme(await shell.setTheme(pick.dataset.themePick));
      renderTop();
    }
  });
  shell.onEvent(onEvent);
  renderTop();
  renderMain();
}

boot().catch((error) => {
  root.innerHTML = '<div class="empty">App Launcher could not start: ' + esc(errorText(error)) + "</div>";
});
