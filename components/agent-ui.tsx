"use client";

import { useEffect, useRef, useState } from "react";
import { ElementGlyph, ELEMENT_NAME, ELEMENT_TEXT, type Element } from "@/components/elements";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { FleetItem, Shown } from "@/lib/fleet";
import { cn } from "@/lib/utils";

export type { FleetItem, Shown };

const ELEMENT: Record<Shown, Element> = {
  starting: "earth",
  working: "fire",
  waiting: "air",
  needs_permission: "fifth",
  idle: "earth",
  stopped: "water",
  failed: "fifth",
};

export const SHOWN_LABEL: Record<Shown, string> = {
  starting: "Starting",
  working: "Working",
  waiting: "Your move",
  needs_permission: "Needs permission",
  idle: "Idle",
  stopped: "Ended",
  failed: "Needs attention",
};

const CLASS: Record<Shown, string> = {
  starting: "border-earth/40 bg-earth/10 text-earth",
  working: "border-fire/50 bg-fire/15 text-fire",
  waiting: "border-air/50 bg-air/10 text-air",
  needs_permission: "border-transparent bg-taxi text-black",
  idle: "border-earth/40 bg-earth/10 text-earth",
  stopped: "border-water/30 bg-water/10 text-water/80",
  failed: "border-transparent bg-taxi text-black",
};

export const EDGE: Record<Shown, string> = {
  starting: "shadow-[inset_3px_0_0_var(--earth)]",
  working: "shadow-[inset_3px_0_0_var(--fire)]",
  waiting: "shadow-[inset_3px_0_0_var(--air)]",
  needs_permission: "shadow-[inset_3px_0_0_var(--taxi)] bg-taxi/5",
  idle: "shadow-[inset_3px_0_0_var(--earth)]",
  stopped: "shadow-[inset_3px_0_0_var(--water)]",
  failed: "shadow-[inset_3px_0_0_var(--taxi)] bg-taxi/5",
};

export function AgentStatusBadge({ shown }: { shown: Shown }) {
  return (
    <Badge variant="outline" className={cn("gap-1.5 rounded-sm font-semibold uppercase tracking-wide", CLASS[shown])}>
      <ElementGlyph element={ELEMENT[shown]} className={cn("size-3", shown === "working" && "animate-ember")} strokeWidth={2.5} />
      {SHOWN_LABEL[shown]}
    </Badge>
  );
}

/** Who started it: Mondo, or you (and from where). */
export function Origin({ item }: { item: Pick<FleetItem, "origin" | "from"> }) {
  const mondo = item.origin === "mondo";
  return (
    <span
      className={cn(
        "readout rounded-sm border px-1.5 py-0.5 normal-case",
        mondo ? "border-leeloo/50 text-leeloo" : "border-brass/40 text-brass",
      )}
    >
      {mondo ? "Mondo" : `You · ${item.from}`}
    </span>
  );
}

const TILES: Shown[] = ["needs_permission", "waiting", "working", "idle"];

/** Counters for everything running: one tile per status, each with its element. */
export function StatusTiles({ items }: { items: FleetItem[] }) {
  const live = items.filter((i) => i.live);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {TILES.map((st) => {
        const el = ELEMENT[st];
        const n = live.filter((i) => i.shown === st || (st === "needs_permission" && i.shown === "failed")).length;
        const alert = st === "needs_permission" && n > 0;
        return (
          <Card key={st} size="sm" className={cn("gap-1 px-4", alert && "glow-box")}>
            {alert && <div className="hazard absolute inset-x-0 top-0 h-1.5" />}
            <div className="flex items-center justify-between">
              <span className="readout">{ELEMENT_NAME[el]}</span>
              <ElementGlyph element={el} className={cn("size-5", ELEMENT_TEXT[el], st === "working" && n > 0 && "animate-ember")} />
            </div>
            <div className={cn("font-mono text-4xl leading-none tabular-nums", n > 0 ? ELEMENT_TEXT[el] : "text-muted-foreground/50")}>
              {String(n).padStart(2, "0")}
            </div>
            <div className="text-xs font-medium text-muted-foreground">{SHOWN_LABEL[st]}</div>
          </Card>
        );
      })}
    </div>
  );
}

/** Free-text "System" tag (e.g. "netcode"), saved on blur or Enter. */
export function SystemField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  const commit = () => {
    const v = draft.trim();
    if (v !== value) onSave(v);
  };
  return (
    <Input
      className="h-9"
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

export function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Ticking clock corrected for server/client skew. */
export function useNow(skew: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now + skew;
}

/** Last path segment, for showing a folder briefly. */
export const folderName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p;

/** Live fleet over SSE. */
export function useFleet() {
  const [items, setItems] = useState<FleetItem[] | null>(null);
  const [skew, setSkew] = useState(0);
  useEffect(() => {
    const es = new EventSource("/api/agents/stream");
    es.addEventListener("fleet", (ev) => {
      const d = JSON.parse((ev as MessageEvent).data) as { items: FleetItem[]; now: number };
      setItems(d.items);
      setSkew(d.now - Date.now());
    });
    return () => es.close();
  }, []);
  return { items, skew };
}

/** Run a high-level action on one session (stop, resume, forget, system). */
export async function itemAction(sessionId: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/agents/item/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
}

/** Native form controls styled to match shadcn inputs (no Select component installed). */
export const FIELD =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";
