// Starts the Next.js server on the configured host/port.
//   node scripts/serve.mjs         -> next start (needs `npm run build` first)
//   node scripts/serve.mjs --dev   -> next dev
// Host/port: MONDO_HOST / MONDO_PORT env, else mondo.config.json "server", else 127.0.0.1:4317.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startGateway } from "./lan-gateway.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dev = process.argv.includes("--dev");

let server = { host: "127.0.0.1", port: 4317 };
let lan = { enabled: false, host: "0.0.0.0", port: 4318 };
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, "mondo.config.json"), "utf8"));
  server = { ...server, ...(cfg.server ?? {}) };
  lan = { ...lan, ...(cfg.server?.lan ?? {}) };
} catch {
  /* use defaults */
}
const host = process.env.MONDO_HOST || server.host;
const port = String(process.env.MONDO_PORT || server.port);

if (!dev && !fs.existsSync(path.join(root, ".next", "BUILD_ID"))) {
  console.error("[mondo] No production build found. Run `npm run build` first, or use `npm run server:dev`.");
  process.exit(1);
}

const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
console.log(`[mondo] ${dev ? "dev" : "production"} server on http://${host}:${port}`);
// process.execPath works under plain Node and under Electron (with ELECTRON_RUN_AS_NODE=1).
const child = spawn(process.execPath, [nextBin, dev ? "dev" : "start", "-H", host, "-p", port], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    MONDO_ROOT: root,
    MONDO_HOST: host,
    MONDO_PORT: port,
    // node:sqlite still prints an "experimental" warning on Node 24; it's stable enough for us.
    NODE_OPTIONS: [process.env.NODE_OPTIONS, "--disable-warning=ExperimentalWarning"].filter(Boolean).join(" "),
  },
});

// Phone access: a gateway on the network, in front of the local server. Phones must be
// approved on the PC before it forwards anything (see scripts/lan-gateway.mjs).
if (lan.enabled && process.env.MONDO_LAN !== "0") {
  const dataDir = process.env.MONDO_DATA_DIR || path.join(root, "data");
  const connectHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  startGateway({
    host: lan.host,
    port: Number(lan.port),
    target: { host: connectHost, port: Number(port) },
    dbFile: process.env.MONDO_DB || path.join(dataDir, "mondo.db"),
  });
}

const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
