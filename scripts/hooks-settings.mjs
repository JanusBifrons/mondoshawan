// Pure helpers for adding/removing Mondo's hooks in a Claude Code settings object.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MARKER = "mondo-hook.js";

/** Events Mondo listens to. SessionEnd is sync so it is sent before Claude Code exits. */
export const EVENTS = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "Notification", "SessionEnd"];
const SYNC_EVENTS = new Set(["SessionEnd"]);

export function hookScriptPath() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  return path.join(root, "hooks", MARKER).replace(/\\/g, "/");
}

export function hookCommand(scriptPath = hookScriptPath()) {
  return `node "${scriptPath}"`;
}

const isMondoHook = (h) => typeof h?.command === "string" && h.command.includes(MARKER);

/** The entries Mondo adds, keyed by event. */
export function mondoEntries(command = hookCommand()) {
  const out = {};
  for (const ev of EVENTS) {
    const hook = { type: "command", command, timeout: 3 };
    if (!SYNC_EVENTS.has(ev)) hook.async = true;
    out[ev] = { hooks: [hook] };
  }
  return out;
}

/** Return a copy of settings with every Mondo hook removed and empty containers pruned. */
export function removeMondoHooks(settings) {
  const next = structuredClone(settings ?? {});
  if (!next.hooks || typeof next.hooks !== "object") return next;
  for (const [ev, groups] of Object.entries(next.hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = groups
      .map((g) => (Array.isArray(g?.hooks) ? { ...g, hooks: g.hooks.filter((h) => !isMondoHook(h)) } : g))
      .filter((g) => !Array.isArray(g?.hooks) || g.hooks.length > 0);
    if (kept.length) next.hooks[ev] = kept;
    else delete next.hooks[ev];
  }
  if (!Object.keys(next.hooks).length) delete next.hooks;
  return next;
}

/** Return a copy of settings with Mondo's hooks added (replacing any older Mondo entries). */
export function addMondoHooks(settings, command = hookCommand()) {
  const next = removeMondoHooks(settings);
  next.hooks ??= {};
  for (const [ev, group] of Object.entries(mondoEntries(command))) {
    next.hooks[ev] = [...(next.hooks[ev] ?? []), group];
  }
  return next;
}

/** Copy `file` to `<file>.bak-<timestamp>` without ever overwriting an earlier backup. */
export function backupFile(file) {
  let backup = `${file}.bak-${timestamp()}`;
  for (let n = 2; fs.existsSync(backup); n++) backup = `${file}.bak-${timestamp()}-${n}`;
  fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
  return backup;
}

export function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
