"use strict";

// One SQLite file (app-launcher.db) in the data root holds settings and the
// app registry. Only the main process opens it.

const fs = require("node:fs");
const path = require("node:path");

let DatabaseSync = null;
function ctor() {
  if (!DatabaseSync) ({ DatabaseSync } = require("node:sqlite"));
  return DatabaseSync;
}

const BUSY_MS = 5000;

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS apps (id TEXT PRIMARY KEY, app_json TEXT NOT NULL, check_json TEXT NOT NULL DEFAULT '{}', sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
];

function openDb(dataRoot) {
  if (!dataRoot) throw new Error("dataRoot is required");
  fs.mkdirSync(dataRoot, { recursive: true });
  const db = new (ctor())(path.join(dataRoot, "app-launcher.db"), { timeout: BUSY_MS });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=" + BUSY_MS);
  for (const sql of SCHEMA) db.exec(sql);
  return createStore(db);
}

function now() {
  return new Date().toISOString();
}

function parse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function appRow(row) {
  return Object.assign(parse(row.app_json, {}), { id: row.id, check: parse(row.check_json, {}) });
}

function createStore(db) {
  const q = {
    getSetting: db.prepare("SELECT value_json FROM settings WHERE key = ?"),
    setSetting: db.prepare("INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json"),
    apps: db.prepare("SELECT id, app_json, check_json FROM apps ORDER BY sort, created_at"),
    app: db.prepare("SELECT id, app_json, check_json FROM apps WHERE id = ?"),
    upsertApp: db.prepare("INSERT INTO apps (id, app_json, check_json, sort, created_at, updated_at) VALUES (?, ?, '{}', (SELECT COALESCE(MAX(sort), 0) + 1 FROM apps), ?, ?) ON CONFLICT(id) DO UPDATE SET app_json = excluded.app_json, updated_at = excluded.updated_at"),
    saveCheck: db.prepare("UPDATE apps SET check_json = ? WHERE id = ?"),
    deleteApp: db.prepare("DELETE FROM apps WHERE id = ?"),
  };

  return {
    raw: db,
    close: () => db.close(),
    getSetting(key, fallback) {
      const row = q.getSetting.get(String(key));
      return row ? parse(row.value_json, fallback) : fallback;
    },
    setSetting(key, value) {
      q.setSetting.run(String(key), JSON.stringify(value));
      return value;
    },
    listApps: () => q.apps.all().map(appRow),
    getApp(id) {
      const row = q.app.get(String(id));
      return row ? appRow(row) : null;
    },
    saveApp(app) {
      const at = now();
      q.upsertApp.run(String(app.id), JSON.stringify(app), at, at);
      return this.getApp(app.id);
    },
    saveCheck(id, result) {
      q.saveCheck.run(JSON.stringify(result), String(id));
    },
    deleteApp: (id) => Number(q.deleteApp.run(String(id)).changes) > 0,
  };
}

module.exports = { openDb };
