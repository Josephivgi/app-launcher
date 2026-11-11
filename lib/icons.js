"use strict";

// App icons. An agent or the user hands us an image file path, an http(s)
// image URL, or a data: URI; we copy it into <dataRoot>/icons so the card
// keeps working if the original moves. A path to an .exe, .lnk, .dll or .ico
// holder is kept as `iconFrom` instead: the app window pulls the icon out of
// it (Electron's getFileIcon), which plain Node cannot do.

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_EXT = { ".png": "png", ".jpg": "jpg", ".jpeg": "jpg", ".gif": "gif", ".webp": "webp", ".svg": "svg", ".ico": "ico", ".bmp": "bmp" };
const ICON_HOLDERS = /\.(exe|lnk|dll|url|appref-ms)$/i;
const FILE_RE = /^[a-z0-9-]+-[0-9a-f]{10}\.(png|jpg|gif|webp|svg|ico|bmp)$/;

function iconsDir(dataRoot) {
  return path.join(dataRoot, "icons");
}

// Magic bytes, so a renamed text file or HTML page is not stored as an image.
function sniff(buf) {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 6 && buf.toString("ascii", 0, 4) === "GIF8") return "gif";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x00010000) return "ico";
  if (buf.length >= 2 && buf.toString("ascii", 0, 2) === "BM") return "bmp";
  const head = buf.toString("utf8", 0, Math.min(buf.length, 1024)).replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return "svg";
  return "";
}

async function download(url) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "App-Launcher" } });
  if (!res.ok) throw new Error("Could not download the icon (HTTP " + res.status + ").");
  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_BYTES) throw new Error("The icon is over 5 MB.");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("The icon is over 5 MB.");
  return buf;
}

function decodeDataUri(uri) {
  const m = /^data:([a-z0-9.+/-]+)?(;base64)?,(.*)$/is.exec(uri);
  if (!m) throw new Error("That data: URI does not look right.");
  const buf = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");
  if (buf.length > MAX_BYTES) throw new Error("The icon is over 5 MB.");
  return buf;
}

// Returns { icon, iconFrom } to merge into the app record.
async function importIcon(dataRoot, id, source) {
  const src = String(source == null ? "" : source).trim().replace(/^"+|"+$/g, "");
  if (!src) return { icon: "", iconFrom: "" };
  let buf;
  if (/^data:/i.test(src)) buf = decodeDataUri(src);
  else if (/^https?:\/\//i.test(src)) buf = await download(src);
  else {
    if (!path.isAbsolute(src)) throw new Error('icon must be a full path to an image, an https:// image URL, or a data: URI (got "' + src + '").');
    if (!fs.existsSync(src)) throw new Error("No file at " + src + ".");
    if (ICON_HOLDERS.test(src)) return { icon: "", iconFrom: src };
    if (!IMAGE_EXT[path.extname(src).toLowerCase()]) throw new Error("icon must be a .png, .jpg, .gif, .webp, .svg, .ico or .bmp image, or an .exe/.lnk to take the icon from.");
    if (fs.statSync(src).size > MAX_BYTES) throw new Error("The icon is over 5 MB.");
    buf = fs.readFileSync(src);
  }
  const ext = sniff(buf);
  if (!ext) throw new Error("That file is not an image App Launcher can show (png, jpg, gif, webp, svg, ico, bmp).");
  const name = id + "-" + createHash("sha256").update(buf).digest("hex").slice(0, 10) + "." + ext;
  const dir = iconsDir(dataRoot);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), buf);
  return { icon: name, iconFrom: "" };
}

// Deletes a stored icon no other app uses.
function dropIcon(dataRoot, name, stillUsed) {
  if (!name || !FILE_RE.test(name) || (stillUsed && stillUsed(name))) return;
  try {
    fs.unlinkSync(path.join(iconsDir(dataRoot), name));
  } catch {
    /* already gone */
  }
}

function iconFile(dataRoot, name) {
  return FILE_RE.test(String(name || "")) ? path.join(iconsDir(dataRoot), name) : "";
}

module.exports = { importIcon, dropIcon, iconFile, iconsDir, sniff };
