import { execFile } from "node:child_process";
import type { ProjectConfig } from "./config";
import type { DB } from "./db";
import { toNativePath } from "./paths";

/**
 * "Code changed since checked": for each Built node, compare the files its Reality cites as
 * evidence between the commit it was checked at and the game's merged code (origin/main,
 * fetched read-only at most every 10 minutes). The project's folder may have another
 * branch checked out, so the working tree isn't used.
 */

export interface CodeChange {
  nodeId: string;
  title: string;
  /** Commit the Reality was written against. */
  since: string;
  /** Evidence files that changed since then. */
  files: string[];
}

export interface Freshness {
  /** The ref compared against, e.g. "origin/main @ 31c7a9e". */
  against: string | null;
  changed: CodeChange[];
  error?: string;
}

/** "src/a.ts:12-30" -> "src/a.ts". Drops anything that doesn't look like a file path. */
export function evidenceFiles(evidence: string[]): string[] {
  const out = new Set<string>();
  for (const e of evidence) {
    const p = String(e).trim().replace(/:\d[\d,\s-]*$/, "").replace(/\\/g, "/");
    if (/^[\w.@-][\w./@ -]*\.\w+$/.test(p) && !p.includes("..")) out.add(p);
  }
  return [...out];
}

function git(cwd: string, args: string[], timeout = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", cwd, ...args], { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, out) =>
      err ? reject(err) : resolve(String(out)),
    );
  });
}

const FETCH_EVERY_MS = 10 * 60 * 1000;
const g = globalThis as unknown as {
  __mondoFetchedAt?: Map<string, number>;
  __mondoFreshness?: Map<string, { key: string; value: Freshness }>;
};
const fetchedAt = (g.__mondoFetchedAt ??= new Map());
const cache = (g.__mondoFreshness ??= new Map());

/** The ref that stands for "the game as merged": origin/main, else origin/master, else HEAD. */
async function mergedRef(cwd: string): Promise<string> {
  for (const ref of ["origin/main", "origin/master"]) {
    try {
      await git(cwd, ["rev-parse", "--verify", "--quiet", ref]);
      return ref;
    } catch {
      /* try the next */
    }
  }
  return "HEAD";
}

export async function codeChanges(db: DB, project: ProjectConfig): Promise<Freshness> {
  const cwd = toNativePath(project.path);
  const now = Date.now();
  if (now - (fetchedAt.get(cwd) ?? 0) > FETCH_EVERY_MS) {
    fetchedAt.set(cwd, now);
    await git(cwd, ["fetch", "--quiet", "origin"], 60_000).catch(() => {}); // offline is fine
  }

  let ref: string;
  let head: string;
  try {
    ref = await mergedRef(cwd);
    head = (await git(cwd, ["rev-parse", "--short", ref])).trim();
  } catch (err) {
    return { against: null, changed: [], error: `Can't read ${project.name}'s git history: ${(err as Error).message}` };
  }

  // Latest Reality per node, for Built nodes that cite evidence at a commit.
  const rows = db
    .prepare(
      `SELECT n.id, n.title, r.commit_sha, r.evidence, r.id AS rev
       FROM design_nodes n
       JOIN design_revisions r ON r.id = (SELECT MAX(id) FROM design_revisions WHERE node_id = n.id AND field = 'reality')
       WHERE n.project = ? AND n.stage != 'retired' AND r.commit_sha IS NOT NULL`,
    )
    .all(project.name) as { id: string; title: string; commit_sha: string; evidence: string | null; rev: number }[];

  const key = `${head}:${rows.map((r) => r.rev).join(",")}`;
  const hit = cache.get(project.name);
  if (hit && hit.key === key) return hit.value;

  const changed: CodeChange[] = [];
  for (const r of rows) {
    let ev: string[] = [];
    try {
      ev = JSON.parse(r.evidence ?? "[]");
    } catch {
      /* none */
    }
    const files = evidenceFiles(ev);
    if (!files.length) continue;
    try {
      const out = await git(cwd, ["diff", "--name-only", r.commit_sha, ref, "--", ...files]);
      const diff = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (diff.length) changed.push({ nodeId: r.id, title: r.title, since: r.commit_sha, files: diff });
    } catch {
      /* unknown commit (e.g. not fetched): skip rather than guess */
    }
  }
  const value: Freshness = { against: `${ref} @ ${head}`, changed };
  cache.set(project.name, { key, value });
  return value;
}

/** The last computed result for a project, without waiting (null until codeChanges has run once). */
export function cachedChanges(project: ProjectConfig): Freshness | null {
  return (cache.get(project.name)?.value as Freshness | undefined) ?? null;
}
