import { baseName, isWithin, normalizePath } from "./paths";

export interface ProjectRoots {
  name: string;
  /** Main project path plus every worktree path (any spelling; normalised here). */
  roots: string[];
}

export interface MatchResult {
  project: string | null;
  /** Folder name of the matched worktree root, or the cwd's own folder name if unmatched. */
  worktree: string;
  /** The matched root as given (original casing), or null. */
  root: string | null;
}

/** Find the project whose root (main path or worktree) is the longest prefix of cwd. */
export function matchCwd(cwd: string, projects: ProjectRoots[]): MatchResult {
  const target = normalizePath(cwd);
  let best: { project: string; root: string; len: number } | null = null;
  for (const p of projects) {
    for (const root of p.roots) {
      const norm = normalizePath(root);
      if (isWithin(target, norm) && (!best || norm.length > best.len)) {
        best = { project: p.name, root, len: norm.length };
      }
    }
  }
  if (!best) return { project: null, worktree: baseName(cwd), root: null };
  return { project: best.project, worktree: baseName(best.root), root: best.root };
}
