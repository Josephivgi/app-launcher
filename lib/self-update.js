"use strict";

// App Launcher's own updates, from its GitHub releases. It checks when the app
// starts, every hour after that, and when the person clicks Check now. In an
// installed copy, install() downloads the new setup from the release, checks
// its SHA-256 against the one GitHub publishes, runs it silently and quits;
// the setup replaces the app and starts it again. A copy run from git (the
// beta installer) is updated by running the beta installer again instead.

const path = require("node:path");
const { spawn } = require("node:child_process");
const { fetchLatest, compareVersions, normalizeVersion } = require("./versions");
const { pickInstaller, downloadInstaller, assertReleaseUrl } = require("./releases");

const REPO = "Josephivgi/app-launcher";
const HOUR = 60 * 60 * 1000;

// electron-builder's NSIS setup: --updated marks an update, /S installs over
// the old version with no window, --force-run starts App Launcher afterwards.
function runSetup(file) {
  const child = spawn(file, ["--updated", "/S", "--force-run"], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

function createSelfUpdate(options) {
  const repo = options.repo || REPO;
  const dataRoot = options.dataRoot;
  const latestOf = options.fetchLatest || fetchLatest;
  const run = options.runSetup || runSetup;
  const quit = options.quit || (() => {});
  const onChange = options.onChange || (() => {});
  const every = options.everyMs || HOUR;

  // status: idle | checking | current | update | downloading | installing | error
  let state = {
    version: normalizeVersion(options.currentVersion),
    packaged: Boolean(options.packaged),
    status: "idle",
    latest: "",
    latestUrl: "",
    installer: null,
    checkedAt: "",
    error: "",
  };
  let running = null;
  let timer = null;

  // What the window sees: the installer's name and size, not its URL.
  function get() {
    const i = state.installer;
    return Object.assign({}, state, { installer: i ? { name: i.name, size: i.size, verified: Boolean(i.sha256) } : null });
  }

  function set(patch) {
    state = Object.assign({}, state, patch);
    const out = get();
    onChange(out);
    return out;
  }

  function check() {
    if (running) return running;
    if (state.status === "downloading" || state.status === "installing") return Promise.resolve(get());
    set({ status: "checking", error: "" });
    running = (async () => {
      try {
        const latest = await latestOf(repo);
        const newer = compareVersions(latest.version, state.version) > 0;
        return set({
          status: newer ? "update" : "current",
          latest: latest.version,
          latestUrl: latest.url || "",
          installer: newer ? pickInstaller(latest.assets) : null,
          checkedAt: new Date().toISOString(),
          error: "",
        });
      } catch (error) {
        return set({ status: "error", error: String((error && error.message) || error), checkedAt: new Date().toISOString() });
      } finally {
        running = null;
      }
    })();
    return running;
  }

  async function install() {
    if (state.status !== "update") throw new Error("There is no newer App Launcher to install. Click Check now first.");
    if (!state.packaged) throw new Error("This App Launcher runs from git. Run the beta installer again to update it.");
    if (!state.installer) throw new Error("The " + state.latest + " release has no setup file yet. Try again in a few minutes.");
    if (!dataRoot) throw new Error("Updates need the data folder.");
    assertReleaseUrl(state.installer.url, repo);
    const version = state.latest;
    set({ status: "downloading", error: "" });
    let file;
    try {
      file = await downloadInstaller(state.installer, path.join(dataRoot, "updates", "app-launcher"));
      run(file.path);
    } catch (error) {
      set({ status: "update", error: String((error && error.message) || error) });
      throw error;
    }
    set({ status: "installing" });
    // Quit so the setup can replace the files; it starts App Launcher again.
    setTimeout(quit, 300);
    return { installing: version, verified: file.verified };
  }

  function start() {
    if (timer) return;
    check();
    timer = setInterval(check, every);
    if (timer.unref) timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { get, check, install, start, stop };
}

module.exports = { createSelfUpdate, runSetup, REPO, HOUR };
