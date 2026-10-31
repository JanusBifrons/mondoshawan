import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, projectSlug, type ProjectConfig } from "./config";
import { dirExists } from "./git";

/**
 * Knowledge index: collects a project's written sources into one list.
 *  - repo:   markdown files tracked by git in the project (dates from git history)
 *  - folder: markdown in extra folders from config, e.g. the wrapper Design/ folder (dates from disk)
 *  - link:   hand-listed external docs from config, e.g. Google Drive
 */

export type Origin = "repo" | "folder" | "link";

export interface KnowledgeSource {
  id: string;
  project: string;
  projectSlug: string;
  title: string;
  summary: string | null;
  category: string;
  origin: Origin;
  originLabel: string;
  relPath: string | null;
  url: string | null;
  modified: string | null;
  flags: string[];
  words: number | null;
}

interface IndexedSource extends KnowledgeSource {
  absPath: string | null;
}

export const CATEGORY_ORDER = [
  "Design",
  "Plans",
  "Architecture",
  "Features",
  "Handoffs",
  "Bugs & feedback",
  "Guides",
  "Ops & perf",
  "Agent skills",
  "Other",
];

const DEFAULT_EXCLUDE = ["node_modules/", ".next/", "dist/"];
const CACHE_MS = 30_000;
const MAX_FOLDER_DEPTH = 6;

function run(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", cwd, "-c", "core.quotepath=false", ...args],
      { timeout: 15_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(stdout.toString())),
    );
  });
}

export function categorize(relPath: string, origin: Origin): string {
  const p = relPath.replace(/\\/g, "/").toLowerCase();
  const name = p.split("/").pop() ?? p;
  if (origin === "folder") return "Design";
  if (name.startsWith("handoff")) return "Handoffs";
  if (p.startsWith(".claude/skills/")) return "Agent skills";
  if (p.includes("architecture/")) return "Architecture";
  if (p.includes("features/")) return "Features";
  if (/(^|\/)plans?\//.test(p) || name.startsWith("plan")) return "Plans";
  if (/(^|\/)(design|gdd)\//.test(p)) return "Design";
  if (/(^|\/)(perf|ops|refactors?|deploy\w*)\//.test(p)) return "Ops & perf";
  if (/bug|feedback|playtest/.test(name)) return "Bugs & feedback";
  if (!p.includes("/") || /^(readme|claude|agents|lessons|manifest|feel_goals|contributing)/.test(name)) return "Guides";
  return "Other";
}

/** Title, one-line summary and status flags from a markdown file's text. */
export function describeMarkdown(text: string, fallbackTitle: string) {
  const lines = text.split(/\r?\n/);
  let title: string | null = null;
  let summary: string | null = null;
  let inFence = false;
  for (const raw of lines.slice(0, 80)) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !line || line === "---") continue;
    if (!title && /^#\s+/.test(line)) {
      title = line.replace(/^#\s+/, "").trim();
      continue;
    }
    if (/^(#|>|\||-{3,}|<!--|!\[)/.test(line) || /^\w+:\s/.test(line) && !title) continue;
    if (!summary) {
      summary = line
        .replace(/^[-*+]\s+|^\d+\.\s+/, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/[*_`]/g, "")
        .trim();
      if (summary.length > 200) summary = summary.slice(0, 197).trimEnd() + "…";
    }
    if (title && summary) break;
  }
  // Only explicit status markers count, e.g. "Status: draft" or a "SUPERSEDED" banner near the top.
  const head = text.slice(0, 1500);
  const flags = new Set<string>();
  for (const m of head.matchAll(/status\**\s*[:—-]\s*\**\s*(draft|historical|superseded|deprecated|wip|obsolete)/gi)) {
    flags.add(m[1].toLowerCase());
  }
  for (const m of head.matchAll(/\b(SUPERSEDED|DEPRECATED|OBSOLETE|HISTORICAL)\b/g)) flags.add(m[1].toLowerCase());
  const words = text.split(/\s+/).filter(Boolean).length;
  return { title: title ?? fallbackTitle, summary, flags: [...flags], words };
}

function readSafe(file: string): string {
  try {
    return fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8");
  } catch {
    return "";
  }
}

const titleFromFile = (rel: string) =>
  (rel.split("/").pop() ?? rel).replace(/\.mdx?$/i, "").replace(/[-_]+/g, " ");

async function repoSources(p: ProjectConfig): Promise<IndexedSource[]> {
  if (!dirExists(p.path)) return [];
  const exclude = [...DEFAULT_EXCLUDE, ...(p.knowledge?.exclude ?? [])].map((e) => e.replace(/\\/g, "/").toLowerCase());
  let files: string[];
  try {
    files = (await run(p.path, ["ls-files", "--", "*.md", "*.mdx"])).split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
  files = files.filter((f) => !exclude.some((e) => f.toLowerCase().startsWith(e)));

  // Last commit date per file, from one git log pass (newest first, so first sighting wins).
  const dates = new Map<string, string>();
  try {
    const log = await run(p.path, ["log", "-n", "5000", "--format=@@%cI", "--name-only", "--", "*.md", "*.mdx"]);
    let current = "";
    for (const line of log.split(/\r?\n/)) {
      if (line.startsWith("@@")) current = line.slice(2);
      else if (line && !dates.has(line)) dates.set(line, current);
    }
  } catch {
    /* dates are optional */
  }

  const slug = projectSlug(p.name);
  return files.map((rel) => {
    const absPath = path.join(p.path, rel);
    const d = describeMarkdown(readSafe(absPath), titleFromFile(rel));
    return {
      id: `repo:${rel}`,
      project: p.name,
      projectSlug: slug,
      ...d,
      category: categorize(rel, "repo"),
      origin: "repo" as const,
      originLabel: "Repo",
      relPath: rel,
      url: null,
      modified: dates.get(rel) ?? null,
      absPath,
    };
  });
}

function walkMarkdown(dir: string, depth = 0, base = dir): string[] {
  if (depth > MAX_FOLDER_DEPTH) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(/*turbopackIgnore: true*/ dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMarkdown(full, depth + 1, base));
    else if (/\.mdx?$/i.test(e.name)) out.push(path.relative(base, full).replace(/\\/g, "/"));
  }
  return out;
}

function folderSources(p: ProjectConfig): IndexedSource[] {
  const slug = projectSlug(p.name);
  return (p.knowledge?.folders ?? []).flatMap((folder, i) =>
    walkMarkdown(folder.path).map((rel) => {
      const absPath = path.join(folder.path, rel);
      let modified: string | null = null;
      try {
        modified = fs.statSync(/*turbopackIgnore: true*/ absPath).mtime.toISOString();
      } catch {
        /* ignore */
      }
      return {
        id: `folder${i}:${rel}`,
        project: p.name,
        projectSlug: slug,
        ...describeMarkdown(readSafe(absPath), titleFromFile(rel)),
        category: categorize(rel, "folder"),
        origin: "folder" as const,
        originLabel: folder.label,
        relPath: rel,
        url: null,
        modified,
        absPath,
      };
    }),
  );
}

function linkSources(p: ProjectConfig): IndexedSource[] {
  const slug = projectSlug(p.name);
  return (p.knowledge?.links ?? []).map((l, i) => ({
    id: `link${i}`,
    project: p.name,
    projectSlug: slug,
    title: l.title,
    summary: l.note ?? null,
    category: l.category ?? "Other",
    origin: "link" as const,
    originLabel: l.source,
    relPath: null,
    url: l.url,
    modified: l.modified ?? null,
    flags: [],
    words: null,
    absPath: null,
  }));
}

const g = globalThis as unknown as { __mondoKnowledge?: Map<string, { at: number; value: IndexedSource[] }> };
const cache = (g.__mondoKnowledge ??= new Map());

async function indexProject(p: ProjectConfig): Promise<IndexedSource[]> {
  const key = JSON.stringify(p);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = [...(await repoSources(p)), ...folderSources(p), ...linkSources(p)];
  cache.set(key, { at: Date.now(), value });
  return value;
}

const strip = ({ absPath: _abs, ...s }: IndexedSource): KnowledgeSource => s;

export async function getKnowledge(slug?: string): Promise<KnowledgeSource[]> {
  const projects = loadConfig().projects.filter((p) => !slug || projectSlug(p.name) === slug);
  const all = (await Promise.all(projects.map(indexProject))).flat();
  return all.map(strip);
}

/** Full text of one indexed markdown source. Only ids from the index resolve, so no path tricks. */
export async function getKnowledgeDoc(slug: string, id: string) {
  const p = loadConfig().projects.find((x) => projectSlug(x.name) === slug);
  if (!p) return null;
  const src = (await indexProject(p)).find((s) => s.id === id);
  if (!src || !src.absPath) return null;
  return { source: strip(src), content: readSafe(src.absPath), absPath: src.absPath };
}
