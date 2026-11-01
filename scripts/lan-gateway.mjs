// LAN gateway: lets a phone reach Mondo without exposing the main server.
//
// Mondo's Next server stays on 127.0.0.1 (hooks and the desktop window talk to it with no
// auth). This gateway listens on the network and forwards to it, but only for approved
// devices:
//   1. The phone opens the QR link from Settings: /__mondo/pair?t=<pairing token>.
//   2. The gateway records a pending device with a 4-digit code and gives the phone a cookie
//      holding that device's own secret. The phone waits on /__mondo/wait.
//   3. The PC (Mondo window) asks "Allow this phone? code 1234". Approval happens only on
//      the PC: Next refuses approval requests that came through this gateway.
//   4. From then on, that cookie is the phone's key, until it is revoked in Settings. It only
//      works from the address the phone paired from, so a copied cookie is useless elsewhere.
// The pairing token alone gets you nothing but a prompt on the PC.
//
// Forwarded requests have their Host and Origin rewritten to the local server, so Next's
// cross-site guard and dev-server origin checks see an ordinary local request, and gain
// `x-mondo-remote: 1` so pages can tell (to hide the QR and refuse approvals).
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  COOKIE,
  DEVICES_TABLE_SQL,
  deviceForCookie,
  requestPairing,
  touch,
} from "./lan-devices.mjs";

const YEAR = 365 * 24 * 3600;

/** Read the pairing token from data/remote-token, creating it on first use. */
export function loadToken(dataDir) {
  const file = path.join(dataDir, "remote-token");
  try {
    const t = fs.readFileSync(file, "utf8").trim();
    if (t.length >= 32) return t;
  } catch {
    /* create below */
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const t = crypto.randomBytes(24).toString("base64url");
  try {
    fs.writeFileSync(file, t, { flag: "wx" });
    return t;
  } catch {
    return fs.readFileSync(file, "utf8").trim(); // someone else created it first
  }
}

function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const page = (body, script = "") => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mondo</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1424;color:#f0e6d2;font:16px system-ui,sans-serif}
  main{width:min(22rem,calc(100vw - 2rem));display:grid;gap:.75rem}
  h1{margin:0;color:#ff7a1a;letter-spacing:.2em;font-size:1.1rem}
  p{margin:0;color:#b9b2a3;font-size:.95rem;line-height:1.45}
  form{display:grid;gap:.75rem}
  input,button,a.btn{font:inherit;padding:.7rem;border-radius:4px;border:1px solid #8a7a55;background:#161c30;color:inherit;text-align:center;text-decoration:none}
  button,a.btn{background:#ff7a1a;color:#000;font-weight:700;border:0}
  .code{font:700 2.6rem/1 ui-monospace,monospace;letter-spacing:.35em;color:#ffcc00;text-align:center;padding:.5rem 0}
  .err{color:#ffcc00}
</style></head>
<body><main><h1>MONDO</h1>${body}</main>${script ? `<script>${script}</script>` : ""}</body></html>`;

const loginPage = (error = "") =>
  page(`
  <p>Scan the QR code under <b>Settings → Phone access</b> in Mondo on your PC, or paste the pairing token.</p>
  ${error ? `<p class="err">${esc(error)}</p>` : ""}
  <form method="get" action="/__mondo/pair">
    <input name="t" placeholder="Pairing token" autocomplete="off" autocapitalize="off" spellcheck="false">
    <button>Request access</button>
  </form>`);

const waitPage = (code) =>
  page(
    `<p>Waiting for approval on your PC. Check that Mondo shows this code, then click <b>Allow</b>.</p>
     <div class="code">${esc(code)}</div>
     <p id="s">Waiting…</p>`,
    `setInterval(async()=>{try{const r=await fetch('/__mondo/status',{cache:'no-store'});const d=await r.json();
      if(d.status==='approved')location.replace('/');
      else if(d.status!=='pending')location.reload();}catch{}},2000);`,
  );

const endedPage = (msg) =>
  page(`<p>${esc(msg)}</p><a class="btn" href="/__mondo/login">Start again</a>`);

/**
 * Start the gateway. `target` is the local Next server; `getToken` returns the pairing
 * token (read per request, so deleting data/remote-token and restarting rotates it);
 * `dbFile` is Mondo's SQLite database, where devices live.
 */
export function startGateway({ host, port, target, getToken, dbFile }) {
  const targetHost = `${target.host}:${target.port}`;
  const targetOrigin = `http://${targetHost}`;

  let db = null;
  const getDb = () => {
    if (db) return db;
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    db = new DatabaseSync(dbFile);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;");
    db.exec(DEVICES_TABLE_SQL); // the app's migration may not have run yet
    return db;
  };

  const lastTouch = new Map();
  /** The device behind this request's cookie (any status), or null. */
  const deviceOf = (req) => {
    const c = readCookie(req, COOKIE);
    if (!c) return null;
    try {
      return deviceForCookie(getDb(), c, req.socket.remoteAddress ?? "");
    } catch (err) {
      console.error(`[mondo] LAN gateway: ${err.message}`);
      return null;
    }
  };

  /** Copy headers for the local server; returns null if the request is cross-site. */
  const forwardHeaders = (req) => {
    const h = { ...req.headers };
    const origin = h.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) return null;
      } catch {
        return null;
      }
      h.origin = targetOrigin;
    }
    if (h.referer) {
      try {
        const r = new URL(h.referer);
        h.referer = targetOrigin + r.pathname + r.search;
      } catch {
        delete h.referer;
      }
    }
    h["x-forwarded-host"] = req.headers.host ?? "";
    h["x-forwarded-for"] = req.socket.remoteAddress ?? "";
    h.host = targetHost;
    h["x-mondo-remote"] = "1";
    return h;
  };

  const html = (res, status, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers });
    res.end(body);
  };
  const json = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://gateway");
    const device = deviceOf(req);

    if (url.pathname === "/__mondo/login") return html(res, 200, loginPage());

    if (url.pathname === "/__mondo/pair") {
      const t = url.searchParams.get("t")?.trim() ?? "";
      if (!t || !same(t, getToken())) return html(res, t ? 401 : 200, loginPage(t ? "That pairing token didn't match." : ""));
      if (device?.status === "approved") return html(res, 303, "", { Location: "/" });
      if (device?.status === "pending") return html(res, 303, "", { Location: "/__mondo/wait" });
      let r;
      try {
        r = requestPairing(getDb(), { userAgent: req.headers["user-agent"], ip: req.socket.remoteAddress });
      } catch (err) {
        return html(res, 500, endedPage(`Mondo couldn't record the request: ${err.message}`));
      }
      if (r.error) return html(res, 429, endedPage(r.error));
      console.log(`[mondo] LAN gateway: pairing requested by ${req.socket.remoteAddress} (code ${r.code})`);
      return html(res, 303, "", {
        Location: "/__mondo/wait",
        "Set-Cookie": `${COOKIE}=${encodeURIComponent(r.cookie)}; Path=/; Max-Age=${YEAR}; HttpOnly; SameSite=Lax`,
      });
    }

    if (url.pathname === "/__mondo/status") return json(res, 200, { status: device?.status ?? "none" });

    if (url.pathname === "/__mondo/wait" || device?.status !== "approved") {
      if (url.pathname.startsWith("/api/")) return json(res, 401, { error: "this device isn't approved" });
      switch (device?.status) {
        case "approved":
          return html(res, 303, "", { Location: "/" });
        case "pending":
          return html(res, 200, waitPage(device.code));
        case "denied":
          return html(res, 403, endedPage("Access was denied on the PC."));
        case "moved":
          return html(res, 403, endedPage("This phone's network address has changed since it was approved, so Mondo needs to approve it again."));
        case "revoked":
          return html(res, 403, endedPage("This device was signed out of Mondo."));
        case "expired":
          return html(res, 403, endedPage("Nobody approved this device in time."));
        default:
          return html(res, 200, loginPage());
      }
    }

    const now = Date.now();
    if (now - (lastTouch.get(device.id) ?? 0) > 60_000) {
      lastTouch.set(device.id, now);
      try {
        touch(getDb(), device.id, now);
      } catch {
        /* not important */
      }
    }

    const headers = forwardHeaders(req);
    if (!headers) return json(res, 403, { error: "cross-site request blocked" });

    const upstream = http.request(
      { host: target.host, port: target.port, method: req.method, path: req.url, headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Mondo's server isn't answering.");
    });
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  });

  // WebSocket upgrades (the dev server's hot reload).
  server.on("upgrade", (req, socket, head) => {
    const headers = deviceOf(req)?.status === "approved" ? forwardHeaders(req) : null;
    if (!headers) {
      socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return;
    }
    const up = http.request({ host: target.host, port: target.port, method: req.method, path: req.url, headers });
    up.on("upgrade", (upRes, upSocket, upHead) => {
      const lines = [`HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage}`];
      for (let i = 0; i < upRes.rawHeaders.length; i += 2) lines.push(`${upRes.rawHeaders[i]}: ${upRes.rawHeaders[i + 1]}`);
      socket.write(lines.join("\r\n") + "\r\n\r\n");
      if (upHead?.length) socket.write(upHead);
      if (head?.length) upSocket.write(head);
      upSocket.pipe(socket).pipe(upSocket);
      const close = () => {
        socket.destroy();
        upSocket.destroy();
      };
      socket.on("error", close);
      upSocket.on("error", close);
    });
    up.on("error", () => socket.destroy());
    up.end();
  });

  server.on("error", (err) => console.error(`[mondo] LAN gateway: ${err.message}`));
  server.on("close", () => db?.close());
  server.listen(port, host, () => console.log(`[mondo] LAN gateway on http://${host}:${port} (approved devices only)`));
  return server;
}
