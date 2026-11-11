"use strict";

// Installing a new release from GitHub Releases: pick the Windows installer
// a release ships, download it over HTTPS from GitHub only, check its SHA-256
// against the checksum GitHub publishes for it, then hand it to Windows.

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const crypto = require("node:crypto");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const MAX_BYTES = 2 * 1024 ** 3;
const REDIRECTS = [301, 302, 303, 307, 308];

// File names are kept to plain characters so they cannot escape the folder.
function safeName(raw) {
  return String(raw || "installer").replace(/[^A-Za-z0-9._() +-]/g, "_").replace(/^\.+/, "").slice(0, 120) || "installer";
}

// From a GitHub release's asset list: the Windows installer (.exe or .msi),
// preferring a file named setup or install. Returns null when there is none.
function pickInstaller(assets) {
  const usable = (Array.isArray(assets) ? assets : []).filter(
    (a) => a && /\.(exe|msi)$/i.test(String(a.name || "")) && !/blockmap|portable|uninstall/i.test(String(a.name)),
  );
  const pick = usable.find((a) => /setup|install/i.test(a.name)) || usable[0];
  if (!pick) return null;
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(String(pick.digest || ""));
  return {
    name: safeName(pick.name),
    url: String(pick.browser_download_url || ""),
    size: Number(pick.size) || 0,
    sha256: digest ? digest[1].toLowerCase() : "",
  };
}

// Only GitHub itself and its release storage. Anything else is refused.
function assertGithubUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || ""));
  } catch {
    throw new Error("That download address is not a valid URL.");
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !(host === "github.com" || host.endsWith(".githubusercontent.com"))) {
    throw new Error("Refusing to download from " + (host || "an unknown host") + ". Only GitHub release downloads are allowed.");
  }
  return url;
}

function request(url, redirectsLeft) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "app-launcher", Accept: "application/octet-stream" }, timeout: 30_000 }, (res) => {
      if (REDIRECTS.includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error("GitHub redirected too many times."));
        let next;
        try {
          next = assertGithubUrl(new URL(res.headers.location, url).href);
        } catch (error) {
          return reject(error);
        }
        return resolve(request(next, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error("GitHub answered HTTP " + res.statusCode + " for the download."));
      }
      resolve(res);
    });
    req.on("timeout", () => req.destroy(new Error("The download stalled. Check your connection and try again.")));
    req.on("error", reject);
  });
}

// Downloads the installer into `dir` (replacing whatever was there). Throws,
// and keeps nothing, when the file is too big or does not match its checksum.
async function downloadInstaller(installer, dir) {
  const source = assertGithubUrl(installer.url);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const name = safeName(installer.name);
  const file = path.join(dir, name);
  const part = file + ".part";

  const res = await request(source, 5);
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  const counter = new Transform({
    transform(chunk, _encoding, done) {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) return done(new Error("The installer is larger than 2 GB. It was not downloaded."));
      hash.update(chunk);
      done(null, chunk);
    },
  });
  try {
    await pipeline(res, counter, fs.createWriteStream(part));
  } catch (error) {
    fs.rmSync(part, { force: true });
    throw error;
  }

  const digest = hash.digest("hex");
  if (installer.sha256 && digest !== installer.sha256) {
    fs.rmSync(part, { force: true });
    throw new Error("The download does not match GitHub's checksum, so it was thrown away and not installed.");
  }
  fs.renameSync(part, file);
  return { path: file, name, bytes, sha256: digest, verified: Boolean(installer.sha256) };
}

// The installer must come from the same repo's release downloads, so an
// agent cannot point an install at a file from somewhere else.
function assertReleaseUrl(raw, repo) {
  const url = assertGithubUrl(raw);
  const prefix = "/" + String(repo || "") + "/releases/download/";
  if (url.hostname.toLowerCase() !== "github.com" || !url.pathname.toLowerCase().startsWith(prefix.toLowerCase())) {
    throw new Error("That installer is not from the GitHub releases of " + repo + ". It was not downloaded.");
  }
  return url;
}

module.exports = { pickInstaller, assertGithubUrl, assertReleaseUrl, downloadInstaller, safeName, MAX_BYTES };
