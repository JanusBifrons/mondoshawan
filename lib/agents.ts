import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataDir } from "./config";
import { getDb, type DB } from "./db";
import { getStore } from "./store";

/**
 * Agents are Claude Code sessions that Mondo starts. Each one is an ordinary interactive
 * `claude --remote-control` running in its own Git Bash (mintty) window on the PC:
 *   - you can see it, type in it, and closing the window ends it;
 *   - it shows up in the Claude app (phone/desktop) under Remote Control, where you chat
 *     with it and answer its permission prompts;
 *   - Mondo's hooks report its status (we pass --session-id, so hook rows match the agent).
 * Mondo records the claude.exe PID so it can stop it and notice when it has gone.
 * Agents are detached: they keep running if Mondo restarts.
 */

export type AgentStatus = "starting" | "running" | "stopped" | "failed";

export const PERMISSION_MODES = ["auto", "acceptEdits", "plan", "manual"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];
export const MODELS = ["", "opus", "sonnet", "haiku"] as const;

export interface Agent {
  id: string;
  name: string;
  project: string;
  /** Folder Claude was started in (the project or one of its worktrees). */
  cwd: string;
  /** Worktree the agent was told to create and move into, if any. */
  worktreeName: string | null;
  model: string | null;
  permissionMode: PermissionMode;
  sessionId: string;
  status: AgentStatus;
  createdAt: number;
  lastActivity: number;
  exitInfo: string | null;
  pid: number | null;
}

export interface SpawnOptions {
  name: string;
  project: string;
  cwd: string;
  worktreeName?: string | null;
  model?: string | null;
  permissionMode: PermissionMode;
  prompt?: string;
}

interface Row {
  id: string;
  name: string;
  project: string;
  cwd: string;
  worktree_name: string | null;
  model: string | null;
  permission_mode: string;
  session_id: string;
  status: string;
  created_at: number;
  last_activity: number;
  exit_info: string | null;
  pid: number | null;
}

const fromRow = (r: Row): Agent => ({
  id: r.id,
  name: r.name,
  project: r.project,
  cwd: r.cwd,
  worktreeName: r.worktree_name,
  model: r.model,
  permissionMode: r.permission_mode as PermissionMode,
  sessionId: r.session_id,
  status: (["starting", "running", "stopped", "failed"].includes(r.status) ? r.status : "stopped") as AgentStatus,
  createdAt: r.created_at,
  lastActivity: r.last_activity,
  exitInfo: r.exit_info,
  pid: r.pid,
});

/** Git Bash's terminal. Override with MONDO_MINTTY. */
export const minttyPath = () => process.env.MONDO_MINTTY || "C:/Program Files/Git/usr/bin/mintty.exe";

/** Quote for bash, single-quote style. */
export const bashQuote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

/** C:\a\b or C:/a/b -> /c/a/b (Git Bash path). */
export const toBashPath = (p: string) => p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d: string) => "/" + d.toLowerCase());

/** Extra system prompt telling the agent how to work. */
export function agentInstructions(a: Pick<Agent, "name" | "project" | "worktreeName">): string {
  const lines = [`You were started by Mondo as the agent "${a.name}" for ${a.project}. The user talks to you through the Claude app (Remote Control).`];
  if (a.worktreeName) {
    lines.push(
      `Before doing anything else, call the EnterWorktree tool with name "${a.worktreeName}" and do all your work inside that worktree.`,
      `When your work is ready, commit it, push the branch, and open a pull request into main with \`gh pr create\`.`,
    );
  }
  return lines.join(" ");
}

/**
 * The first message. For a new-worktree agent it always starts with the move into the
 * worktree: the same instruction in the system prompt alone gets ignored when the user's
 * message says e.g. "do X and nothing else" (seen in testing).
 */
export function firstMessage(a: Pick<Agent, "worktreeName">, prompt?: string): string {
  const p = prompt?.trim() ?? "";
  if (!a.worktreeName) return p;
  const move = `First, call the EnterWorktree tool with name "${a.worktreeName}" so you work in your own worktree and branch.`;
  return p ? `${move}

Then: ${p}` : `${move} Then say you're ready and wait for instructions.`;
}

/** The claude command line for an agent (also used to resume one). */
export function claudeArgs(a: Agent, opts: { prompt?: string; resume?: boolean }): string[] {
  const title = `${a.project}: ${a.name}`;
  const first = opts.resume ? (opts.prompt?.trim() ?? "") : firstMessage(a, opts.prompt);
  return [
    "--remote-control", title,
    "--name", title,
    ...(opts.resume ? ["--resume", a.sessionId] : ["--session-id", a.sessionId]),
    "--permission-mode", a.permissionMode,
    ...(a.model ? ["--model", a.model] : []),
    "--append-system-prompt", agentInstructions(a),
    ...(first ? [first] : []),
  ];
}

/** The script the Git Bash window runs. `exec` so the window closes when Claude exits. */
export function launchScript(cwd: string, args: string[]): string {
  return [
    `cd ${bashQuote(toBashPath(cwd))} || { echo "Mondo: folder not found"; sleep 30; exit 1; }`,
    `exec claude ${args.map(bashQuote).join(" ")}`,
    "",
  ].join("\n");
}

/**
 * Environment for an agent: Mondo's, minus Claude Code's own variables. If Mondo was
 * started from inside a Claude session, those would mark the agent as a child session,
 * which turns off transcript saving (so it couldn't be resumed).
 */
export function agentEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !/^CLAUDE/i.test(k))) as NodeJS.ProcessEnv;
}

/**
 * Open a Git Bash (mintty) window running `script`. Returns an error message if it
 * couldn't start; `onLateError` reports a spawn failure that arrives afterwards.
 */
export function openGitBashWindow(title: string, script: string, onLateError?: (msg: string) => void): string | null {
  const mintty = minttyPath();
  if (!fs.existsSync(/*turbopackIgnore: true*/ mintty)) return `Git Bash not found at ${mintty}`;
  try {
    const child = spawn(/*turbopackIgnore: true*/ mintty, ["-t", title, "/usr/bin/bash", "-l", toBashPath(script)], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
      env: agentEnv(),
    });
    child.on("error", (err) => onLateError?.(`Couldn't open Git Bash: ${err.message}`));
    child.unref();
    return null;
  } catch (err) {
    return `Couldn't open Git Bash: ${(err as Error).message}`;
  }
}

/** The claude.ai link for an agent's Remote Control session, from Claude's own session registry. */
export function remoteUrl(pid: number | null): string | null {
  if (!pid) return null;
  try {
    const file = path.join(os.homedir(), ".claude", "sessions", `${pid}.json`);
    const id = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8")).bridgeSessionId;
    return typeof id === "string" && /^session_[A-Za-z0-9]+$/.test(id) ? `https://claude.ai/code/${id}` : null;
  } catch {
    return null;
  }
}

function isAlive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Find the claude.exe started with this session id (its PID isn't returned by mintty). */
function findClaudePid(sessionId: string): Promise<number | null> {
  const ps = `Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | Where-Object { $_.CommandLine -like '*${sessionId}*' } | Select-Object -First 1 -ExpandProperty ProcessId`;
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: 15000 }, (err, out) => {
      const pid = Number(String(out ?? "").trim());
      resolve(!err && pid > 0 ? pid : null);
    });
  });
}

/** Kill a process and everything it started (Windows: taskkill /T /F). */
export function stopProcessTree(pid: number) {
  execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
}
const killTree = stopProcessTree;

/** How long a new agent may take to report in through the hooks before we flag it. */
const START_GRACE_MS = 60_000;

export class AgentManager extends EventEmitter {
  private timer: ReturnType<typeof setInterval>;

  constructor(private db: DB) {
    super();
    this.setMaxListeners(200);
    this.timer = setInterval(() => this.check(), 5000);
    this.timer.unref();
  }

  list(): Agent[] {
    return (this.db.prepare("SELECT * FROM agents ORDER BY created_at DESC").all() as unknown as Row[]).map(fromRow);
  }

  get(id: string): Agent | null {
    const r = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Row | undefined;
    return r ? fromRow(r) : null;
  }

  spawn(opts: SpawnOptions): Agent {
    const now = Date.now();
    const agent: Agent = {
      id: crypto.randomBytes(6).toString("hex"),
      name: opts.name,
      project: opts.project,
      cwd: opts.cwd,
      worktreeName: opts.worktreeName || null,
      model: opts.model || null,
      permissionMode: opts.permissionMode,
      sessionId: crypto.randomUUID(),
      status: "starting",
      createdAt: now,
      lastActivity: now,
      exitInfo: null,
      pid: null,
    };
    this.db
      .prepare(
        `INSERT INTO agents (id, name, project, cwd, worktree_name, model, permission_mode, session_id,
                             status, created_at, last_activity, cost_usd, exit_info, pid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'starting', ?, ?, 0, NULL, NULL)`,
      )
      .run(agent.id, agent.name, agent.project, agent.cwd, agent.worktreeName, agent.model,
        agent.permissionMode, agent.sessionId, now, now);
    this.launch(agent, claudeArgs(agent, { prompt: opts.prompt }));
    return this.get(agent.id)!;
  }

  /** Open a stopped agent again in a new window, continuing its conversation. */
  resume(id: string): Agent | null {
    const agent = this.get(id);
    if (!agent || agent.status === "starting" || agent.status === "running") return agent;
    this.update(id, { status: "starting", exit_info: null, pid: null, created_at: Date.now() });
    this.launch(agent, claudeArgs(agent, { resume: true }));
    return this.get(id);
  }

  /** Close the agent's window (kills claude and anything it started). */
  stop(id: string): boolean {
    const agent = this.get(id);
    if (!agent || !isAlive(agent.pid)) return false;
    killTree(agent.pid!);
    this.update(id, { status: "stopped", exit_info: "Stopped from Mondo" });
    getStore().markEnded(agent.sessionId, "Stopped from Mondo");
    return true;
  }

  /** Forget a stopped agent. Its Claude conversation and any worktree stay. */
  remove(id: string): boolean {
    const agent = this.get(id);
    if (!agent || isAlive(agent.pid)) return false;
    this.db.prepare("DELETE FROM agents WHERE id = ?").run(id);
    this.emit("change", { agentId: id, removed: true });
    return true;
  }

  private launch(agent: Agent, args: string[]) {
    const dir = path.join(dataDir(), "agents");
    fs.mkdirSync(dir, { recursive: true });
    const script = path.join(dir, `${agent.id}.sh`);
    fs.writeFileSync(/*turbopackIgnore: true*/ script, launchScript(agent.cwd, args));

    const failed = openGitBashWindow(`${agent.project}: ${agent.name}`, script, (msg) =>
      this.update(agent.id, { status: "failed", exit_info: msg }),
    );
    if (failed) {
      this.update(agent.id, { status: "failed", exit_info: failed });
      return;
    }

    // Record claude's PID once it's up (mintty doesn't hand it back).
    void (async () => {
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const pid = await findClaudePid(agent.sessionId);
        if (pid) {
          if (this.get(agent.id)?.status === "starting") this.update(agent.id, { pid });
          return;
        }
      }
      if (this.get(agent.id)?.status === "starting") {
        this.update(agent.id, { status: "failed", exit_info: "Claude didn't start in its window." });
      }
    })();
  }

  /** Every few seconds: promote agents that reported in, and notice ones that have gone. */
  private check() {
    const now = Date.now();
    for (const a of this.list()) {
      const stuck = a.status === "failed" && !!a.pid;
      if (a.status !== "starting" && a.status !== "running" && !stuck) continue;
      if (a.pid && !isAlive(a.pid)) {
        this.update(a.id, { status: stuck ? "failed" : "stopped", pid: null, exit_info: stuck ? a.exitInfo : "Window closed" });
        getStore().markEnded(a.sessionId, "Window closed");
        continue;
      }
      if (a.status === "starting" || stuck) {
        const seen = this.db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(a.sessionId);
        if (seen) this.update(a.id, { status: "running", exit_info: null });
        else if (stuck) continue;
        else if (a.pid && now - a.createdAt > START_GRACE_MS) {
          // Alive but silent: almost always a question in its window (e.g. "trust this folder?").
          this.update(a.id, {
            status: "failed",
            exit_info: "It started but hasn't reported in. It's probably waiting at a question in its window on the PC.",
          });
        }
      }
    }
  }

  private update(id: string, patch: Partial<Row>) {
    const keys = Object.keys(patch) as (keyof Row)[];
    if (!keys.length) return;
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    this.db
      .prepare(`UPDATE agents SET ${sets}, last_activity = ? WHERE id = ?`)
      .run(...keys.map((k) => patch[k] as string | number | null), Date.now(), id);
    this.emit("change", { agentId: id });
  }
}

const g = globalThis as unknown as { __mondoAgentManager?: AgentManager };

/** Shared manager for the server (survives dev reloads; restart after editing this file). */
export function getAgents(): AgentManager {
  return (g.__mondoAgentManager ??= new AgentManager(getDb()));
}

/**
 * Open a Git Bash window running plain `claude` in `folder`, so the user can answer
 * "Do you trust this folder?" there. Mondo never answers it or edits the trust file.
 */
export function openTrustPrompt(label: string, folder: string): string | null {
  const dir = path.join(dataDir(), "agents");
  fs.mkdirSync(dir, { recursive: true });
  const script = path.join(dir, `trust-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.sh`);
  fs.writeFileSync(
    /*turbopackIgnore: true*/ script,
    [
      `cd ${bashQuote(toBashPath(folder))} || { echo "Mondo: folder not found"; sleep 30; exit 1; }`,
      `echo ${bashQuote(`Mondo: choose "Yes, I trust this folder" for ${label}, then close this window.`)}`,
      "exec claude",
      "",
    ].join("\n"),
  );
  return openGitBashWindow(`Trust ${label}`, script);
}
