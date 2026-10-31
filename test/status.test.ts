import { describe, expect, it } from "vitest";
import { deriveStatus, type HookPayload } from "@/lib/status";

const ev = (hook_event_name: string, extra: Partial<HookPayload> = {}): HookPayload => ({
  session_id: "s",
  hook_event_name,
  ...extra,
});

describe("deriveStatus", () => {
  it("follows the basic lifecycle", () => {
    expect(deriveStatus(ev("SessionStart", { source: "startup" }))).toBe("idle");
    expect(deriveStatus(ev("UserPromptSubmit"), "idle")).toBe("working");
    expect(deriveStatus(ev("Notification", { notification_type: "permission_prompt" }), "working")).toBe(
      "needs_permission",
    );
    expect(deriveStatus(ev("PostToolUse"), "needs_permission")).toBe("working");
    expect(deriveStatus(ev("Stop"), "working")).toBe("waiting");
    expect(deriveStatus(ev("SessionEnd", { reason: "prompt_input_exit" }), "waiting")).toBe("ended");
  });

  it("treats idle_prompt as waiting and ignores other notifications", () => {
    expect(deriveStatus(ev("Notification", { notification_type: "idle_prompt" }), "working")).toBe("waiting");
    expect(deriveStatus(ev("Notification", { notification_type: "auth_success" }), "working")).toBeNull();
  });

  it("keeps status through a compact", () => {
    expect(deriveStatus(ev("SessionStart", { source: "compact" }), "working")).toBeNull();
  });

  it("revives an ended session only on SessionStart", () => {
    expect(deriveStatus(ev("SessionStart", { source: "resume" }), "ended")).toBe("idle");
    expect(deriveStatus(ev("PostToolUse"), "ended")).toBeNull();
    expect(deriveStatus(ev("Stop"), "ended")).toBeNull();
  });

  it("ignores unknown events", () => {
    expect(deriveStatus(ev("PreCompact"), "working")).toBeNull();
  });
});
