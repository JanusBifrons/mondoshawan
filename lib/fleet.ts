import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAgents, remoteUrl, type Agent } from "./agents";
import { getJobs } from "./jobs";
import { liveSessions, startedFrom, type LiveSession } from "./live-sessions";
import { resolveCwd } from "./resolver";
import type { SessionStatus } from "./status";
import { getStore, type Session } from "./store";

/**
 * The fleet: every Claude Code session on this PC, in one list. It merges three sources:
 *   - Mondo's own agents (lib/agents.ts);
 *   - Claude's live-session registry (lib/live-sessions.ts), the source of truth for what's
 *     running now, including sessions you started yourself;
 *   - Mondo's hook rows (lib/store.ts), for status detail (working, waiting, needs
 *     permission), the last message, the System tag and recently ended sessions.
 * Items are keyed by Claude session id, which is also the drill-down URL (/agents/<id>).
 */

export type Shown = "starting" | "working" | "waiting" | "needs_permission" | "idle" | "stopped" | "failed";

export interface FleetItem {
  sessionId: string;
  /** Who started it. */
  origin: "mondo" | "you";
  /** Where it runs: "Git Bash window" for Mondo agents, else "terminal", "desktop app", … */
  from: string;
  name: string;
  project: string | null;
  cwd: string;
  worktree: string;
  branch: string | null;
  shown: Shown;
  live: boolean;
  lastMessage: string | null;
  lastActivity: number;
  startedAt: number | null;
  remoteUrl: string | null;
  system: string;
  /** Mondo agent details, when Mondo started it. */
  agentId: string | null;
  permissionMode: string | null;
  model: string | null;
  worktreeName: string | null;
  exitInfo: string | null;
  transcriptPath: string | null;
  canStop: boolean;
  canResume: boolean;
  canForget: boolean;
}

/** How long ended sessions stay in the list. */
const ENDED_FOR_MS = 7 * 24 * 3600 * 1000;

const fromHook = (s: SessionStatus): Shown => (s === "ended" ? "stopped" : s);

function agentShown(a: Agent, row: Session | undefined): Shown {
  if (a.status === "starting") return "starting";
  if (a.status === "failed") return "failed";
  if (a.status === "stopped") return "stopped";
  return row ? fromHook(row.status) : "idle";
}

const agentLive = (a: Agent) => a.status === "starting" || a.status === "running" || (a.status === "failed" && !!a.pid);

export async function fleet(now = Date.now()): Promise<FleetItem[]> {
  const rows = new Map(getStore().list().map((s) => [s.id, s]));
  const live = new Map<string, LiveSession>(liveSessions().map((l) => [l.sessionId, l]));
  const items: FleetItem[] = [];
  // Background jobs have their own list; don't show their sessions here too.
  const seen = getJobs().sessionIds();

  for (const a of getAgents().list()) {
    const row = rows.get(a.sessionId);
    const isLive = agentLive(a);
    items.push({
      sessionId: a.sessionId,
      origin: "mondo",
      from: "Git Bash window",
      name: a.name,
      project: a.project,
      cwd: row?.cwd ?? a.cwd,
      worktree: row?.worktree || a.worktreeName || path.basename(a.cwd),
      branch: row?.branch ?? null,
      shown: agentShown(a, row),
      live: isLive,
      lastMessage: row?.lastMessage ?? null,
      lastActivity: Math.max(a.lastActivity, row?.lastActivity ?? 0),
      startedAt: a.createdAt,
      remoteUrl: isLive ? remoteUrl(a.pid) : null,
      system: row?.system ?? "",
      agentId: a.id,
      permissionMode: a.permissionMode,
      model: a.model,
      worktreeName: a.worktreeName,
      exitInfo: a.exitInfo,
      transcriptPath: row?.transcriptPath ?? null,
      canStop: isLive && !!a.pid,
      canResume: !isLive,
      canForget: !isLive,
    });
    seen.add(a.sessionId);
  }

  for (const l of live.values()) {
    if (seen.has(l.sessionId)) continue;
    const row = rows.get(l.sessionId);
    const match = row ? null : await resolveCwd(l.cwd);
    items.push({
      sessionId: l.sessionId,
      origin: "you",
      from: startedFrom(l.entrypoint),
      name: l.name ?? row?.worktree ?? "Claude session",
      project: row?.project ?? match?.project ?? null,
      cwd: l.cwd,
      worktree: row?.worktree ?? match?.worktree ?? "",
      branch: row?.branch ?? null,
      // The hooks know about turns and permission prompts; Claude's own state is the fallback.
      shown: row && row.status !== "ended" ? fromHook(row.status) : l.state === "busy" ? "working" : "idle",
      live: true,
      lastMessage: row?.lastMessage ?? null,
      lastActivity: row?.lastActivity ?? l.startedAt ?? 0,
      startedAt: l.startedAt ?? row?.startedAt ?? null,
      remoteUrl: l.remoteUrl,
      system: row?.system ?? "",
      agentId: null,
      permissionMode: null,
      model: null,
      worktreeName: null,
      exitInfo: null,
      transcriptPath: row?.transcriptPath ?? null,
      canStop: true,
      canResume: false,
      canForget: false,
    });
    seen.add(l.sessionId);
  }

  // Hook rows for sessions that aren't running any more (ended, or gone without a goodbye).
  for (const row of rows.values()) {
    if (seen.has(row.id) || now - row.lastActivity > ENDED_FOR_MS) continue;
    items.push({
      sessionId: row.id,
      origin: "you",
      from: "terminal",
      name: row.worktree || "Claude session",
      project: row.project,
      cwd: row.cwd,
      worktree: row.worktree,
      branch: row.branch,
      shown: "stopped",
      live: false,
      lastMessage: row.status === "ended" ? row.lastMessage : "Not running any more",
      lastActivity: row.lastActivity,
      startedAt: row.startedAt,
      remoteUrl: null,
      system: row.system,
      agentId: null,
      permissionMode: null,
      model: null,
      worktreeName: null,
      exitInfo: null,
      transcriptPath: row.transcriptPath,
      canStop: false,
      canResume: false,
      canForget: true,
    });
  }

  return items.sort((a, b) => b.lastActivity - a.lastActivity);
}

export async function fleetItem(sessionId: string): Promise<FleetItem | null> {
  return (await fleet()).find((i) => i.sessionId === sessionId) ?? null;
}

/** Statuses that need the owner. */
export const needsYou = (i: FleetItem) => i.live && (i.shown === "waiting" || i.shown === "needs_permission" || i.shown === "failed");

// ---- Recent activity, read from the session's saved conversation (read-only) ----

export interface ActivityLine {
  at: number | null;
  kind: "you" | "claude" | "tool";
  text: string;
}

/** Claude's per-project folder name: every non-alphanumeric character becomes "-". */
export const projectFolder = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, "-");

/** The session's .jsonl transcript: the hook's path if known, else Claude's usual location. */
export function transcriptFile(item: Pick<FleetItem, "sessionId" | "cwd" | "transcriptPath">): string | null {
  const candidates = [
    item.transcriptPath,
    path.join(os.homedir(), ".claude", "projects", projectFolder(item.cwd), `${item.sessionId}.jsonl`),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(/*turbopackIgnore: true*/ c)) return c;
  }
  return null;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

function toolLine(name: string, input: Record<string, unknown> | undefined): string {
  const i = input ?? {};
  for (const k of ["description", "command", "file_path", "path", "pattern", "url", "query", "prompt", "name"]) {
    if (typeof i[k] === "string" && i[k]) return `${name}: ${clip(String(i[k]).replace(/\s+/g, " "), 140)}`;
  }
  return name;
}

/** Pull the last `limit` human-readable lines from transcript JSONL text. Pure, for tests. */
export function parseActivity(jsonl: string, limit = 30): ActivityLine[] {
  const out: ActivityLine[] = [];
  for (const raw of jsonl.split("\n")) {
    if (!raw.trim()) continue;
    let e: { type?: string; timestamp?: string; isMeta?: boolean; message?: { content?: unknown } };
    try {
      e = JSON.parse(raw);
    } catch {
      continue; // first line of a tail read may be cut
    }
    if ((e.type !== "user" && e.type !== "assistant") || e.isMeta) continue;
    const at = e.timestamp ? Date.parse(e.timestamp) || null : null;
    const content = e.message?.content;
    const blocks: { type?: string; text?: string; name?: string; input?: Record<string, unknown> }[] =
      typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
    for (const b of blocks) {
      if (b.type === "text" && b.text?.trim()) {
        const text = b.text.trim();
        // Skip harness noise (command wrappers, interrupted markers, reminders).
        if (/^<(command|local-command|system-reminder|task-notification)/.test(text) || /^\[Request interrupted/.test(text)) continue;
        out.push({ at, kind: e.type === "user" ? "you" : "claude", text: clip(text, 600) });
      } else if (b.type === "tool_use" && b.name) {
        out.push({ at, kind: "tool", text: toolLine(b.name, b.input) });
      }
    }
  }
  return out.slice(-limit);
}

/** The last lines of a session's conversation. Reads only the end of the file. */
export function recentActivity(file: string | null, limit = 30): ActivityLine[] {
  if (!file) return [];
  try {
    const fd = fs.openSync(/*turbopackIgnore: true*/ file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const len = Math.min(size, 512 * 1024);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      return parseActivity(buf.toString("utf8"), limit);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
}
