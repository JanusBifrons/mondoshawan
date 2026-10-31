"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { ELEMENT_NAME, ELEMENT_TEXT, ElementGlyph, MondoMark, STATUS_ELEMENT } from "@/components/elements";
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
      <PageHeader title="Sessions" kicker="Monitor">
        {attention > 0 && (
          <span className="flex items-center gap-2 rounded-sm bg-taxi px-2 py-1 text-xs font-bold uppercase tracking-wider text-black">
            <span className="hazard h-3 w-3 rounded-[2px]" />
            {attention} need{attention === 1 ? "s" : ""} you
          </span>
        )}
        <ConnIndicator conn={conn} />
      </PageHeader>

      <div className="space-y-6 p-4 md:p-6">
        <StatusTiles sessions={live} />

        {live.length === 0 && conn === "connecting" ? null : live.length === 0 ? (
          <Card className="items-center gap-3 px-6 py-12 text-center">
            <MondoMark className="size-16 opacity-80" />
            <p className="display text-sm font-bold text-leeloo">All quiet in the city</p>
            <p className="max-w-md text-sm text-muted-foreground">
              No Claude Code sessions are running. Start <code className="rounded-sm bg-muted px-1 font-mono">claude</code>{" "}
              in a project folder and it lands here within a second.
            </p>
          </Card>
        ) : (
          <SessionTable sessions={live} now={now} onSystem={saveSystem} />
        )}

        {ended.length > 0 && (
          <Collapsible open={endedOpen} onOpenChange={setEndedOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="readout -ml-2 hover:text-leeloo">
                <ChevronRight className={cn("transition-transform", endedOpen && "rotate-90")} />
                <ElementGlyph element="water" className="size-3.5 text-water" />
                Ended ({ended.length})
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 opacity-75">
              <SessionTable sessions={ended} now={now} onSystem={saveSystem} onForget={forget} />
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </>
  );
}

const TILE_ORDER: SessionStatus[] = ["needs_permission", "waiting", "working", "idle"];

/** Taxi-dashboard counters: one tile per live status, each with its element. */
function StatusTiles({ sessions }: { sessions: Session[] }) {
  const count = (st: SessionStatus) => sessions.filter((s) => s.status === st).length;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {TILE_ORDER.map((st) => {
        const el = STATUS_ELEMENT[st];
        const n = count(st);
        const alert = st === "needs_permission" && n > 0;
        return (
          <Card key={st} size="sm" className={cn("gap-1 px-4", alert && "glow-box")}>
            {alert && <div className="hazard absolute inset-x-0 top-0 h-1.5" />}
            <div className="flex items-center justify-between">
              <span className="readout">{ELEMENT_NAME[el]}</span>
              <ElementGlyph
                element={el}
                className={cn("size-5", ELEMENT_TEXT[el], st === "working" && n > 0 && "animate-ember")}
              />
            </div>
            <div
              className={cn(
                "font-mono text-4xl leading-none tabular-nums",
                n > 0 ? ELEMENT_TEXT[el] : "text-muted-foreground/50",
              )}
            >
              {String(n).padStart(2, "0")}
            </div>
            <div className="text-xs font-medium text-muted-foreground">{STATUS_LABEL[st]}</div>
          </Card>
        );
      })}
    </div>
  );
}

function ConnIndicator({ conn }: { conn: Conn }) {
  return (
    <span className="readout flex items-center gap-1.5" title="Connection to Mondo server">
      <span
        className={cn(
          "size-2 rounded-full",
          conn === "live"
            ? "animate-ember bg-earth shadow-[0_0_8px_var(--earth)]"
            : conn === "polling"
              ? "bg-taxi"
              : "bg-muted-foreground",
        )}
      />
      {conn === "live" ? "Live" : conn === "polling" ? "Reconnecting" : "Connecting"}
    </span>
  );
}

// Coloured left edge per element, so a row's state reads at a glance.
const ROW_EDGE: Record<SessionStatus, string> = {
  idle: "shadow-[inset_3px_0_0_var(--earth)]",
  working: "shadow-[inset_3px_0_0_var(--fire)]",
  waiting: "shadow-[inset_3px_0_0_var(--air)]",
  needs_permission: "shadow-[inset_3px_0_0_var(--taxi)] bg-taxi/5",
  ended: "shadow-[inset_3px_0_0_var(--water)]",
};

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
          <TableRow className="hover:bg-transparent">
            <TableHead className="readout pl-4">Project</TableHead>
            <TableHead className="readout">Folder</TableHead>
            <TableHead className="readout">Branch</TableHead>
            <TableHead className="readout">Status</TableHead>
            <TableHead className="readout">Last activity</TableHead>
            <TableHead className="readout w-56">System</TableHead>
            {onForget && <TableHead className="w-10" aria-label="Remove" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((s) => (
            <TableRow key={s.id} className={ROW_EDGE[s.status]}>
              <TableCell className="pl-4 font-semibold">
                {s.project ?? <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell title={s.cwd}>{s.worktree || <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className="font-mono text-xs text-diva">
                {s.branch ?? <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell>
                <StatusBadge status={s.status} message={s.lastMessage} />
              </TableCell>
              <TableCell
                className="whitespace-nowrap font-mono text-xs text-muted-foreground"
                title={new Date(s.lastActivity).toLocaleString()}
              >
                {ago(now - s.lastActivity)}
              </TableCell>
              <TableCell>
                <SystemField value={s.system} onSave={(v) => onSystem(s.id, v)} />
              </TableCell>
              {onForget && (
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 hover:text-destructive"
                    onClick={() => onForget(s.id)}
                    title="Remove from list"
                  >
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
  idle: "border-earth/40 bg-earth/10 text-earth",
  working: "border-fire/50 bg-fire/15 text-fire",
  waiting: "border-air/50 bg-air/10 text-air",
  needs_permission: "border-transparent bg-taxi text-black",
  ended: "border-water/30 bg-water/10 text-water/80",
};

function StatusBadge({ status, message }: { status: SessionStatus; message: string | null }) {
  const el = STATUS_ELEMENT[status];
  const badge = (
    <Badge
      variant="outline"
      className={cn("gap-1.5 rounded-sm font-semibold uppercase tracking-wide", STATUS_CLASS[status])}
      title={message ? undefined : `${ELEMENT_NAME[el]} · ${STATUS_LABEL[status]}`}
    >
      <ElementGlyph element={el} className={cn("size-3", status === "working" && "animate-ember")} strokeWidth={2.5} />
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
