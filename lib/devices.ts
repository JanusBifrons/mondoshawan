import { getDb, type DB } from "./db";

/**
 * Phones paired through the LAN gateway: the PC side (list, approve, deny, revoke).
 * The gateway side (pairing requests, cookie checks) is scripts/lan-devices.mjs; both use
 * the `devices` table. test/devices.test.ts checks the shared constants match.
 */

/** A pairing request the PC hasn't answered within this time lapses. Same as the gateway's. */
export const PENDING_TTL_MS = 10 * 60 * 1000;

export interface PendingDevice {
  id: string;
  name: string;
  code: string;
  ip: string | null;
  createdAt: number;
}

export interface ApprovedDevice {
  id: string;
  name: string;
  ip: string | null;
  createdAt: number;
  approvedAt: number | null;
  lastSeen: number | null;
}

interface Row {
  id: string;
  name: string;
  code: string;
  ip: string | null;
  created_at: number;
  decided_at: number | null;
  last_seen: number | null;
}

export function listPending(db: DB = getDb(), now = Date.now()): PendingDevice[] {
  const rows = db
    .prepare("SELECT * FROM devices WHERE status = 'pending' AND created_at >= ? ORDER BY created_at")
    .all(now - PENDING_TTL_MS) as unknown as Row[];
  return rows.map((r) => ({ id: r.id, name: r.name, code: r.code, ip: r.ip, createdAt: r.created_at }));
}

export function listApproved(db: DB = getDb()): ApprovedDevice[] {
  const rows = db
    .prepare("SELECT * FROM devices WHERE status = 'approved' ORDER BY decided_at DESC")
    .all() as unknown as Row[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    ip: r.ip,
    createdAt: r.created_at,
    approvedAt: r.decided_at,
    lastSeen: r.last_seen,
  }));
}

export type DeviceAction = "approve" | "deny" | "revoke";

/** approve / deny a live pending request, or revoke an approved device. True if something changed. */
export function decideDevice(id: string, action: DeviceAction, db: DB = getDb(), now = Date.now()): boolean {
  const res =
    action === "revoke"
      ? db.prepare("UPDATE devices SET status = 'revoked', decided_at = ? WHERE id = ? AND status = 'approved'").run(now, id)
      : db
          .prepare("UPDATE devices SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending' AND created_at >= ?")
          .run(action === "approve" ? "approved" : "denied", now, id, now - PENDING_TTL_MS);
  return res.changes > 0;
}

/** True when the request came through the LAN gateway (i.e. from a phone, not this PC). */
export function isRemote(req: Request): boolean {
  return req.headers.get("x-mondo-remote") === "1";
}
