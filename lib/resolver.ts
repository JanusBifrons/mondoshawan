import { loadConfig } from "./config";
import { getBranch, listWorktrees } from "./git";
import { matchCwd, type MatchResult, type ProjectRoots } from "./match";
import { normalizePath, toNativePath } from "./paths";

/** Caches project worktree lists and per-folder branches so frequent hook events stay cheap. */
const WORKTREE_TTL = 30_000;
const BRANCH_TTL = 5_000;

interface Cache {
  roots: { at: number; key: string; value: ProjectRoots[] } | null;
  branches: Map<string, { at: number; value: string | null }>;
}

const g = globalThis as unknown as { __mondoResolverCache?: Cache };
const cache: Cache = (g.__mondoResolverCache ??= { roots: null, branches: new Map() });

async function projectRoots(force = false): Promise<ProjectRoots[]> {
  const { projects } = loadConfig();
  const key = JSON.stringify(projects);
  const c = cache.roots;
  if (!force && c && c.key === key && Date.now() - c.at < WORKTREE_TTL) return c.value;
  const value = await Promise.all(
    projects.map(async (p) => {
      const wts = await listWorktrees(p.path);
      return { name: p.name, roots: [p.path, ...wts.map((w) => w.path)] };
    }),
  );
  cache.roots = { at: Date.now(), key, value };
  return value;
}

let lastForced = 0;

export async function resolveCwd(cwd: string): Promise<MatchResult> {
  const roots = await projectRoots();
  let m = matchCwd(cwd, roots);
  // Unknown folder, or a subfolder of a main repo (worktrees can be nested inside it, e.g.
  // .claude/worktrees/x): a worktree may have been created since the last check.
  const mainRoot = roots.find((p) => p.name === m.project)?.roots[0];
  const maybeNewWorktree =
    !m.project ||
    (m.root !== null && m.root === mainRoot && normalizePath(cwd) !== normalizePath(m.root));
  if (maybeNewWorktree && Date.now() - lastForced > 5_000) {
    lastForced = Date.now();
    m = matchCwd(cwd, await projectRoots(true));
  }
  return m;
}

export async function branchFor(cwd: string): Promise<string | null> {
  const hit = cache.branches.get(cwd);
  if (hit && Date.now() - hit.at < BRANCH_TTL) return hit.value;
  const value = await getBranch(toNativePath(cwd));
  cache.branches.set(cwd, { at: Date.now(), value });
  return value;
}
