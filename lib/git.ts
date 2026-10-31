import { execFile } from "node:child_process";
import fs from "node:fs";

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", cwd, ...args], { timeout: 3000, windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.toString());
    });
  });
}

export function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Current branch, or `detached@<sha>` when HEAD is detached. Null if not a git folder. */
export async function getBranch(cwd: string): Promise<string | null> {
  try {
    const branch = (await git(cwd, ["branch", "--show-current"])).trim();
    if (branch) return branch;
    const sha = (await git(cwd, ["rev-parse", "--short", "HEAD"])).trim();
    return sha ? `detached@${sha}` : null;
  } catch {
    return null;
  }
}

export interface Worktree {
  path: string;
  head: string | null;
  branch: string | null; // null when detached
  bare: boolean;
}

/** Parse `git worktree list --porcelain`. */
export function parseWorktreePorcelain(out: string): Worktree[] {
  const result: Worktree[] = [];
  for (const block of out.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    if (!lines.length) continue;
    const wt: Worktree = { path: "", head: null, branch: null, bare: false };
    for (const line of lines) {
      if (line.startsWith("worktree ")) wt.path = line.slice(9);
      else if (line.startsWith("HEAD ")) wt.head = line.slice(5);
      else if (line.startsWith("branch ")) wt.branch = line.slice(7).replace(/^refs\/heads\//, "");
      else if (line === "bare") wt.bare = true;
    }
    if (wt.path) result.push(wt);
  }
  return result;
}

export async function listWorktrees(repo: string): Promise<Worktree[]> {
  try {
    return parseWorktreePorcelain(await git(repo, ["worktree", "list", "--porcelain"]));
  } catch {
    return [];
  }
}
