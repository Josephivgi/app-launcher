"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openDb } = require("../lib/db");
const { createApps } = require("../lib/apps");
const { assertReleaseUrl } = require("../lib/releases");

// Nothing here launches a program: the confirm stub always says no, and the
// approval step is checked through apps.approve() and the stored flags.
function registry(confirmLaunch) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "al-approval-"));
  const db = openDb(dataRoot);
  const apps = createApps({
    db,
    dataRoot,
    openPath: async () => "",
    openExternal: async () => {},
    confirmLaunch: confirmLaunch || (async () => false),
  });
  return { apps, db, dataRoot };
}

const cmd = (extra) => Object.assign({ name: "Dev Server", command: "echo hi", cwd: os.tmpdir(), terminal: false }, extra);

test("commands added by an agent are not approved; added in the window they are", async () => {
  const { apps, db, dataRoot } = registry();
  const byAgent = await apps.add(cmd({ id: "agent-cmd" }), { by: "agent" });
  const byUser = await apps.add(cmd({ id: "user-cmd" }), { by: "user" });
  assert.equal(byAgent.trusted, false);
  assert.equal(byUser.trusted, true);
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test("an agent launch of an unapproved command is refused and nothing runs", async () => {
  const { apps, db, dataRoot } = registry();
  await apps.add(cmd({ id: "agent-cmd" }), { by: "agent" });
  await assert.rejects(apps.launch("agent-cmd", { by: "agent" }), /not been approved/);
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test("a window launch asks first, and a no answer leaves it unapproved", async () => {
  let asked = null;
  const { apps, db, dataRoot } = registry(async (app) => ((asked = app.id), false));
  await apps.add(cmd({ id: "agent-cmd" }), { by: "agent" });
  const res = await apps.launch("agent-cmd", { by: "user" });
  assert.deepEqual(res, { cancelled: true });
  assert.equal(asked, "agent-cmd");
  assert.equal(apps.get("agent-cmd").trusted, false);
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test("changing what runs drops approval; an unrelated agent edit keeps it", async () => {
  const { apps, db, dataRoot } = registry();
  await apps.add(cmd({ id: "c1" }), { by: "user" });
  assert.equal(apps.get("c1").trusted, true);
  await apps.update({ id: "c1", description: "just a note" }, { by: "agent" });
  assert.equal(apps.get("c1").trusted, true, "description change should keep approval");
  await apps.update({ id: "c1", command: "echo changed" }, { by: "agent" });
  assert.equal(apps.get("c1").trusted, false, "changed command must need approval again");
  apps.approve("c1");
  assert.equal(apps.get("c1").trusted, true);
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test("an agent cannot set the approval flags itself", async () => {
  const { apps, db, dataRoot } = registry();
  await apps.add(cmd({ id: "c2", trusted: true, repoTrusted: true }), { by: "agent" });
  assert.equal(apps.get("c2").trusted, false);
  assert.equal(apps.get("c2").repoTrusted, false);
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test("assertReleaseUrl accepts only the same repo's release downloads", () => {
  const ok = "https://github.com/Owner/Repo/releases/download/v1.0.0/Setup.exe";
  assert.equal(assertReleaseUrl(ok, "owner/repo").hostname, "github.com");
  assert.throws(() => assertReleaseUrl("https://github.com/other/repo/releases/download/v1/Setup.exe", "owner/repo"), /not from the GitHub releases/);
  assert.throws(() => assertReleaseUrl("https://evil.example/owner/repo/releases/download/v1/Setup.exe", "owner/repo"), /Refusing/);
});
