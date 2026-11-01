import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Read-only check of Claude Code's "Do you trust this folder?" answers, stored per path in
 * ~/.claude.json (`projects[path].hasTrustDialogAccepted`). An interactive agent started in
 * an untrusted folder sits at that question in its window, which nobody can answer from a
 * phone, so Mondo checks first and says so.
 *
 * Claude looks folders up as `C:/forward/slashes` and only trusts a folder with its own
 * "yes" entry: a trusted parent doesn't count, and worktrees never have entries (all checked
 * on this machine). Older versions saved some answers with backslashes, which no longer match.
 * So agents start in a project's main folder and move into their worktree themselves.
 * Mondo never writes this file: trusting a folder is the user's call.
 */

/** The spelling Claude uses as a key: forward slashes, upper-case drive, no trailing slash. */
export function trustKey(p: string): string {
  let s = path.resolve(p).replace(/\\/g, "/").replace(/\/+$/, "");
  s = s.replace(/^([a-z]):/, (_, d: string) => d.toUpperCase() + ":");
  return s;
}

type Projects = Record<string, { hasTrustDialogAccepted?: boolean }>;

function readProjects(file = path.join(os.homedir(), ".claude.json")): Projects {
  try {
    return (JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8")).projects ?? {}) as Projects;
  } catch {
    return {};
  }
}

export function folderTrusted(folder: string, projects: Projects = readProjects()): boolean {
  return projects[trustKey(folder)]?.hasTrustDialogAccepted === true;
}
