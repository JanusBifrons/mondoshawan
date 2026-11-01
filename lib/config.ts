import fs from "node:fs";
import path from "node:path";

export interface KnowledgeLink {
  title: string;
  url: string;
  /** Where it lives, e.g. "Google Drive". */
  source: string;
  /** Optional category override, e.g. "Bugs". */
  category?: string;
  modified?: string;
  note?: string;
}

export interface KnowledgeConfig {
  /** Extra folders outside the repo to index (e.g. the wrapper Design/ folder). */
  folders?: { path: string; label: string }[];
  /** Repo-relative glob-ish prefixes to skip (e.g. "diag/"). */
  exclude?: string[];
  /** Hand-listed external sources (Google Drive docs etc.). */
  links?: KnowledgeLink[];
  /** Google Drive folder mirrored by the drive-sync skill (name in My Drive, optional pinned id). */
  drive?: { folder: string; folderId?: string };
}

export interface ProjectConfig {
  name: string;
  path: string;
  knowledge?: KnowledgeConfig;
}

/** URL-safe id for a project name: "EQX-Net" -> "eqx-net". */
export function projectSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function findProject(slug: string): ProjectConfig | undefined {
  return loadConfig().projects.find((p) => projectSlug(p.name) === slug);
}

export interface JobsConfig {
  /** Model for background jobs (alias like "sonnet" or a full id). Default "sonnet". */
  model?: string;
  /** Effort for background jobs: low | medium | high | xhigh | max. Default "medium". */
  effort?: string;
}

export interface MondoConfig {
  server: { host: string; port: number; lan?: { enabled?: boolean; host?: string; port?: number } };
  projects: ProjectConfig[];
  jobs: JobsConfig;
}

const DEFAULTS: MondoConfig = {
  server: { host: "127.0.0.1", port: 4317 },
  projects: [],
  jobs: {},
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
  const jobs: JobsConfig = raw.jobs && typeof raw.jobs === "object" ? raw.jobs : {};
  return { server, projects, jobs };
}
