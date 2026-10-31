// Starts the Next.js server on the configured host/port.
//   node scripts/serve.mjs         -> next start (needs `npm run build` first)
//   node scripts/serve.mjs --dev   -> next dev
// Host/port: MONDO_HOST / MONDO_PORT env, else mondo.config.json "server", else 127.0.0.1:4317.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dev = process.argv.includes("--dev");

let server = { host: "127.0.0.1", port: 4317 };
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, "mondo.config.json"), "utf8"));
  server = { ...server, ...(cfg.server ?? {}) };
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
  env: { ...process.env, MONDO_ROOT: root, MONDO_HOST: host, MONDO_PORT: port },
});

const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
