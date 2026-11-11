#!/usr/bin/env node
"use strict";

// Draws the App Launcher mark (the sidebar's 2x2 grid: three ink squares,
// one accent) into build/icon.png (256px) and build/icon.ico (16-256px).
// Run: node scripts/make-icon.cjs

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const INK = [43, 45, 58];
const ACCENT = [96, 82, 204];
const BG = [245, 246, 250];

function crcTable() {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const TABLE = crcTable();
function crc(buf) {
  let x = 0xffffffff;
  for (const v of buf) x = TABLE[(x ^ v) & 255] ^ (x >>> 8);
  return (x ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}

// Signed distance to a rounded rectangle, in pixels.
function roundRect(px, py, x, y, w, h, r) {
  const cx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const cy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  return Math.hypot(Math.max(cx, 0), Math.max(cy, 0)) + Math.min(Math.max(cx, cy), 0) - r;
}

function draw(size) {
  const SS = 4;
  const rgba = Buffer.alloc(size * size * 4);
  const s = size;
  const pad = s * 0.06;
  const tile = { x: pad, y: pad, w: s - 2 * pad, h: s - 2 * pad, r: s * 0.22 };
  const inner = s * 0.2;
  const gap = s * 0.06;
  const cell = (s - 2 * inner - gap) / 2;
  const cr = cell * 0.24;
  const cells = [
    [inner, inner, INK],
    [inner + cell + gap, inner, ACCENT],
    [inner, inner + cell + gap, INK],
    [inner + cell + gap, inner + cell + gap, INK],
  ];
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          if (roundRect(px, py, tile.x, tile.y, tile.w, tile.h, tile.r) > 0) continue;
          let col = BG;
          for (const [cx, cy, c] of cells) if (roundRect(px, py, cx, cy, cell, cell, cr) <= 0) col = c;
          r += col[0];
          g += col[1];
          b += col[2];
          a += 255;
        }
      }
      const n = SS * SS;
      const covered = a / 255;
      const i = (y * s + x) * 4;
      rgba[i] = covered ? Math.round(r / covered) : 0;
      rgba[i + 1] = covered ? Math.round(g / covered) : 0;
      rgba[i + 2] = covered ? Math.round(b / covered) : 0;
      rgba[i + 3] = Math.round(a / n);
    }
  }
  return rgba;
}

function png(size) {
  const rgba = draw(size);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

function ico(sizes) {
  const images = sizes.map(png);
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const dir = sizes.map((s, i) => {
    const e = Buffer.alloc(16);
    e[0] = s >= 256 ? 0 : s;
    e[1] = s >= 256 ? 0 : s;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(images[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += images[i].length;
    return e;
  });
  return Buffer.concat([head, ...dir, ...images]);
}

const out = path.join(__dirname, "..", "build");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "icon.png"), png(256));
fs.writeFileSync(path.join(out, "icon.ico"), ico([16, 24, 32, 48, 64, 256]));
console.log("wrote build/icon.png and build/icon.ico");
