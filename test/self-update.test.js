"use strict";

// Extra unit tests for App Launcher's own updates, with a stand-in for GitHub.
// The real check against GitHub runs in the smoke run (Check now in the UI).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSelfUpdate } = require("../lib/self-update");

const SETUP = {
  name: "App-Launcher-Setup-0.3.0.exe",
  browser_download_url: "https://github.com/Josephivgi/app-launcher/releases/download/v0.3.0/App-Launcher-Setup-0.3.0.exe",
  size: 1000,
  digest: "sha256:" + "a".repeat(64),
};

function release(version, assets) {
  return async () => ({ version, tag: "v" + version, url: "https://github.com/Josephivgi/app-launcher/releases/tag/v" + version, assets: assets || [] });
}

test("an older running version sees the update and the setup to install", async () => {
  const seen = [];
  const u = createSelfUpdate({ currentVersion: "0.2.0", packaged: true, fetchLatest: release("0.3.0", [SETUP]), onChange: (s) => seen.push(s.status) });
  const s = await u.check();
  assert.equal(s.status, "update");
  assert.equal(s.latest, "0.3.0");
  assert.deepEqual(s.installer, { name: SETUP.name, size: 1000, verified: true });
  assert.equal("url" in s.installer, false, "the window never gets the download URL");
  assert.deepEqual(seen, ["checking", "update"]);
});

test("the same or an older release is up to date", async () => {
  for (const latest of ["0.2.0", "0.1.9"]) {
    const s = await createSelfUpdate({ currentVersion: "0.2.0", fetchLatest: release(latest, [SETUP]) }).check();
    assert.equal(s.status, "current", latest);
    assert.equal(s.installer, null);
  }
});

test("a failed check says why and can be retried", async () => {
  let fail = true;
  const u = createSelfUpdate({
    currentVersion: "0.2.0",
    fetchLatest: async () => {
      if (fail) throw new Error("GitHub rate limit reached. Try again later.");
      return release("0.2.0")();
    },
  });
  const s = await u.check();
  assert.equal(s.status, "error");
  assert.match(s.error, /rate limit/);
  fail = false;
  assert.equal((await u.check()).status, "current");
});

test("checks at the same time share one request", async () => {
  let calls = 0;
  const u = createSelfUpdate({ currentVersion: "0.2.0", fetchLatest: async () => (calls++, release("0.3.0", [SETUP])()) });
  await Promise.all([u.check(), u.check(), u.check()]);
  assert.equal(calls, 1);
});

test("start checks now and then on the timer", async () => {
  let calls = 0;
  const u = createSelfUpdate({ currentVersion: "0.2.0", everyMs: 30, fetchLatest: async () => (calls++, release("0.2.0")()) });
  u.start();
  await new Promise((r) => setTimeout(r, 110));
  u.stop();
  assert.ok(calls >= 3, "checked " + calls + " times");
});

test("a copy run from git is not installed over; it is told to use the beta installer", async () => {
  const u = createSelfUpdate({ currentVersion: "0.2.0", packaged: false, fetchLatest: release("0.3.0", [SETUP]), runSetup: () => assert.fail("ran a setup") });
  await u.check();
  await assert.rejects(u.install(), /beta installer/);
});

test("install refuses before a check finds an update", async () => {
  const u = createSelfUpdate({ currentVersion: "0.2.0", packaged: true, fetchLatest: release("0.2.0"), runSetup: () => assert.fail("ran a setup") });
  await assert.rejects(u.install(), /no newer App Launcher/);
  await u.check();
  await assert.rejects(u.install(), /no newer App Launcher/);
});

test("install refuses a setup that is not from App Launcher's own releases", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "al-self-"));
  const other = Object.assign({}, SETUP, { browser_download_url: "https://github.com/someone/else/releases/download/v1/App-Launcher-Setup-0.3.0.exe" });
  const u = createSelfUpdate({ currentVersion: "0.2.0", packaged: true, dataRoot, fetchLatest: release("0.3.0", [other]), runSetup: () => assert.fail("ran a setup") });
  await u.check();
  await assert.rejects(u.install(), /not from the GitHub releases of Josephivgi\/app-launcher/);
  fs.rmSync(dataRoot, { recursive: true, force: true });
});
