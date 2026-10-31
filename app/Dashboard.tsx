"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { STATUS_LABEL, type SessionStatus } from "@/lib/status";
import type { Session } from "@/lib/store";

type Conn = "connecting" | "live" | "polling";

interface Snapshot {
  sessions: Session[];
  now: number;
}

function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [skew, setSkew] = useState(0); // server clock minus client clock
  const [conn, setConn] = useState<Conn>("connecting");

  useEffect(() => {
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const apply = (s: Snapshot) => {
      setSessions(s.sessions);
      setSkew(s.now - Date.now());
    };
    const poll = async () => {
      try {
        apply(await (await fetch("/api/sessions", { cache: "no-store" })).json());
      } catch {
        /* server down; keep trying */
      }
    };
    const startPolling = () => {
      if (pollTimer) return;
      setConn("polling");
      poll();
      pollTimer = setInterval(poll, 3000);
    };
    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    };

    // EventSource reconnects by itself; poll in the meantime.
    const es = new EventSource("/api/stream");
    es.onmessage = (ev) => {
      stopPolling();
      setConn("live");
      apply(JSON.parse(ev.data));
    };
    es.onerror = () => startPolling();

    return () => {
      es.close();
      stopPolling();
    };
  }, []);

  return { sessions, setSessions, skew, conn };
}

function useNow(skew: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now + skew;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Group by project (unregistered folders last), then folder, then start time.
const byPlace = (a: Session, b: Session) =>
  Number(a.project === null) - Number(b.project === null) ||
  (a.project ?? "").localeCompare(b.project ?? "") ||
  a.worktree.localeCompare(b.worktree) ||
  a.startedAt - b.startedAt;

export default function Dashboard() {
  const { sessions, setSessions, skew, conn } = useSessions();
  const now = useNow(skew);

  const { live, ended } = useMemo(() => {
    const live = sessions.filter((s) => s.status !== "ended").sort(byPlace);
    const ended = sessions
      .filter((s) => s.status === "ended")
      .sort((a, b) => b.lastActivity - a.lastActivity);
    return { live, ended };
  }, [sessions]);

  const attention = live.filter((s) => s.status === "waiting" || s.status === "needs_permission").length;

  useEffect(() => {
    document.title = attention ? `(${attention}) Mondo` : "Mondo";
  }, [attention]);

  const saveSystem = async (id: string, system: string) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, system } : s)));
    await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system }),
    }).catch(() => {});
  };

  const forget = async (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
  };

  return (
    <main>
      <header>
        <h1>Mondo</h1>
        <span className={`conn conn-${conn}`} title="Connection to Mondo server">
          {conn === "live" ? "live" : conn === "polling" ? "reconnecting…" : "connecting…"}
        </span>
      </header>

      {live.length === 0 ? (
        <p className="empty">
          No active Claude Code sessions. Start <code>claude</code> in a project folder and it will
          appear here.
        </p>
      ) : (
        <SessionTable sessions={live} now={now} onSystem={saveSystem} />
      )}

      {ended.length > 0 && (
        <details className="ended">
          <summary>Ended ({ended.length})</summary>
          <SessionTable sessions={ended} now={now} onSystem={saveSystem} onForget={forget} />
        </details>
      )}
    </main>
  );
}

function SessionTable({
  sessions,
  now,
  onSystem,
  onForget,
}: {
  sessions: Session[];
  now: number;
  onSystem: (id: string, v: string) => void;
  onForget?: (id: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th>Folder</th>
            <th>Branch</th>
            <th>Status</th>
            <th>Last activity</th>
            <th>System</th>
            {onForget && <th aria-label="Remove" />}
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id} className={`row-${s.status}`}>
              <td>{s.project ?? <span className="muted">—</span>}</td>
              <td title={s.cwd}>{s.worktree || <span className="muted">—</span>}</td>
              <td className="mono">{s.branch ?? <span className="muted">—</span>}</td>
              <td>
                <StatusBadge status={s.status} title={s.lastMessage ?? undefined} />
              </td>
              <td className="nowrap" title={new Date(s.lastActivity).toLocaleString()}>
                {ago(now - s.lastActivity)}
              </td>
              <td>
                <SystemField value={s.system} onSave={(v) => onSystem(s.id, v)} />
              </td>
              {onForget && (
                <td>
                  <button className="forget" onClick={() => onForget(s.id)} title="Remove from list">
                    ×
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status, title }: { status: SessionStatus; title?: string }) {
  return (
    <span className={`badge badge-${status}`} title={title}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function SystemField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  // Follow server updates unless the user is mid-edit.
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  const commit = () => {
    const v = draft.trim();
    if (v !== value) onSave(v);
  };

  return (
    <input
      className="system"
      value={draft}
      placeholder="e.g. netcode"
      maxLength={200}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(value);
          focused.current = false;
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
