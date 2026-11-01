import os from "node:os";
import { loadConfig } from "./config";

/**
 * Phone access settings, for the Settings page. The gateway itself is
 * scripts/lan-gateway.mjs (started by scripts/serve.mjs).
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

