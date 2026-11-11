"use strict";

// Version logic: reading what is installed, asking GitHub what is newest, and
// comparing the two. Pure of Electron so tests and the MCP tools share it.

const fs = require("node:fs");
const https = require("node:https");
const { execFile } = require("node:child_process");
const { pickInstaller } = require("./releases");

const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const GITHUB_API = "https://api.github.com";

function normalizeVersion(raw) {
  const text = String(raw == null ? "" : raw).trim().replace(/^[vV]+/, "");
  const m = text.match(/^(\d+)\.(\d+)(?:\.(\d+))?(?:\.\d+)?(?:-([0-9A-Za-z.-]+))?/);
  if (!m) return "";
  return m[1] + "." + m[2] + "." + (m[3] || "0") + (m[4] ? "-" + m[4] : "");
}

function parts(raw) {
  const norm = normalizeVersion(raw);
  if (!norm) return null;
  const dash = norm.indexOf("-");
  const core = dash < 0 ? norm : norm.slice(0, dash);
  return { nums: core.split(".").map(Number), pre: dash < 0 ? "" : norm.slice(dash + 1) };
}

// 1 when a is newer, -1 when older, 0 when equal, null when either is unparsable.
function compareVersions(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i += 1) if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] > pb.nums[i] ? 1 : -1;
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return pa.pre > pb.pre ? 1 : -1;
}

function validRepo(repo) {
  return REPO_RE.test(String(repo || ""));
}

function dig(obj, keyPath) {
  let cur = obj;
  for (const key of String(keyPath || "version").split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[key];
  }
  return cur;
}

function exeFileVersion(file) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve("");
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "(Get-Item -LiteralPath $args[0]).VersionInfo.ProductVersion", file],
      { timeout: 15_000, windowsHide: true },
      (error, stdout) => resolve(error ? "" : String(stdout).trim()),
    );
  });
}

// versionSource: { type: "json", path, key? } | { type: "text", path } | { type: "exe" } | { type: "manual", value }
async function readInstalledVersion(app) {
  const src = app.versionSource || { type: "manual", value: "" };
  try {
    if (src.type === "json") {
      const data = JSON.parse(await fs.promises.readFile(src.path, "utf8"));
      return normalizeVersion(dig(data, src.key));
    }
    if (src.type === "text") return normalizeVersion(await fs.promises.readFile(src.path, "utf8"));
    if (src.type === "exe") return normalizeVersion(await exeFileVersion(app.launch.exe));
    if (src.type === "manual") return normalizeVersion(src.value);
  } catch {
    return "";
  }
  return "";
}

function getJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "app-launcher", Accept: "application/vnd.github+json" }, timeout: timeoutMs || 15_000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        let body = null;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          /* not JSON */
        }
        resolve({ status: res.statusCode, body, rateRemaining: res.headers["x-ratelimit-remaining"] });
      });
    });
    req.on("timeout", () => req.destroy(new Error("GitHub did not answer in time.")));
    req.on("error", reject);
  });
}

// Newest published release; repos without releases fall back to the newest tag.
async function fetchLatest(repo) {
  if (!validRepo(repo)) throw new Error('"' + repo + '" is not an owner/name GitHub repo.');
  const release = await getJson(GITHUB_API + "/repos/" + repo + "/releases/latest");
  if (release.status === 200 && release.body && release.body.tag_name) {
    return { version: normalizeVersion(release.body.tag_name), tag: release.body.tag_name, url: release.body.html_url, publishedAt: release.body.published_at || "", source: "release", assets: release.body.assets || [] };
  }
  if (release.status === 403 || release.status === 429) throw new Error("GitHub rate limit reached. Try again later.");
  if (release.status !== 404) throw new Error("GitHub answered HTTP " + release.status + ".");
  const tags = await getJson(GITHUB_API + "/repos/" + repo + "/tags?per_page=30");
  if (tags.status === 404) throw new Error("No GitHub repo " + repo + " (private repos are not readable anonymously).");
  if (tags.status !== 200 || !Array.isArray(tags.body)) throw new Error("GitHub answered HTTP " + tags.status + ".");
  const versioned = tags.body.filter((t) => normalizeVersion(t.name)).sort((a, b) => compareVersions(b.name, a.name));
  if (!versioned.length) throw new Error(repo + " has no releases or version tags.");
  const top = versioned[0];
  return { version: normalizeVersion(top.name), tag: top.name, url: "https://github.com/" + repo + "/releases/tag/" + encodeURIComponent(top.name), publishedAt: "", source: "tag", assets: [] };
}

// status: current | update | ahead | unknown | error | no-repo
// installer: the Windows installer of the newest release (see releases.js), or null.
async function checkApp(app) {
  const installed = await readInstalledVersion(app);
  const base = { installed, latest: "", latestUrl: "", installer: null, status: "unknown", error: "", checkedAt: new Date().toISOString() };
  if (!app.repo) return Object.assign(base, { status: "no-repo" });
  try {
    const latest = await fetchLatest(app.repo);
    base.latest = latest.version;
    base.latestUrl = latest.url;
    base.installer = pickInstaller(latest.assets);
    const cmp = compareVersions(latest.version, installed);
    base.status = cmp === null ? "unknown" : cmp > 0 ? "update" : cmp < 0 ? "ahead" : "current";
  } catch (error) {
    base.status = "error";
    base.error = String(error.message || error);
  }
  return base;
}

module.exports = { normalizeVersion, compareVersions, validRepo, readInstalledVersion, fetchLatest, checkApp };
