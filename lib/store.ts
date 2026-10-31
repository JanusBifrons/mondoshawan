import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./config";
import { getDb, tx, type DB } from "./db";
import { branchFor, resolveCwd } from "./resolver";
import { deriveStatus, type HookPayload, type SessionStatus } from "./status";

export interface Session {
  id: string;
  cwd: string;
  project: string | null;
  worktree: string;
  branch: string | null;
  status: SessionStatus;
  /** ms timestamp of the event that set the current status (guards against out-of-order async hooks). */
  statusAt: number;
  startedAt: number;
  lastActivity: number;
  lastEvent: string;
  lastMessage: string | null;
  transcriptPath: string | null;
  system: string;
}

interface Row {
  id: string;
  cwd: string;
  project: string | null;
  worktree: string;
  branch: string | null;
  status: string;
  status_at: number;
  started_at: number;
  last_activity: number;
  last_event: string;
  last_message: string | null;
  transcript_path: string | null;
  system: string;
}

const fromRow = (r: Row): Session => ({
  id: r.id,
  cwd: r.cwd,
  project: r.project,
  worktree: r.worktree,
  branch: r.branch,
  status: r.status as SessionStatus,
  statusAt: r.status_at,
  startedAt: r.started_at,
  lastActivity: r.last_activity,
  lastEvent: r.last_event,
  lastMessage: r.last_message,
  transcriptPath: r.transcript_path,
  system: r.system,
});

const UPSERT = `
  INSERT INTO sessions (id, cwd, project, worktree, branch, status, status_at, started_at,
                        last_activity, last_event, last_message, transcript_path, system)
  VALUES (:id, :cwd, :project, :worktree, :branch, :status, :statusAt, :startedAt,
          :lastActivity, :lastEvent, :lastMessage, :transcriptPath, :system)
  ON CONFLICT(id) DO UPDATE SET
    cwd = excluded.cwd, project = excluded.project, worktree = excluded.worktree,
    branch = excluded.branch, status = excluded.status, status_at = excluded.status_at,
    started_at = excluded.started_at, last_activity = excluded.last_activity,
    last_event = excluded.last_event, last_message = excluded.last_message,
    transcript_path = excluded.transcript_path, system = excluded.system`;

/** Sessions live in SQLite (table `sessions`); every change is written straight through. */
export class Store extends EventEmitter {
  private queues = new Map<string, Promise<void>>();

  constructor(private db: DB) {
    super();
    this.setMaxListeners(100);
  }

  /** One-time move from the MVP's data/state.json into the database. */
  importLegacyJson(file: string) {
    if (!fs.existsSync(file)) return;
    const count = (this.db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n;
    if (count === 0) {
      try {
        const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { sessions?: Record<string, Session> };
        const sessions = Object.values(raw.sessions ?? {});
        const stmt = this.db.prepare(UPSERT);
        tx(this.db, () => sessions.forEach((s) => stmt.run(this.params(s))));
        console.log(`[mondo] imported ${sessions.length} sessions from ${file}`);
      } catch (err) {
        console.error("[mondo] could not import state.json:", (err as Error).message);
        return;
      }
    }
    fs.renameSync(file, file + ".imported");
  }

  private params(s: Session) {
    return {
      id: s.id,
      cwd: s.cwd ?? "",
      project: s.project ?? null,
      worktree: s.worktree ?? "",
      branch: s.branch ?? null,
      status: s.status,
      statusAt: s.statusAt ?? 0,
      startedAt: s.startedAt ?? 0,
      lastActivity: s.lastActivity ?? 0,
      lastEvent: s.lastEvent ?? "",
      lastMessage: s.lastMessage ?? null,
      transcriptPath: s.transcriptPath ?? null,
      system: s.system ?? "",
    };
  }

  private get(id: string): Session | null {
    const r = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Row | undefined;
    return r ? fromRow(r) : null;
  }

  private save(s: Session) {
    this.db.prepare(UPSERT).run(this.params(s));
    this.emit("change");
  }

  list(): Session[] {
    return (this.db.prepare("SELECT * FROM sessions ORDER BY last_activity DESC").all() as unknown as Row[]).map(fromRow);
  }

  /** Apply events for the same session one at a time, in arrival order. */
  applyHook(e: HookPayload): Promise<void> {
    const prev = this.queues.get(e.session_id) ?? Promise.resolve();
    const next = prev.then(() => this.applyHookNow(e)).catch((err) => {
      console.error("[mondo] hook apply failed:", err);
    });
    this.queues.set(e.session_id, next);
    next.finally(() => {
      if (this.queues.get(e.session_id) === next) this.queues.delete(e.session_id);
    });
    return next;
  }

  private async applyHookNow(e: HookPayload) {
    const now = Date.now();
    const ts = typeof e._mondo_ts === "number" && e._mondo_ts > 0 ? e._mondo_ts : now;
    const existing = this.get(e.session_id);
    const cwd = e.cwd || existing?.cwd || "";

    const [match, branch] = cwd
      ? await Promise.all([resolveCwd(cwd), branchFor(cwd)])
      : [{ project: null, worktree: "", root: null }, null];

    const s: Session = existing ?? {
      id: e.session_id,
      cwd,
      project: null,
      worktree: "",
      branch: null,
      status: "idle",
      statusAt: 0,
      startedAt: ts,
      lastActivity: ts,
      lastEvent: "",
      lastMessage: null,
      transcriptPath: null,
      system: "",
    };

    s.cwd = cwd;
    s.project = match.project;
    s.worktree = match.worktree;
    s.branch = branch;
    s.lastEvent = e.hook_event_name;
    s.lastActivity = Math.max(s.lastActivity, ts);
    if (e.transcript_path) s.transcriptPath = e.transcript_path;
    if (e.hook_event_name === "Notification" && typeof e.message === "string") s.lastMessage = e.message;

    // Async hooks can arrive out of order; only let newer events change status.
    // A brand-new SessionStart always wins (resume after end).
    const isRestart = e.hook_event_name === "SessionStart" && s.status === "ended";
    if (ts >= s.statusAt || isRestart) {
      const status = deriveStatus(e, existing ? s.status : undefined);
      if (status) {
        s.status = status;
        s.statusAt = ts;
        // Only keep the notification text while it's still relevant.
        if (status !== "needs_permission") s.lastMessage = null;
      }
    }

    this.save(s);
  }

  setSystem(id: string, system: string): Session | null {
    const s = this.get(id);
    if (!s) return null;
    s.system = system.slice(0, 200);
    this.save(s);
    return s;
  }

  remove(id: string): boolean {
    const removed = this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id).changes > 0;
    if (removed) this.emit("change");
    return removed;
  }
}

const g = globalThis as unknown as { __mondoStore?: Store };
export function getStore(): Store {
  if (!g.__mondoStore) {
    g.__mondoStore = new Store(getDb());
    g.__mondoStore.importLegacyJson(path.join(dataDir(), "state.json"));
  }
  return g.__mondoStore;
}
