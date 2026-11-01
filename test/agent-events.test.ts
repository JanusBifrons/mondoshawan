import { describe, expect, it } from "vitest";
import { parseEvent, toolSummary } from "../lib/agent-events";

describe("parseEvent", () => {
  it("reads cwd from init", () => {
    expect(parseEvent({ type: "system", subtype: "init", cwd: "C:\\x" })).toEqual({ entries: [], cwd: "C:\\x" });
  });

  it("turns assistant text and tool calls into entries", () => {
    const p = parseEvent({
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "" },
          { type: "text", text: "hello world" },
          { type: "tool_use", name: "Bash", input: { command: "git   status" } },
        ],
      },
    });
    expect(p.status).toBe("working");
    expect(p.entries).toEqual([
      { kind: "assistant", text: "hello world" },
      { kind: "tool", text: "Bash: git status" },
    ]);
  });

  it("keeps tool results and notes interrupts", () => {
    const p = parseEvent({
      type: "user",
      message: {
        content: [
          { type: "tool_result", content: [{ type: "text", text: "ok" }] },
          { type: "tool_result", content: "boom", is_error: true },
          { type: "text", text: "[Request interrupted by user for tool use]" },
        ],
      },
    });
    expect(p.entries).toEqual([
      { kind: "tool_result", text: "ok" },
      { kind: "error", text: "boom" },
      { kind: "system", text: "Interrupted" },
    ]);
  });

  it("ends a turn on result, with cost", () => {
    const p = parseEvent({ type: "result", subtype: "success", duration_ms: 4200, total_cost_usd: 0.01 });
    expect(p).toEqual({ entries: [{ kind: "result", text: "Done · 4s" }], status: "idle", costUsd: 0.01 });
    const bad = parseEvent({ type: "result", subtype: "error_max_turns", is_error: true });
    expect(bad.entries[0].kind).toBe("error");
  });

  it("ignores unknown events", () => {
    expect(parseEvent({ type: "rate_limit_event" })).toEqual({ entries: [] });
    expect(parseEvent(null)).toEqual({ entries: [] });
  });
});

describe("toolSummary", () => {
  it("falls back to the tool name", () => {
    expect(toolSummary("TodoWrite", {})).toBe("TodoWrite");
    expect(toolSummary("Read", { file_path: "a.ts" })).toBe("Read: a.ts");
  });
});
