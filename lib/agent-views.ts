import { getAgents, remoteUrl, type Agent } from "./agents";
import { getDb } from "./db";
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
