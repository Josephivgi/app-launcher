import { esc, toast, errorText } from "./util.js";
import { renderApps, onAppsChanged } from "./apps.js";
import { renderAgents, onAgentsChanged } from "./agents.js";

const shell = window.shell;
const root = document.getElementById("app");

const state = { page: "apps", theme: "light", info: null };
let mainCleanup = null;

function setTheme(theme) {
  state.theme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = state.theme;
}

function tab(page, label) {
  return '<button class="tab' + (state.page === page ? " on" : "") + '" data-nav="' + page + '" role="tab" aria-selected="' + (state.page === page) + '">' + esc(label) + "</button>";
}

function renderTop() {
  const top = root.querySelector(".topbar");
  if (!top) return;
  top.innerHTML =
    '<div class="wordmark">App Launcher</div>' +
    '<nav class="tabs" role="tablist" aria-label="Sections">' + tab("apps", "Apps") + tab("agents", "Agents") + "</nav>" +
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
  else mainCleanup = renderApps(main, ctx);
}

function onEvent(message) {
  const { type, payload } = message || {};
  if (type === "apps-changed") onAppsChanged();
  else if (type === "agents-changed") onAgentsChanged();
  else if (type === "toast" && payload) toast(String(payload));
  else if (type === "theme") {
    setTheme(payload);
    renderTop();
  }
}

async function boot() {
  state.info = await shell.appInfo();
  setTheme(state.info.theme);
  root.innerHTML = '<div class="shell"><header class="topbar"></header><main class="main"></main></div>';
  root.addEventListener("click", async (event) => {
    const nav = event.target.closest("[data-nav]");
    if (nav) return navigate(nav.dataset.nav);
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
