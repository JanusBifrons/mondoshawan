import { describe, expect, it } from "vitest";
import { parseActivity, projectFolder } from "@/lib/fleet";

const line = (o: unknown) => JSON.stringify(o);

describe("recent activity from a transcript", () => {
  const jsonl = [
    '{"cut": "first line of a tail read can be partial',
    line({ type: "user", timestamp: "2026-11-01T10:00:00Z", message: { content: "Add mines to the weapons" } }),
    line({ type: "user", isMeta: true, message: { content: "<system-reminder>ignore me</system-reminder>" } }),
    line({ type: "user", message: { content: [{ type: "text", text: "<command-name>/clear</command-name>" }] } }),
    line({
      type: "assistant",
      timestamp: "2026-11-01T10:00:05Z",
      message: {
        content: [
          { type: "thinking", thinking: "" },
          { type: "text", text: "Looking at the weapon system first." },
          { type: "tool_use", name: "Bash", input: { command: "git   status", description: "Show status" } },
          { type: "tool_use", name: "Read", input: { file_path: "src/weapons.ts" } },
        ],
      },
    }),
    line({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } }),
    line({ type: "user", message: { content: [{ type: "text", text: "[Request interrupted by user]" }] } }),
    line({ type: "system", message: { content: "not shown" } }),
  ].join("\n");

  it("keeps your messages, Claude's text and tool calls, and drops noise", () => {
    expect(parseActivity(jsonl)).toEqual([
      { at: Date.parse("2026-11-01T10:00:00Z"), kind: "you", text: "Add mines to the weapons" },
      { at: Date.parse("2026-11-01T10:00:05Z"), kind: "claude", text: "Looking at the weapon system first." },
      { at: Date.parse("2026-11-01T10:00:05Z"), kind: "tool", text: "Bash: Show status" },
      { at: Date.parse("2026-11-01T10:00:05Z"), kind: "tool", text: "Read: src/weapons.ts" },
    ]);
  });

  it("returns only the last lines", () => {
    expect(parseActivity(jsonl, 2).map((a) => a.text)).toEqual(["Bash: Show status", "Read: src/weapons.ts"]);
  });

  it("names Claude's per-project folder like Claude does", () => {
    expect(projectFolder("C:\\Users\\alecv\\Documents\\Projects\\mondoshawan")).toBe("C--Users-alecv-Documents-Projects-mondoshawan");
  });
});
