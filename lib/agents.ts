import { spawn, execFile, type ChildProcessWithoutNullStreams } from "node:child_process";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import readline from "node:readline";
import { getDb, type DB } from "./db";
import { parseEvent, type EntryKind } from "./agent-events";

/**
 * Agents are Claude Code sessions that Mondo runs itself, so they can be driven from
 * the phone. Each is a headless `claude -p` process speaking stream-json on stdin/stdout:
 * we write user messages (and interrupt requests) in, and read events out.
 *
 * Processes are children of the Mondo server. If the server stops, they stop too; their
 * conversation is kept by Claude Code, so "Resume" starts a new process with --resume.
 */

export type AgentStatus = "starting" | "working" | "idle" | "stopping" | "stopped" | "failed";
export const RUNNING: AgentStatus[] = ["starting", "working", "idle", "stopping"];

export const PERMISSION_MODES = ["auto", "acceptEdits", "plan", "manual"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];
export const MODELS = ["", "opus", "sonnet", "haiku"] as const;

export interface Agent {
  id: string;
  name: string;
  project: string;
  cwd: string;
  worktreeName: string | null;
  model: string | null;
  permissionMode: PermissionMode;
  sessionId: string;
  status: AgentStatus;
  createdAt: number;
  lastActivity: number;
  costUsd: number;
  exitInfo: string | null;
}

export interface Entry {
  id: number;
  agentId: string;
  at: number;
  kind: EntryKind;
  text: string;
}

export interface SpawnOptions {
  name: string;
  project: string;
  /** Folder to start in (the project or one of its worktrees). */
  cwd: string;
  /** Create a new git worktree with this name (claude --worktree). */
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
  cost_usd: number;
  exit_info: string | null;
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
  status: r.status as AgentStatus,
  createdAt: r.created_at,
  lastActivity: r.last_activity,
  costUsd: r.cost_usd,
  exitInfo: r.exit_info,
});

/** The `claude` executable; override with MONDO_CLAUDE. */
const claudeBin = () => process.env.MONDO_CLAUDE || "claude";

function killTree(pid: number) {
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* gone */
    }
  }
}

export class AgentManager extends EventEmitter {
  private procs = new Map<string, ChildProcessWithoutNullStreams>();
  private stderr = new Map<string, string[]>();

  constructor(private db: DB) {
    super();
    this.setMaxListeners(200);
    // Any agent marked running belongs to a server that no longer exists.
    db.prepare(
      `UPDATE agents SET status = 'stopped', exit_info = COALESCE(exit_info, 'Mondo restarted')
       WHERE status IN ('starting','working','idle','stopping')`,
    ).run();
  }

  list(): Agent[] {
    return (this.db.prepare("SELECT * FROM agents ORDER BY created_at DESC").all() as unknown as Row[]).map(fromRow);
  }

  get(id: string): Agent | null {
    const r = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Row | undefined;
    return r ? fromRow(r) : null;
  }

  entries(id: string, afterId = 0, limit = 500): Entry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM (SELECT id, agent_id, at, kind, text FROM agent_entries
           WHERE agent_id = ? AND id > ? ORDER BY id DESC LIMIT ?) ORDER BY id`,
      )
      .all(id, afterId, limit) as { id: number; agent_id: string; at: number; kind: string; text: string }[];
    return rows.map((r) => ({ id: r.id, agentId: r.agent_id, at: r.at, kind: r.kind as EntryKind, text: r.text }));
  }

  isRunning(id: string) {
    return this.procs.has(id);
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
      costUsd: 0,
      exitInfo: null,
    };
    this.db
      .prepare(
        `INSERT INTO agents (id, name, project, cwd, worktree_name, model, permission_mode, session_id,
                             status, created_at, last_activity, cost_usd, exit_info)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
      )
      .run(agent.id, agent.name, agent.project, agent.cwd, agent.worktreeName, agent.model,
        agent.permissionMode, agent.sessionId, agent.status, now, now);

    const where = agent.worktreeName ? `new worktree "${agent.worktreeName}" of ${agent.cwd}` : agent.cwd;
    this.addEntry(agent.id, "system", `Starting in ${where} (${agent.permissionMode} mode)`);
    this.launch(agent, ["--session-id", agent.sessionId, ...(agent.worktreeName ? ["--worktree", agent.worktreeName] : [])]);
    if (opts.prompt?.trim()) this.send(agent.id, opts.prompt);
    return this.get(agent.id)!;
  }

  /** Start a stopped agent again, continuing its conversation. */
  resume(id: string): Agent | null {
    const agent = this.get(id);
    if (!agent || this.procs.has(id)) return agent;
    this.update(id, { status: "starting", exit_info: null });
    this.addEntry(id, "system", "Resuming");
    // agent.cwd is the folder Claude reported at start (the worktree, if one was made).
    this.launch(agent, ["--resume", agent.sessionId]);
    return this.get(id);
  }

  send(id: string, text: string): boolean {
    const p = this.procs.get(id);
    if (!p || !p.stdin.writable) return false;
    p.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n");
    this.addEntry(id, "user", text);
    this.update(id, { status: "working" });
    return true;
  }

  interrupt(id: string): boolean {
    const p = this.procs.get(id);
    if (!p || !p.stdin.writable) return false;
    const req = { type: "control_request", request_id: crypto.randomUUID(), request: { subtype: "interrupt" } };
    p.stdin.write(JSON.stringify(req) + "\n");
    return true;
  }

  /** Interrupt, close input so Claude exits, and force-kill if it hasn't within 5s. */
  stop(id: string): boolean {
    const p = this.procs.get(id);
    if (!p) return false;
    this.update(id, { status: "stopping" });
    this.interrupt(id);
    p.stdin.end();
    const pid = p.pid;
    setTimeout(() => {
      if (this.procs.get(id) === p && pid) killTree(pid);
    }, 5000).unref();
    return true;
  }

  /** Forget a stopped agent and its transcript. The Claude conversation and any worktree stay. */
  remove(id: string): boolean {
    if (this.procs.has(id)) return false;
    const n = this.db.prepare("DELETE FROM agents WHERE id = ?").run(id).changes;
    if (n) this.emit("change", { agentId: id, removed: true });
    return n > 0;
  }

  private launch(agent: Agent, extra: string[]) {
    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--permission-mode", agent.permissionMode,
      // No one is at a terminal to answer prompts: anything that would ask is denied.
      "--permission-prompts", "none",
      "--name", `Mondo: ${agent.name}`,
      ...(agent.model ? ["--model", agent.model] : []),
      ...extra,
    ];
    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawn(claudeBin(), args, {
        cwd: agent.cwd,
        windowsHide: true,
        env: { ...process.env, MONDO_AGENT_ID: agent.id },
      });
    } catch (err) {
      this.finish(agent.id, "failed", `Could not start claude: ${(err as Error).message}`);
      return;
    }
    this.procs.set(agent.id, proc);
    this.stderr.set(agent.id, []);

    readline.createInterface({ input: proc.stdout }).on("line", (line) => {
      if (!line.trim()) return;
      let ev: unknown;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      const parsed = parseEvent(ev);
      for (const e of parsed.entries) this.addEntry(agent.id, e.kind, e.text);
      const patch: Partial<Row> = {};
      if (parsed.cwd) patch.cwd = parsed.cwd;
      if (parsed.costUsd !== undefined) patch.cost_usd = parsed.costUsd;
      if (parsed.status && this.get(agent.id)?.status !== "stopping") patch.status = parsed.status;
      if (!parsed.status && parsed.cwd && this.get(agent.id)?.status === "starting") patch.status = "idle";
      if (Object.keys(patch).length) this.update(agent.id, patch);
    });

    readline.createInterface({ input: proc.stderr }).on("line", (line) => {
      const buf = this.stderr.get(agent.id);
      if (!buf || !line.trim()) return;
      buf.push(line);
      if (buf.length > 20) buf.shift();
    });

    proc.on("error", (err) => {
      if (this.procs.get(agent.id) !== proc) return;
      this.procs.delete(agent.id);
      this.finish(agent.id, "failed", `Could not start claude: ${err.message}`);
    });
    proc.on("exit", (code, signal) => {
      if (this.procs.get(agent.id) !== proc) return;
      this.procs.delete(agent.id);
      const wasStopping = this.get(agent.id)?.status === "stopping";
      const err = this.stderr.get(agent.id)?.slice(-5).join("\n");
      if (wasStopping || code === 0) this.finish(agent.id, "stopped", "Stopped");
      else this.finish(agent.id, "failed", `Exited (${code ?? signal})${err ? `\n${err}` : ""}`);
    });
  }

  private finish(id: string, status: AgentStatus, info: string) {
    this.addEntry(id, status === "failed" ? "error" : "system", info);
    this.update(id, { status, exit_info: info });
  }

  private addEntry(agentId: string, kind: EntryKind, text: string) {
    const at = Date.now();
    const r = this.db
      .prepare("INSERT INTO agent_entries (agent_id, at, kind, text) VALUES (?, ?, ?, ?)")
      .run(agentId, at, kind, text);
    this.db.prepare("UPDATE agents SET last_activity = ? WHERE id = ?").run(at, agentId);
    const entry: Entry = { id: Number(r.lastInsertRowid), agentId, at, kind, text };
    this.emit("entry", entry);
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

const g = globalThis as unknown as { __mondoAgents?: AgentManager };

/** Shared manager for the server (survives dev reloads; restart after editing this file). */
export function getAgents(): AgentManager {
  return (g.__mondoAgents ??= new AgentManager(getDb()));
}
