import fs from "node:fs";
import path from "node:path";

export interface ProjectConfig {
  name: string;
  path: string;
}

export interface MondoConfig {
  server: { host: string; port: number };
  projects: ProjectConfig[];
}

const DEFAULTS: MondoConfig = {
  server: { host: "127.0.0.1", port: 4317 },
  projects: [],
};

/** Repo root. The server is always started from here (scripts/serve.mjs sets cwd). */
export function rootDir(): string {
  return process.env.MONDO_ROOT || process.cwd();
}

export function configPath(): string {
  return process.env.MONDO_CONFIG || path.join(rootDir(), "mondo.config.json");
}

export function dataDir(): string {
  return process.env.MONDO_DATA_DIR || path.join(rootDir(), "data");
}

/** Read fresh each call (file is tiny) so edits apply without a restart. */
export function loadConfig(): MondoConfig {
  let raw: Partial<MondoConfig> = {};
  try {
    // Runtime config, not a bundled asset, so tell Turbopack not to trace it.
    raw = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ configPath(), "utf8"));
  } catch (err) {
    console.warn(`[mondo] could not read ${configPath()}: ${(err as Error).message}`);
  }
  const server = { ...DEFAULTS.server, ...(raw.server ?? {}) };
  if (process.env.MONDO_HOST) server.host = process.env.MONDO_HOST;
  if (process.env.MONDO_PORT) server.port = Number(process.env.MONDO_PORT);
  const projects = Array.isArray(raw.projects)
    ? raw.projects.filter((p) => p && typeof p.name === "string" && typeof p.path === "string")
    : [];
  return { server, projects };
}
