import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataDir, loadConfig } from "./config";

/**
 * Phone access settings, for the Settings page. The gateway itself is
 * scripts/lan-gateway.mjs (started by scripts/serve.mjs); both read the same token file.
 */

export interface RemoteInfo {
  enabled: boolean;
  port: number;
  /** http://<lan-ip>:<port> for each network address, best guess first. */
  urls: string[];
}

export function remoteInfo(): RemoteInfo {
  const lan = loadConfig().server.lan ?? {};
  const port = Number(lan.port ?? 4318);
  const addrs: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254.")) addrs.push(a.address);
    }
  }
  // Home Wi-Fi ranges first, then Tailscale (100.x), then the rest.
  const rank = (ip: string) => (ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : ip.startsWith("100.") ? 2 : 3);
  addrs.sort((a, b) => rank(a) - rank(b));
  return { enabled: !!lan.enabled, port, urls: addrs.map((ip) => `http://${ip}:${port}`) };
}

/** Same logic as loadToken in scripts/lan-gateway.mjs: read data/remote-token, creating it if needed. */
export function remoteToken(): string {
  const dir = dataDir();
  const file = path.join(dir, "remote-token");
  try {
    const t = fs.readFileSync(file, "utf8").trim();
    if (t.length >= 32) return t;
  } catch {
    /* create below */
  }
  fs.mkdirSync(dir, { recursive: true });
  const t = crypto.randomBytes(24).toString("base64url");
  try {
    fs.writeFileSync(file, t, { flag: "wx" });
    return t;
  } catch {
    return fs.readFileSync(file, "utf8").trim();
  }
}
