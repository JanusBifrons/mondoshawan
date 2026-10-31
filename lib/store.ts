import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./config";
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

interface State {
  version: 1;
  sessions: Record<string, Session>;
}

class Store extends EventEmitter {
  private state: State;
  private file: string;
  private saveTimer: NodeJS.Timeout | null = null;
  private queues = new Map<string, Promise<void>>();

  constructor() {
    super();
    this.setMaxListeners(100);
    this.file = path.join(dataDir(), "state.json");
    this.state = this.load();
  }

  private load(): State {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (raw && typeof raw.sessions === "object") return { version: 1, sessions: raw.sessions };
    } catch {
      /* first run or unreadable: start empty */
    }
    return { version: 1, sessions: {} };
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 200);
  }

  saveNow() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error("[mondo] failed to save state:", (err as Error).message);
    }
  }

  private changed() {
    this.scheduleSave();
    this.emit("change");
  }

  list(): Session[] {
    return Object.values(this.state.sessions).sort((a, b) => b.lastActivity - a.lastActivity);
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
    const existing = this.state.sessions[e.session_id];
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

    this.state.sessions[s.id] = s;
    this.changed();
  }

  setSystem(id: string, system: string): Session | null {
    const s = this.state.sessions[id];
    if (!s) return null;
    s.system = system.slice(0, 200);
    this.changed();
    return s;
  }

  remove(id: string): boolean {
    if (!this.state.sessions[id]) return false;
    delete this.state.sessions[id];
    this.changed();
    return true;
  }
}

const g = globalThis as unknown as { __mondoStore?: Store };
export function getStore(): Store {
  if (!g.__mondoStore) {
    g.__mondoStore = new Store();
    const flush = () => g.__mondoStore?.saveNow();
    process.once("exit", flush);
  }
  return g.__mondoStore;
}
