import { describe, expect, it } from "vitest";
import { EVENTS, addMondoHooks, removeMondoHooks } from "../scripts/hooks-settings.mjs";

const CMD = 'node "C:/x/mondoshawan/hooks/mondo-hook.js"';
const userSettings = {
  permissions: { allow: ["Read(**)"] },
  theme: "auto",
  hooks: {
    Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] }],
  },
};

describe("addMondoHooks", () => {
  it("adds every event and keeps existing settings and hooks", () => {
    const out = addMondoHooks(userSettings, CMD);
    expect(out.permissions).toEqual(userSettings.permissions);
    expect(out.theme).toBe("auto");
    expect(out.hooks.PreToolUse).toEqual(userSettings.hooks.PreToolUse);
    expect(out.hooks.Stop[0]).toEqual(userSettings.hooks.Stop[0]);
    for (const ev of EVENTS) {
      expect(out.hooks[ev].at(-1).hooks[0].command).toBe(CMD);
    }
    expect(out.hooks.SessionEnd.at(-1).hooks[0].async).toBeUndefined();
    expect(out.hooks.Stop.at(-1).hooks[0].async).toBe(true);
  });

  it("does not modify the input object", () => {
    const copy = structuredClone(userSettings);
    addMondoHooks(userSettings, CMD);
    expect(userSettings).toEqual(copy);
  });

  it("is idempotent", () => {
    const once = addMondoHooks(userSettings, CMD);
    expect(addMondoHooks(once, CMD)).toEqual(once);
  });

  it("works on an empty file", () => {
    expect(Object.keys(addMondoHooks({}, CMD).hooks).sort()).toEqual([...EVENTS].sort());
  });
});

describe("removeMondoHooks", () => {
  it("restores the original settings exactly", () => {
    expect(removeMondoHooks(addMondoHooks(userSettings, CMD))).toEqual(userSettings);
  });

  it("removes the hooks key when only Mondo was there", () => {
    expect(removeMondoHooks(addMondoHooks({ theme: "dark" }, CMD))).toEqual({ theme: "dark" });
  });

  it("only strips Mondo's hook from a shared group", () => {
    const mixed = {
      hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }, { type: "command", command: CMD }] }] },
    };
    expect(removeMondoHooks(mixed)).toEqual({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] },
    });
  });
});
