export type SessionStatus = "idle" | "working" | "waiting" | "needs_permission" | "ended";

export interface HookPayload {
  session_id: string;
  hook_event_name: string;
  cwd?: string;
  transcript_path?: string;
  notification_type?: string;
  message?: string;
  source?: string; // SessionStart
  reason?: string; // SessionEnd
  /** Added by mondo-hook.js: ms timestamp when the hook process started. */
  _mondo_ts?: number;
  [key: string]: unknown;
}

/**
 * New status for an event, or null to leave the status unchanged.
 * `prev` is the session's current status (undefined for a new session).
 */
export function deriveStatus(e: HookPayload, prev?: SessionStatus): SessionStatus | null {
  switch (e.hook_event_name) {
    case "SessionStart":
      // A compact can happen mid-turn; keep whatever we had.
      if (e.source === "compact" && prev && prev !== "ended") return null;
      return "idle";
    case "UserPromptSubmit":
      return "working";
    case "PostToolUse":
    case "PostToolUseFailure":
      // A tool finished, so any permission prompt was answered. Don't revive ended sessions.
      if (prev === "ended") return null;
      return "working";
    case "Stop":
      return prev === "ended" ? null : "waiting";
    case "Notification":
      if (prev === "ended") return null;
      if (e.notification_type === "permission_prompt") return "needs_permission";
      if (e.notification_type === "idle_prompt") return "waiting";
      return null;
    case "SessionEnd":
      return "ended";
    default:
      return null;
  }
}

export const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: "Idle",
  working: "Working",
  waiting: "Waiting for you",
  needs_permission: "Needs permission",
  ended: "Ended",
};
