import { describe, expect, it } from "vitest";
import { parseWorktreePorcelain } from "@/lib/git";
import { matchCwd } from "@/lib/match";
import { isWithin, normalizePath } from "@/lib/paths";

describe("normalizePath", () => {
  it("treats Windows, Git Bash and mixed spellings the same", () => {
    const want = "c:/users/alec/projects/eqx-net";
    expect(normalizePath("C:\\Users\\Alec\\Projects\\eqx-net")).toBe(want);
    expect(normalizePath("/c/Users/Alec/Projects/eqx-net/")).toBe(want);
    expect(normalizePath("c:/users/alec//projects/eqx-net\\")).toBe(want);
  });
  it("handles a bare drive", () => {
    expect(normalizePath("/c")).toBe("c:");
    expect(normalizePath("C:\\")).toBe("c:");
  });
});

describe("isWithin", () => {
  it("needs a real folder boundary", () => {
    expect(isWithin("c:/a/b", "c:/a")).toBe(true);
    expect(isWithin("c:/a", "c:/a")).toBe(true);
    expect(isWithin("c:/ab", "c:/a")).toBe(false);
  });
});

describe("matchCwd", () => {
  const projects = [
    {
      name: "EQX-Net",
      roots: [
        "C:/P/eqx-net/eqx-net",
        "C:/P/eqx-net/eqx-net/.claude/worktrees/netgate-head",
        "D:/elsewhere/eqx-hotfix",
      ],
    },
    { name: "Mondo", roots: ["C:/P/mondoshawan/mondoshawan"] },
  ];

  it("prefers the nested worktree over the main repo", () => {
    const m = matchCwd("/c/P/eqx-net/eqx-net/.claude/worktrees/netgate-head/src", projects);
    expect(m).toEqual({
      project: "EQX-Net",
      worktree: "netgate-head",
      root: "C:/P/eqx-net/eqx-net/.claude/worktrees/netgate-head",
    });
  });
  it("matches the main repo and its subfolders", () => {
    expect(matchCwd("C:\\P\\eqx-net\\eqx-net\\server", projects).worktree).toBe("eqx-net");
  });
  it("matches worktrees outside the main folder", () => {
    expect(matchCwd("d:\\Elsewhere\\EQX-Hotfix", projects).project).toBe("EQX-Net");
  });
  it("leaves unknown folders unmatched but named", () => {
    expect(matchCwd("C:/Users/Public", projects)).toEqual({ project: null, worktree: "Public", root: null });
  });
  it("does not match a sibling with a shared prefix", () => {
    expect(matchCwd("C:/P/mondoshawan/mondoshawan-old", projects).project).toBeNull();
  });
});

describe("parseWorktreePorcelain", () => {
  it("reads branches and detached heads", () => {
    const out = [
      "worktree C:/P/eqx",
      "HEAD aaa",
      "branch refs/heads/main",
      "",
      "worktree C:/P/eqx/.claude/worktrees/x",
      "HEAD bbb",
      "detached",
      "",
    ].join("\n");
    expect(parseWorktreePorcelain(out)).toEqual([
      { path: "C:/P/eqx", head: "aaa", branch: "main", bare: false },
      { path: "C:/P/eqx/.claude/worktrees/x", head: "bbb", branch: null, bare: false },
    ]);
  });
});
