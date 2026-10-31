import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Keep in step with scripts/hooks-settings.mjs.
export const HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "Notification", "SessionEnd"];
const MARKER = "mondo-hook.js";

export interface HookStatus {
  settingsFile: string;
  readable: boolean;
  events: { event: string; installed: boolean; command: string | null }[];
}

/** Which of Mondo's hook events are registered in the user's Claude Code settings. */
export function getHookStatus(): HookStatus {
  const settingsFile = path.join(os.homedir(), ".claude", "settings.json");
  let hooks: Record<string, { hooks?: { command?: string }[] }[]> = {};
  let readable = false;
  try {
    hooks = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ settingsFile, "utf8")).hooks ?? {};
    readable = true;
  } catch {
    /* missing or unreadable */
  }
  const events = HOOK_EVENTS.map((event) => {
    const cmd =
      (hooks[event] ?? [])
        .flatMap((g) => g.hooks ?? [])
        .find((h) => typeof h.command === "string" && h.command.includes(MARKER))?.command ?? null;
    return { event, installed: !!cmd, command: cmd };
  });
  return { settingsFile, readable, events };
}
