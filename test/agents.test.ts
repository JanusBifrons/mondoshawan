import { describe, expect, it } from "vitest";
import { agentInstructions, bashQuote, claudeArgs, launchScript, toBashPath, type Agent } from "@/lib/agents";
import { folderTrusted, trustKey } from "@/lib/claude-trust";

describe("Claude folder trust", () => {
  const projects = {
    "C:/Users/a/Projects/eqx-net": { hasTrustDialogAccepted: true },
    "C:/Users/a/Projects/eqx-net/eqx-net": { hasTrustDialogAccepted: false },
    "C:\\Users\\a\\Projects\\eqx-net\\eqx-net": { hasTrustDialogAccepted: true }, // old spelling: ignored
    "C:/Users/a/Projects/mondo": { hasTrustDialogAccepted: true },
  };

  it("uses Claude's key spelling", () => {
    expect(trustKey("c:\\Users\\a\\x\\")).toBe("C:/Users/a/x");
    expect(trustKey("/c/Users/a/x")).toBe("C:/Users/a/x");
  });

  it("only an exact \"yes\" entry counts", () => {
    expect(folderTrusted("C:\\Users\\a\\Projects\\mondo", projects)).toBe(true);
    expect(folderTrusted("c:/Users/a/Projects/mondo/", projects)).toBe(true);
    expect(folderTrusted("C:/Users/a/Projects/eqx-net/eqx-net", projects)).toBe(false); // explicit no; old backslash yes ignored
    expect(folderTrusted("C:/Users/a/Projects/mondo/mondo", projects)).toBe(false); // trusted parent doesn't count
    expect(folderTrusted("C:/Users/a/Projects/eqx-net/eqx-net/.claude/worktrees/x", projects)).toBe(false);
  });
});

describe("agent launch", () => {
  const agent: Agent = {
    id: "abc",
    name: "eqx-net-1104-x1y",
    project: "EQX-Net",
    cwd: "C:\\Users\\a\\eqx-net",
    worktreeName: "eqx-net-1104-x1y",
    model: "haiku",
    permissionMode: "auto",
    sessionId: "11111111-2222-3333-4444-555555555555",
    status: "starting",
    createdAt: 0,
    lastActivity: 0,
    exitInfo: null,
    pid: null,
  };

  it("converts Windows paths for Git Bash", () => {
    expect(toBashPath("C:\\Users\\a b\\x")).toBe("/c/Users/a b/x");
  });

  it("quotes anything safely for bash", () => {
    expect(bashQuote(`it's "fine" & $HOME; \`x\``)).toBe(`'it'\\''s "fine" & $HOME; \`x\`'`);
  });

  it("builds a Remote Control command with our session id and the worktree instruction", () => {
    const args = claudeArgs(agent, { prompt: "  hi  " });
    expect(args.slice(0, 4)).toEqual(["--remote-control", "EQX-Net: eqx-net-1104-x1y", "--name", "EQX-Net: eqx-net-1104-x1y"]);
    expect(args).toContain("--session-id");
    expect(args).toContain(agent.sessionId);
    expect(args.at(-1)).toBe(
      'First, call the EnterWorktree tool with name "eqx-net-1104-x1y" so you work in your own worktree and branch.\n\nThen: hi',
    );
    expect(agentInstructions(agent)).toMatch(/EnterWorktree tool with name "eqx-net-1104-x1y"/);
    expect(agentInstructions(agent)).toMatch(/gh pr create/);
  });

  it("a new-worktree agent's first message always starts with the move", () => {
    expect(claudeArgs(agent, {}).at(-1)).toMatch(/^First, call the EnterWorktree tool .* Then say you're ready/);
    expect(claudeArgs({ ...agent, worktreeName: null }, { prompt: "hi" }).at(-1)).toBe("hi");
    expect(claudeArgs({ ...agent, worktreeName: null }, {}).at(-1)).toBe(agentInstructions({ ...agent, worktreeName: null }));
  });

  it("resumes by session id instead of creating one", () => {
    const args = claudeArgs(agent, { resume: true });
    expect(args).toContain("--resume");
    expect(args).not.toContain("--session-id");
  });

  it("writes a script that cds to the folder and execs claude", () => {
    const s = launchScript(agent.cwd, ["--name", "a b"]);
    expect(s).toContain("cd '/c/Users/a/eqx-net' ||");
    expect(s).toContain("exec claude '--name' 'a b'");
  });
});

describe("agent environment", () => {
  it("drops Claude Code's own variables so the agent isn't treated as a child session", async () => {
    const { agentEnv } = await import("@/lib/agents");
    const env = agentEnv({ PATH: "x", CLAUDECODE: "1", CLAUDE_CODE_CHILD_SESSION: "1", CLAUDE_PID: "9", HOME: "h" } as unknown as NodeJS.ProcessEnv);
    expect(env).toEqual({ PATH: "x", HOME: "h" });
  });
});
