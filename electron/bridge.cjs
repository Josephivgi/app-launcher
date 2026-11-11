"use strict";

// Loopback HTTP bridge for the stdio MCP proxy. Listens on 127.0.0.1 with a
// random bearer token and writes bridge.json (url, port, token, pid) to the
// data root. Quitting sets pid to 0 so a stale file reads as "app closed".

const http = require("node:http");
const path = require("node:path");
const { randomBytes, timingSafeEqual } = require("node:crypto");
const { writeAtomic } = require("../lib/paths");
const { TOOLS } = require("../lib/mcp-tools");

const BODY_MAX = 2 * 1024 * 1024;

function startBridge(options) {
  const { dataRoot, callTool } = options;
  const token = randomBytes(24).toString("hex");
  const file = path.join(dataRoot, "bridge.json");
  const want = Buffer.from("Bearer " + token);

  function authorized(req) {
    const got = Buffer.from(String(req.headers.authorization || ""));
    return got.length === want.length && timingSafeEqual(got, want);
  }

  function reply(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json", Connection: "close" });
    res.end(JSON.stringify(body));
  }

  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || !authorized(req)) return reply(res, req.method === "POST" ? 401 : 405, { error: "Not allowed." });
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > BODY_MAX) req.destroy();
      else chunks.push(c);
    });
    req.on("end", async () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch {
        return reply(res, 400, { error: "Invalid JSON." });
      }
      if (req.url === "/tools/list") return reply(res, 200, { tools: TOOLS });
      if (req.url === "/tools/call") {
        try {
          const result = await callTool(String(body.name || ""), body.arguments || {});
          return reply(res, 200, result);
        } catch (error) {
          return reply(res, 200, { content: [{ type: "text", text: String(error.message || error) }], isError: true });
        }
      }
      reply(res, 404, { error: "Unknown route." });
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const info = { url: "http://127.0.0.1:" + port, port, token, pid: process.pid };
      writeAtomic(file, JSON.stringify(info, null, 2));
      resolve({
        info,
        close() {
          try {
            writeAtomic(file, JSON.stringify(Object.assign({}, info, { pid: 0 }), null, 2));
          } catch {
            /* data root gone */
          }
          server.close();
        },
      });
    });
  });
}

module.exports = { startBridge };
