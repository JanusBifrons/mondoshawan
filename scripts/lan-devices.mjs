// Phone pairing, gateway side (used by scripts/lan-gateway.mjs). The PC side, which lists and
// approves devices, is lib/devices.ts. They share the devices table; test/devices.test.ts
// checks the table SQL and the pending timeout match.
// (Not imported by the Next app: a .mjs in its server graph makes the dev server reload in a loop.)
//
// Flow: the phone opens the gateway and taps Request access -> a "pending" device
// is created with a 4-digit code and the phone gets a cookie holding its own secret ->
// the PC shows "Allow this phone? code 1234" -> once approved, that cookie is the phone's key.
// Only a hash of each secret is stored. Revoking a device kills its cookie.
import crypto from "node:crypto";

/** Must match migration 3 in lib/schema.ts (the gateway may run first, hence IF NOT EXISTS). */
export const DEVICES_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS devices (
    id          TEXT PRIMARY KEY,
    secret_hash TEXT NOT NULL,
    name        TEXT NOT NULL,
    code        TEXT NOT NULL,
    status      TEXT NOT NULL,
    ip          TEXT,
    created_at  INTEGER NOT NULL,
    decided_at  INTEGER,
    last_seen   INTEGER
  );
`;

export const COOKIE = "mondo_device";
/** A pairing request the PC hasn't answered within this time lapses. */
export const PENDING_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 3;

const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");

function sameHex(a, b) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

/** "iPhone · Safari", "Android · Chrome", … from a User-Agent header. */
export function deviceName(ua = "") {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Device";
  const browser = /EdgA?\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /Firefox|FxiOS/.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${os} · ${browser}`;
}

/** Split a "<id>.<secret>" cookie value. */
export function parseCookie(value) {
  if (typeof value !== "string") return null;
  const i = value.indexOf(".");
  if (i <= 0) return null;
  return { id: value.slice(0, i), secret: value.slice(i + 1) };
}

/** Strip the IPv4-in-IPv6 prefix so "::ffff:192.168.1.5" and "192.168.1.5" compare equal. */
const plainIp = (ip) => String(ip ?? "").replace(/^::ffff:/, "");

/**
 * Find the device a cookie belongs to, if the secret matches. Any status.
 * When `ip` is given, an approved device used from a different address than it paired
 * from comes back as "moved": a copied cookie is useless on another machine.
 */
export function deviceForCookie(db, value, ip) {
  const c = parseCookie(value);
  if (!c) return null;
  const row = db.prepare("SELECT * FROM devices WHERE id = ?").get(c.id);
  if (!row || !sameHex(row.secret_hash, hash(c.secret))) return null;
  if (row.status === "pending" && row.created_at < Date.now() - PENDING_TTL_MS) return { ...row, status: "expired" };
  if (row.status === "approved" && ip !== undefined && row.ip && plainIp(row.ip) !== plainIp(ip)) return { ...row, status: "moved" };
  return row;
}

/**
 * Start pairing. Returns { cookie, code } or { error } when too many requests are waiting
 * (stops someone with the QR code from flooding the PC with prompts).
 */
export function requestPairing(db, { userAgent, ip, now = Date.now() }) {
  const waiting = db
    .prepare("SELECT COUNT(*) AS n FROM devices WHERE status = 'pending' AND created_at >= ?")
    .get(now - PENDING_TTL_MS).n;
  if (waiting >= MAX_PENDING) return { error: "Too many devices are waiting for approval. Answer them on the PC first." };
  const id = crypto.randomBytes(8).toString("hex");
  const secret = crypto.randomBytes(32).toString("base64url");
  const code = String(crypto.randomInt(0, 10000)).padStart(4, "0");
  db.prepare(
    `INSERT INTO devices (id, secret_hash, name, code, status, ip, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(id, hash(secret), deviceName(userAgent), code, ip ?? null, now);
  return { id, code, cookie: `${id}.${secret}` };
}

export function touch(db, id, now = Date.now()) {
  db.prepare("UPDATE devices SET last_seen = ? WHERE id = ?").run(now, id);
}
