"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { STATUS_LABEL, type SessionStatus } from "@/lib/status";
import type { Session } from "@/lib/store";
import { cn } from "@/lib/utils";

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
  const [endedOpen, setEndedOpen] = useState(false);

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
    <>
      <PageHeader title="Sessions">
        {attention > 0 && <Badge className={STATUS_CLASS.waiting}>{attention} need you</Badge>}
        <ConnIndicator conn={conn} />
      </PageHeader>

      <div className="space-y-6 p-4 md:p-6">
        {live.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">
            No active Claude Code sessions. Start <code className="rounded bg-muted px-1">claude</code> in a project
            folder and it will appear here.
          </Card>
        ) : (
          <SessionTable sessions={live} now={now} onSystem={saveSystem} />
        )}

        {ended.length > 0 && (
          <Collapsible open={endedOpen} onOpenChange={setEndedOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
                <ChevronRight className={cn("transition-transform", endedOpen && "rotate-90")} />
                Ended ({ended.length})
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 opacity-80">
              <SessionTable sessions={ended} now={now} onSystem={saveSystem} onForget={forget} />
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </>
  );
}

function ConnIndicator({ conn }: { conn: Conn }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Connection to Mondo server">
      <span
        className={cn(
          "size-2 rounded-full",
          conn === "live" ? "bg-emerald-500" : conn === "polling" ? "bg-amber-500" : "bg-muted-foreground",
        )}
      />
      {conn === "live" ? "live" : conn === "polling" ? "reconnecting…" : "connecting…"}
    </span>
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
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Project</TableHead>
            <TableHead>Folder</TableHead>
            <TableHead>Branch</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last activity</TableHead>
            <TableHead className="w-56">System</TableHead>
            {onForget && <TableHead className="w-10" aria-label="Remove" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="pl-4 font-medium">
                {s.project ?? <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell title={s.cwd}>{s.worktree || <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className="font-mono text-xs">
                {s.branch ?? <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell>
                <StatusBadge status={s.status} message={s.lastMessage} />
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground" title={new Date(s.lastActivity).toLocaleString()}>
                {ago(now - s.lastActivity)}
              </TableCell>
              <TableCell>
                <SystemField value={s.system} onSave={(v) => onSystem(s.id, v)} />
              </TableCell>
              {onForget && (
                <TableCell>
                  <Button variant="ghost" size="icon" className="size-7" onClick={() => onForget(s.id)} title="Remove from list">
                    <X />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

const STATUS_CLASS: Record<SessionStatus, string> = {
  idle: "bg-muted text-muted-foreground",
  working: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  waiting: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  needs_permission: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  ended: "bg-muted text-muted-foreground/70",
};

function StatusBadge({ status, message }: { status: SessionStatus; message: string | null }) {
  const badge = (
    <Badge className={cn("border-transparent", STATUS_CLASS[status])}>
      {status === "working" && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
      {STATUS_LABEL[status]}
    </Badge>
  );
  if (!message) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent>{message}</TooltipContent>
    </Tooltip>
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
    <Input
      className="h-8"
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
