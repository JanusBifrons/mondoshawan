import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Read-only check of Claude Code's "Do you trust this folder?" answers, stored per path in
 * ~/.claude.json (`projects[path].hasTrustDialogAccepted`). An interactive agent started in
 * an untrusted folder sits at that question in its window, which nobody can answer from a
 * phone, so Mondo checks first and says so.
 *
 * Claude looks folders up as `C:/forward/slashes`. Older versions saved some answers with
 * backslashes, which no longer match. The rule this follows (seen on this machine): an
 * entry for the exact folder decides; otherwise the nearest parent folder with an entry does.
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

export interface TrustResult {
  trusted: boolean;
  /** The folder whose entry decided, or null if no folder up the tree has one. */
  decidedBy: string | null;
}

export function folderTrust(folder: string, projects: Projects = readProjects()): TrustResult {
  let dir = trustKey(folder);
  for (;;) {
    const entry = projects[dir];
    if (entry && typeof entry.hasTrustDialogAccepted === "boolean") {
      return { trusted: entry.hasTrustDialogAccepted, decidedBy: dir };
    }
    const parent = dir.replace(/\/[^/]+$/, "");
    if (parent === dir || !parent.includes("/")) return { trusted: false, decidedBy: null };
    dir = parent;
  }
}
