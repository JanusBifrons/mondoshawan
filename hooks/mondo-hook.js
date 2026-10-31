#!/usr/bin/env node
// Mondo's Claude Code hook. Reads the hook JSON from stdin and POSTs it to Mondo.
// Rules: no dependencies, ~1s timeout, swallow every error, print nothing, always exit 0.
// If Mondo isn't running this finishes almost instantly (connection refused).
"use strict";

const started = Date.now();
let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  process.exit(0);
}

// Hard deadline: never take longer than this, whatever happens.
setTimeout(finish, 1200);
process.on("uncaughtException", finish);
process.on("unhandledRejection", finish);

try {
  const http = require("http");
  const fs = require("fs");
  const path = require("path");

  let host = "127.0.0.1";
  let port = 4317;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "mondo.config.json"), "utf8"));
    if (cfg && cfg.server) {
      if (cfg.server.port) port = Number(cfg.server.port);
      // A wildcard bind address isn't connectable; talk to loopback instead.
      if (cfg.server.host && cfg.server.host !== "0.0.0.0" && cfg.server.host !== "::") host = cfg.server.host;
    }
  } catch (_) {
    /* use defaults */
  }
  if (process.env.MONDO_PORT) port = Number(process.env.MONDO_PORT);
  if (process.env.MONDO_HOOK_HOST) host = process.env.MONDO_HOOK_HOST;

  const chunks = [];
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("error", finish);
  process.stdin.on("end", () => {
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      payload._mondo_ts = started;
      const body = Buffer.from(JSON.stringify(payload));
      const req = http.request(
        {
          host,
          port,
          path: "/api/hooks",
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": body.length },
          timeout: 1000,
        },
        (res) => {
          res.resume();
          res.on("end", finish);
          res.on("error", finish);
        },
      );
      req.on("timeout", () => {
        req.destroy();
        finish();
      });
      req.on("error", finish);
      req.end(body);
    } catch (_) {
      finish();
    }
  });
} catch (_) {
  finish();
}
