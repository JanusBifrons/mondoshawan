import { getAgents, remoteUrl, type Agent } from "./agents";
import { getDb } from "./db";
import { liveSessions, startedFrom } from "./live-sessions";
import { resolveCwd } from "./resolver";
import type { SessionStatus } from "./status";

/** An agent plus what the hooks say about its Claude session (status, branch, last message). */
export interface AgentView extends Agent {
  /** claude.ai link to its Remote Control session, once Claude has registered it. */
  remoteUrl: string | null;
  session: {
    status: SessionStatus;
    cwd: string;
    worktree: string;
    branch: string | null;
    lastMessage: string | null;
    lastActivity: number;
  } | null;
}

interface SessionRow {
  id: string;
  status: string;
  cwd: string;
  worktree: string;
  branch: string | null;
  last_message: string | null;
  last_activity: number;
}

export function agentViews(): AgentView[] {
  return getAgents().list().map(withSession);
}

export function agentView(id: string): AgentView | null {
  const a = getAgents().get(id);
  return a ? withSession(a) : null;
}

function withSession(a: Agent): AgentView {
  const s = getDb().prepare("SELECT * FROM sessions WHERE id = ?").get(a.sessionId) as SessionRow | undefined;
  return {
    ...a,
    remoteUrl: a.status === "running" || a.status === "starting" ? remoteUrl(a.pid) : null,
    session: s
      ? {
          status: s.status as SessionStatus,
          cwd: s.cwd,
          worktree: s.worktree,
          branch: s.branch,
          lastMessage: s.last_message,
          lastActivity: s.last_activity,
        }
      : null,
  };
}

/** A running Claude session that Mondo didn't start (your terminals, the desktop app, …). */
export interface OtherSessionView {
  sessionId: string;
  pid: number;
  name: string | null;
  /** "terminal", "desktop app", "script", … */
  from: string;
  project: string | null;
  cwd: string;
  worktree: string;
  branch: string | null;
  status: SessionStatus;
  lastMessage: string | null;
  lastActivity: number;
  remoteUrl: string | null;
}

interface FullSessionRow extends SessionRow {
  project: string | null;
}

/** Every live Claude session on this PC that isn't one of Mondo's agents. */
export async function otherSessions(): Promise<OtherSessionView[]> {
  const mine = new Set(getAgents().list().map((a) => a.sessionId));
  const db = getDb();
  const out: OtherSessionView[] = [];
  for (const s of liveSessions()) {
    if (mine.has(s.sessionId)) continue;
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(s.sessionId) as FullSessionRow | undefined;
    const match = row ? null : await resolveCwd(s.cwd);
    out.push({
      sessionId: s.sessionId,
      pid: s.pid,
      name: s.name,
      from: startedFrom(s.entrypoint),
      project: row?.project ?? match?.project ?? null,
      cwd: s.cwd,
      worktree: row?.worktree ?? match?.worktree ?? "",
      branch: row?.branch ?? null,
      // The hooks know about permission prompts and turns; Claude's own state is the fallback.
      status: (row?.status as SessionStatus) ?? (s.state === "busy" ? "working" : "idle"),
      lastMessage: row?.last_message ?? null,
      lastActivity: row?.last_activity ?? s.startedAt ?? 0,
      remoteUrl: s.remoteUrl,
    });
  }
  return out.sort((a, b) => b.lastActivity - a.lastActivity);
}
