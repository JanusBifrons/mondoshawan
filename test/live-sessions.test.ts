import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { liveSessions, parseEntry, startedFrom } from "@/lib/live-sessions";

describe("Claude session registry", () => {
  it("parses an entry and builds the Remote Control link", () => {
    const e = parseEntry({
      pid: 42, sessionId: "abc", cwd: "C:\\x", name: "mondoshawan-02", status: "busy",
      entrypoint: "cli", kind: "interactive", startedAt: 5, bridgeSessionId: "session_01ABC",
    });
    expect(e).toEqual({
      pid: 42, sessionId: "abc", cwd: "C:\\x", name: "mondoshawan-02", state: "busy",
      entrypoint: "cli", kind: "interactive", startedAt: 5, remoteUrl: "https://claude.ai/code/session_01ABC",
    });
    expect(parseEntry({ pid: 1, sessionId: "x", bridgeSessionId: "javascript:alert(1)" })?.remoteUrl).toBeNull();
    expect(parseEntry({ sessionId: "x" })).toBeNull();
  });

  it("returns only live processes and skips unreadable files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mondo-reg-"));
    fs.writeFileSync(path.join(dir, "1.json"), JSON.stringify({ pid: 1, sessionId: "alive" }));
    fs.writeFileSync(path.join(dir, "2.json"), JSON.stringify({ pid: 2, sessionId: "dead" }));
    fs.writeFileSync(path.join(dir, "3.json"), "{half-written");
    fs.writeFileSync(path.join(dir, "notes.txt"), "ignored");
    const got = liveSessions(dir, (pid) => pid === 1);
    expect(got.map((s) => s.sessionId)).toEqual(["alive"]);
    expect(liveSessions(path.join(dir, "missing"))).toEqual([]);
  });

  it("describes where a session was started", () => {
    expect(startedFrom("cli")).toBe("terminal");
    expect(startedFrom(null)).toBe("terminal");
    expect(startedFrom("claude-desktop")).toBe("desktop app");
    expect(startedFrom("sdk-ts")).toBe("script");
  });
});
