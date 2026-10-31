import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// Keep git and config out of these tests: every cwd resolves to EQX-Net on "main".
vi.mock("@/lib/resolver", () => ({
  resolveCwd: async () => ({ project: "EQX-Net", worktree: "eqx-net", root: "C:/x" }),
  branchFor: async () => "main",
}));

const { openDb } = await import("@/lib/db");
const { Store } = await import("@/lib/store");

const ev = (session_id: string, hook_event_name: string, ts: number, extra = {}) => ({
  session_id,
  hook_event_name,
  cwd: "C:/x",
  _mondo_ts: ts,
  ...extra,
});

describe("Store (SQLite)", () => {
  it("tracks a session through its lifecycle and keeps the System text", async () => {
    const store = new Store(openDb(":memory:"));
    await store.applyHook(ev("a", "SessionStart", 1));
    await store.applyHook(ev("a", "UserPromptSubmit", 2));
    store.setSystem("a", "netcode");
    await store.applyHook(ev("a", "Stop", 3));
    const [s] = store.list();
    expect(s).toMatchObject({ id: "a", project: "EQX-Net", branch: "main", status: "waiting", system: "netcode" });
  });

  it("ignores an older event that arrives late", async () => {
    const store = new Store(openDb(":memory:"));
    await store.applyHook(ev("a", "SessionStart", 1));
    await store.applyHook(ev("a", "Stop", 5));
    await store.applyHook(ev("a", "PostToolUse", 4)); // late async hook
    expect(store.list()[0].status).toBe("waiting");
  });

  it("imports the old state.json once and renames it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mondo-"));
    const file = path.join(dir, "state.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        sessions: {
          old: {
            id: "old", cwd: "C:/x", project: "Mondo", worktree: "m", branch: "main", status: "ended",
            statusAt: 1, startedAt: 1, lastActivity: 1, lastEvent: "SessionEnd", lastMessage: null,
            transcriptPath: null, system: "ui",
          },
        },
      }),
    );
    const store = new Store(openDb(":memory:"));
    store.importLegacyJson(file);
    expect(store.list()).toMatchObject([{ id: "old", system: "ui" }]);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(file + ".imported")).toBe(true);
  });
});
