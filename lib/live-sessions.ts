import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Every Claude Code session running on this PC, from Claude's own registry
 * (~/.claude/sessions/<pid>.json, one file per running process). Read-only.
 * Files can outlive their process, so only entries whose PID is alive are returned.
 */

export interface LiveSession {
  pid: number;
  sessionId: string;
  cwd: string;
  name: string | null;
  /** Claude's own state: "busy" | "idle" | … */
  state: string | null;
  /** How it was started: "cli" (a terminal), "claude-desktop", "sdk-ts", … */
  entrypoint: string | null;
  kind: string | null;
  startedAt: number | null;
  /** claude.ai link when the session has Remote Control on. */
  remoteUrl: string | null;
}

export function registryDir(): string {
  return process.env.MONDO_CLAUDE_SESSIONS || path.join(os.homedir(), ".claude", "sessions");
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** Parse one registry file's JSON; null if it isn't a usable entry. */
export function parseEntry(j: Record<string, unknown>): LiveSession | null {
  const pid = Number(j.pid);
  const sessionId = str(j.sessionId);
  if (!pid || !sessionId) return null;
  const bridge = str(j.bridgeSessionId);
  return {
    pid,
    sessionId,
    cwd: str(j.cwd) ?? "",
    name: str(j.name),
    state: str(j.status),
    entrypoint: str(j.entrypoint),
    kind: str(j.kind),
    startedAt: typeof j.startedAt === "number" ? j.startedAt : null,
    remoteUrl: bridge && /^session_[A-Za-z0-9]+$/.test(bridge) ? `https://claude.ai/code/${bridge}` : null,
  };
}

export function liveSessions(dir = registryDir(), alive = isAlive): LiveSession[] {
  let files: string[];
  try {
    files = fs.readdirSync(/*turbopackIgnore: true*/ dir).filter((f) => /^\d+\.json$/.test(f));
  } catch {
    return [];
  }
  const out: LiveSession[] = [];
  for (const f of files) {
    try {
      const e = parseEntry(JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ path.join(dir, f), "utf8")));
      if (e && alive(e.pid)) out.push(e);
    } catch {
      /* being rewritten; next poll */
    }
  }
  return out;
}

/** Where a session was started, for its tag. */
export function startedFrom(entrypoint: string | null): string {
  if (!entrypoint || entrypoint === "cli") return "terminal";
  if (entrypoint.includes("desktop")) return "desktop app";
  if (entrypoint.startsWith("sdk")) return "script";
  if (entrypoint.includes("vscode") || entrypoint.includes("ide")) return "editor";
  return entrypoint;
}
