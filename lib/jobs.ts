import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { agentEnv } from "./agents";
import { dataDir, loadConfig } from "./config";
import { getDb, type DB } from "./db";
import { parseJobLog } from "./job-events";

/**
 * Jobs: small, scoped, invisible background agents (e.g. Regenerate). Unlike Remote Control
 * agents there's no window and no conversation: Mondo runs `claude -p` with a fixed
 * instruction and a JSON result schema, streams its output to data/jobs/<id>.jsonl, and reads
 * that file for progress and the final result (tokens per model, turns, time, confidence).
 * Jobs are detached, so they survive a Mondo restart; the 3s check picks them up again.
 */

export type JobStatus = "running" | "done" | "failed" | "stopped";

export interface Job {
  id: string;
  kind: string;
  project: string | null;
  title: string;
  input: Record<string, unknown>;
  model: string | null;
  effort: string | null;
  status: JobStatus;
  pid: number | null;
  sessionId: string;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  apiMs: number | null;
  turns: number | null;
  toolCalls: number;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  thinkingTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  modelUsage: { model: string; input: number; output: number; cacheRead: number; cacheWrite: number }[];
  progress: string | null;
  summary: string | null;
  confidence: number | null;
  result: Record<string, unknown> | null;
  error: string | null;
}

export interface StartJob {
  kind: string;
  project: string | null;
  title: string;
  /** The task. Sent on stdin, so any text is safe. */
  prompt: string;
  /** Extra system prompt (how to work, tools, rules). */
  brief?: string;
  /** JSON schema for the final structured result. */
  schema?: Record<string, unknown>;
  cwd: string;
  input?: Record<string, unknown>;
  model?: string;
  effort?: string;
  /** Carry on an existing conversation (e.g. a design talk's next turn) instead of starting a new one. */
  resume?: string;
  /** Use this session id for a new conversation (so later turns can resume it). */
  sessionId?: string;
  /** Tools the job may not use at all (e.g. Edit, Write). */
  disallowedTools?: string[];
  /** Extra environment variables (e.g. MONDO_DESIGN_READONLY=1). */
  env?: Record<string, string>;
}

const parse = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromRow = (r: any): Job => ({
  id: r.id,
  kind: r.kind,
  project: r.project,
  title: r.title,
  input: parse(r.input, {}),
  model: r.model,
  effort: r.effort,
  status: r.status,
  pid: r.pid,
  sessionId: r.session_id,
  createdAt: r.created_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  durationMs: r.duration_ms,
  apiMs: r.api_ms,
  turns: r.turns,
  toolCalls: r.tool_calls,
  costUsd: r.cost_usd,
  inputTokens: r.input_tokens,
  outputTokens: r.output_tokens,
  thinkingTokens: r.thinking_tokens,
  cacheReadTokens: r.cache_read_tokens,
  cacheWriteTokens: r.cache_write_tokens,
  modelUsage: parse(r.model_usage, []),
  progress: r.progress,
  summary: r.summary,
  confidence: r.confidence,
  result: parse(r.result, null),
  error: r.error,
});

function isAlive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export const jobsDir = () => path.join(dataDir(), "jobs");
export const jobLogPath = (id: string) => path.join(jobsDir(), `${id}.jsonl`);
const jobErrPath = (id: string) => path.join(jobsDir(), `${id}.err.log`);

/** Defaults for jobs, from mondo.config.json "jobs". */
export function jobDefaults() {
  const j = loadConfig().jobs;
  return { model: j.model || "sonnet", effort: j.effort || "medium" };
}

export class JobManager extends EventEmitter {
  private timer: ReturnType<typeof setInterval>;
  private seen = new Map<string, number>(); // id -> log size last parsed

  constructor(private db: DB) {
    super();
    this.setMaxListeners(200);
    this.timer = setInterval(() => this.check(), 3000);
    this.timer.unref();
  }

  list(limit = 200): Job[] {
    return (this.db.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(limit) as unknown[]).map(fromRow);
  }

  get(id: string): Job | null {
    const r = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
    return r ? fromRow(r) : null;
  }

  /** Session ids of all jobs (so the Agents list doesn't show them twice). */
  sessionIds(): Set<string> {
    return new Set((this.db.prepare("SELECT session_id FROM jobs").all() as { session_id: string }[]).map((r) => r.session_id));
  }

  start(opts: StartJob): Job {
    const d = jobDefaults();
    const id = crypto.randomBytes(6).toString("hex");
    const sessionId = opts.resume || opts.sessionId || crypto.randomUUID();
    const model = opts.model || d.model;
    const effort = opts.effort || d.effort;
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO jobs (id, kind, project, title, input, model, effort, status, session_id, created_at, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
      )
      .run(id, opts.kind, opts.project, opts.title, JSON.stringify(opts.input ?? {}), model, effort, sessionId, now, now);

    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      ...(opts.resume ? ["--resume", opts.resume] : ["--session-id", sessionId]),
      "--name", `Mondo job: ${opts.title}`.slice(0, 100),
      "--model", model,
      "--effort", effort,
      // Nobody is watching: anything that would ask is refused; the auto classifier decides the rest.
      "--permission-mode", "auto",
      "--permission-prompts", "none",
      ...(opts.brief ? ["--append-system-prompt", opts.brief] : []),
      ...(opts.schema ? ["--json-schema", JSON.stringify(opts.schema)] : []),
      ...(opts.disallowedTools?.length ? ["--disallowedTools", opts.disallowedTools.join(",")] : []),
    ];

    fs.mkdirSync(jobsDir(), { recursive: true });
    const out = fs.openSync(/*turbopackIgnore: true*/ jobLogPath(id), "w");
    const err = fs.openSync(/*turbopackIgnore: true*/ jobErrPath(id), "w");
    try {
      const child = spawn(process.env.MONDO_CLAUDE || "claude", args, {
        cwd: opts.cwd,
        detached: true,
        windowsHide: true,
        stdio: ["pipe", out, err],
        env: { ...agentEnv(), ...(opts.env ?? {}) },
      });
      child.on("error", (e) => this.finishFailed(id, `Couldn't start claude: ${e.message}`));
      child.stdin?.end(opts.prompt);
      child.unref();
      if (child.pid) this.update(id, { pid: child.pid });
    } catch (e) {
      this.finishFailed(id, `Couldn't start claude: ${(e as Error).message}`);
    } finally {
      fs.closeSync(out);
      fs.closeSync(err);
    }
    return this.get(id)!;
  }

  stop(id: string): boolean {
    const j = this.get(id);
    if (!j || j.status !== "running") return false;
    if (j.pid) execFile("taskkill", ["/pid", String(j.pid), "/T", "/F"], { windowsHide: true }, () => {});
    this.update(id, { status: "stopped", finished_at: Date.now(), error: "Stopped from Mondo" });
    return true;
  }

  remove(id: string): boolean {
    const j = this.get(id);
    if (!j || j.status === "running") return false;
    this.db.prepare("DELETE FROM jobs WHERE id = ?").run(id);
    for (const f of [jobLogPath(id), jobErrPath(id)]) fs.rmSync(/*turbopackIgnore: true*/ f, { force: true });
    this.emit("change", { jobId: id });
    return true;
  }

  /** Read running jobs' logs: progress, and the final result when it arrives. */
  private check() {
    for (const j of this.db.prepare("SELECT * FROM jobs WHERE status = 'running'").all() as unknown[]) {
      const job = fromRow(j);
      let text = "";
      let size = 0;
      try {
        size = fs.statSync(/*turbopackIgnore: true*/ jobLogPath(job.id)).size;
        if (size !== this.seen.get(job.id)) text = fs.readFileSync(/*turbopackIgnore: true*/ jobLogPath(job.id), "utf8");
      } catch {
        /* no log yet */
      }
      if (text) {
        this.seen.set(job.id, size);
        const log = parseJobLog(text);
        if (log.result) {
          this.finish(job, log);
          continue;
        }
        this.update(job.id, { progress: log.lastStep, tool_calls: log.toolCalls, model: log.model ?? job.model });
      }
      if (job.pid && !isAlive(job.pid) && !this.get(job.id)?.finishedAt) {
        // Exited without a result line.
        let errText = "";
        try {
          errText = fs.readFileSync(/*turbopackIgnore: true*/ jobErrPath(job.id), "utf8").trim().split("\n").slice(-5).join("\n");
        } catch {
          /* none */
        }
        this.finishFailed(job.id, `It stopped without finishing.${errText ? `\n${errText}` : ""}`);
      }
    }
  }

  private finish(job: Job, log: ReturnType<typeof parseJobLog>) {
    const r = log.result!;
    const s = r.structured ?? {};
    const confidence = typeof s.confidence === "number" ? Math.max(0, Math.min(1, s.confidence)) : null;
    const now = Date.now();
    this.update(job.id, {
      status: r.ok ? "done" : "failed",
      finished_at: now,
      duration_ms: now - (job.startedAt ?? job.createdAt),
      api_ms: r.apiMs,
      turns: r.turns,
      tool_calls: log.toolCalls,
      cost_usd: r.costUsd,
      input_tokens: r.input,
      output_tokens: r.output,
      thinking_tokens: r.thinking,
      cache_read_tokens: r.cacheRead,
      cache_write_tokens: r.cacheWrite,
      model_usage: JSON.stringify(r.models.map(({ costUsd: _c, ...m }) => m)),
      model: r.models[0]?.model ?? log.model ?? job.model,
      progress: log.lastStep,
      summary: typeof s.summary === "string" ? s.summary : r.text?.slice(0, 2000) ?? null,
      confidence,
      result: r.structured ? JSON.stringify(r.structured) : null,
      error: r.ok ? null : `Finished with an error (${r.subtype ?? "unknown"}).${r.text ? ` ${r.text.slice(0, 500)}` : ""}`,
    });
    this.emit("finished", this.get(job.id));
  }

  private finishFailed(id: string, error: string) {
    this.update(id, { status: "failed", finished_at: Date.now(), error });
  }

  private update(id: string, patch: Record<string, string | number | null>) {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    this.db.prepare(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => patch[k]), id);
    this.emit("change", { jobId: id });
  }
}

const g = globalThis as unknown as { __mondoJobs?: JobManager };

/** Shared job manager (survives dev reloads; restart after editing this file). */
export function getJobs(): JobManager {
  return (g.__mondoJobs ??= new JobManager(getDb()));
}
