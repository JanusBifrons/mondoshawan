import { describe, expect, it } from "vitest";
import { categorize, describeMarkdown } from "@/lib/knowledge";

describe("categorize", () => {
  it.each([
    ["docs/HANDOFF-warp-perf-2026-05-15.md", "Handoffs"],
    ["docs/architecture/ai-lockstep.md", "Architecture"],
    ["docs/features/missiles.md", "Features"],
    ["docs/plans/refactor-god-files.md", "Plans"],
    ["plans/network-feel-roadmap.md", "Plans"],
    ["docs/PLAN-playtest-bugs-2026-06-10.md", "Plans"],
    ["docs/perf/2026-05-27-phase5.md", "Ops & perf"],
    [".claude/skills/netgate/SKILL.md", "Agent skills"],
    ["design/brief.md", "Design"],
    ["README.md", "Guides"],
    ["docs/LESSONS.md", "Guides"],
    ["docs/Advanced Game Dev Stack Cheat Sheet.md", "Other"],
  ])("%s -> %s", (p, cat) => {
    expect(categorize(p, "repo")).toBe(cat);
  });

  it("puts everything from an extra folder under Design", () => {
    expect(categorize("Plans/plan.md", "folder")).toBe("Design");
  });
});

describe("describeMarkdown", () => {
  it("takes the first H1 and first plain paragraph, skipping banners", () => {
    const md = [
      "# AI Lockstep — Drone alignment",
      "",
      "> **⚠️ SUPERSEDED FOR DRONES (2026-05-18).** read the other doc",
      "",
      "This is the [architecture](./x.md) that makes drones feel *fast*.",
    ].join("\n");
    const d = describeMarkdown(md, "fallback");
    expect(d.title).toBe("AI Lockstep — Drone alignment");
    expect(d.summary).toBe("This is the architecture that makes drones feel fast.");
    expect(d.flags).toEqual(["superseded"]);
  });

  it("reads Status: lines but ignores the word used in passing", () => {
    expect(describeMarkdown("# X\n\n**Status:** draft\n\nBody", "f").flags).toEqual(["draft"]);
    expect(describeMarkdown("# X\n\nThis plan replaces the historical approach.", "f").flags).toEqual([]);
  });

  it("falls back to the file name when there is no heading", () => {
    expect(describeMarkdown("just text", "my notes").title).toBe("my notes");
  });
});
