/**
 * Turns `claude -p --output-format stream-json` lines into transcript entries.
 * Pure, so it can be unit-tested without spawning anything.
 */

export type EntryKind = "user" | "assistant" | "tool" | "tool_result" | "system" | "result" | "error";

export interface NewEntry {
  kind: EntryKind;
  text: string;
}

export interface Parsed {
  entries: NewEntry[];
  /** "idle" when a turn finished, "working" when one is in progress. */
  status?: "idle" | "working";
  cwd?: string;
  costUsd?: number;
}

const MAX = 4000;
const clip = (s: string, n = MAX) => (s.length > n ? s.slice(0, n) + "…" : s);

/** One-line summary of a tool call, e.g. "Bash: git status". */
export function toolSummary(name: string, input: Record<string, unknown> | undefined): string {
  const i = input ?? {};
  const pick = (...keys: string[]) => {
    for (const k of keys) if (typeof i[k] === "string" && i[k]) return i[k] as string;
    return "";
  };
  const detail = pick("command", "file_path", "path", "pattern", "url", "query", "description", "prompt");
  return clip(detail ? `${name}: ${detail.replace(/\s+/g, " ")}` : name, 300);
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === "object" && "text" in c && typeof c.text === "string" ? c.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseEvent(ev: any): Parsed {
  const out: Parsed = { entries: [] };
  if (!ev || typeof ev !== "object") return out;

  switch (ev.type) {
    case "system":
      if (ev.subtype === "init" && typeof ev.cwd === "string") out.cwd = ev.cwd;
      break;

    case "assistant":
      out.status = "working";
      for (const block of ev.message?.content ?? []) {
        if (block?.type === "text" && block.text?.trim()) out.entries.push({ kind: "assistant", text: clip(block.text) });
        else if (block?.type === "tool_use") out.entries.push({ kind: "tool", text: toolSummary(block.name, block.input) });
      }
      break;

    case "user": {
      // Echoes of our own messages aren't sent (no --replay-user-messages); these are tool results.
      const content = ev.message?.content;
      if (!Array.isArray(content)) break;
      for (const block of content) {
        if (block?.type === "tool_result") {
          const text = textOf(block.content).trim();
          if (text) out.entries.push({ kind: block.is_error ? "error" : "tool_result", text: clip(text, 1500) });
        } else if (block?.type === "text" && /^\[Request interrupted/.test(block.text ?? "")) {
          out.entries.push({ kind: "system", text: "Interrupted" });
        }
      }
      break;
    }

    case "result": {
      out.status = "idle";
      if (typeof ev.total_cost_usd === "number") out.costUsd = ev.total_cost_usd;
      const secs = typeof ev.duration_ms === "number" ? ` · ${Math.round(ev.duration_ms / 1000)}s` : "";
      if (ev.is_error || (ev.subtype && ev.subtype !== "success")) {
        const why = typeof ev.result === "string" && ev.result ? ev.result : ev.subtype ?? "error";
        out.entries.push({ kind: "error", text: clip(`Turn failed: ${why}`, 1000) });
      } else {
        out.entries.push({ kind: "result", text: `Done${secs}` });
      }
      break;
    }
  }
  return out;
}
