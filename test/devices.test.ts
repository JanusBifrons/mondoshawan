import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { PENDING_TTL_MS, decideDevice, listApproved, listPending } from "@/lib/devices";
import { DEVICES_TABLE_SQL as APP_SQL } from "@/lib/schema";
import * as gatewayModule from "../scripts/lan-devices.mjs";

// The gateway module is plain JS; its inferred types are too narrow for these tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gw: any = gatewayModule;
const { DEVICES_TABLE_SQL: GATEWAY_SQL, PENDING_TTL_MS: GATEWAY_TTL, deviceForCookie, deviceName, requestPairing } = gw;

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";

describe("phone pairing", () => {
  it("gateway and app agree on the table and the timeout", () => {
    expect(GATEWAY_SQL).toBe(APP_SQL);
    expect(GATEWAY_TTL).toBe(PENDING_TTL_MS);
  });

  it("a new request is pending with a 4-digit code, and its cookie finds it", () => {
    const db = openDb(":memory:");
    const r = requestPairing(db, { userAgent: UA, ip: "192.168.1.20" });
    expect(r.code).toMatch(/^\d{4}$/);
    const d = deviceForCookie(db, r.cookie);
    expect(d.status).toBe("pending");
    expect(d.name).toBe("iPhone · Safari");
    expect(listPending(db)).toMatchObject([{ id: r.id, code: r.code, name: "iPhone · Safari" }]);
  });

  it("rejects a cookie with the wrong secret", () => {
    const db = openDb(":memory:");
    const r = requestPairing(db, { userAgent: UA });
    const [id] = r.cookie.split(".");
    expect(deviceForCookie(db, `${id}.not-the-secret`)).toBeNull();
    expect(deviceForCookie(db, "garbage")).toBeNull();
    expect(deviceForCookie(db, null)).toBeNull();
  });

  it("approve, then revoke", () => {
    const db = openDb(":memory:");
    const r = requestPairing(db, { userAgent: UA });
    expect(decideDevice(r.id, "revoke", db)).toBe(false); // not approved yet
    expect(decideDevice(r.id, "approve", db)).toBe(true);
    expect(decideDevice(r.id, "approve", db)).toBe(false); // already decided
    expect(deviceForCookie(db, r.cookie).status).toBe("approved");
    expect(listApproved(db)).toHaveLength(1);
    expect(listPending(db)).toHaveLength(0);
    expect(decideDevice(r.id, "revoke", db)).toBe(true);
    expect(deviceForCookie(db, r.cookie).status).toBe("revoked");
    expect(listApproved(db)).toHaveLength(0);
  });

  it("an approved key only works from the address it paired from", () => {
    const db = openDb(":memory:");
    const r = requestPairing(db, { userAgent: UA, ip: "::ffff:192.168.1.20" });
    decideDevice(r.id, "approve", db);
    expect(deviceForCookie(db, r.cookie, "192.168.1.20").status).toBe("approved");
    expect(deviceForCookie(db, r.cookie, "::ffff:192.168.1.20").status).toBe("approved");
    expect(deviceForCookie(db, r.cookie, "192.168.1.66").status).toBe("moved");
  });

  it("deny ends a request", () => {
    const db = openDb(":memory:");
    const r = requestPairing(db, { userAgent: UA });
    expect(decideDevice(r.id, "deny", db)).toBe(true);
    expect(deviceForCookie(db, r.cookie).status).toBe("denied");
    expect(decideDevice(r.id, "approve", db)).toBe(false);
  });

  it("requests lapse and can't be approved late", () => {
    const db = openDb(":memory:");
    const r = requestPairing(db, { userAgent: UA, now: Date.now() - PENDING_TTL_MS - 1000 });
    expect(deviceForCookie(db, r.cookie).status).toBe("expired");
    expect(listPending(db)).toHaveLength(0);
    expect(decideDevice(r.id, "approve", db)).toBe(false);
  });

  it("caps how many requests can wait at once", () => {
    const db = openDb(":memory:");
    for (let i = 0; i < 3; i++) expect(requestPairing(db, { userAgent: UA }).error).toBeUndefined();
    expect(requestPairing(db, { userAgent: UA }).error).toBeTruthy();
  });

  it("names devices from the user agent", () => {
    expect(deviceName("Mozilla/5.0 (Linux; Android 15) AppleWebKit Chrome/140 Mobile Safari/537.36")).toBe("Android · Chrome");
    expect(deviceName("")).toBe("Device · Browser");
  });
});
