"use client";

import { useEffect, useState } from "react";
import { ElementGlyph, type Element } from "@/components/elements";
import { Badge } from "@/components/ui/badge";
import type { AgentView, OtherSessionView } from "@/lib/agent-views";
import { cn } from "@/lib/utils";

/** What to show for an agent: Mondo's lifecycle, refined by the hooks once it's running. */
export type Shown = "starting" | "working" | "waiting" | "needs_permission" | "idle" | "stopped" | "failed";

export function shownStatus(a: AgentView): Shown {
  if (a.status === "starting") return "starting";
  if (a.status === "failed") return "failed";
  if (a.status === "stopped") return "stopped";
  switch (a.session?.status) {
    case "working":
      return "working";
    case "waiting":
      return "waiting";
    case "needs_permission":
      return "needs_permission";
    case "ended":
      return "stopped";
    default:
      return "idle";
  }
}

export const isLive = (a: AgentView) => a.status === "starting" || a.status === "running" || (a.status === "failed" && !!a.pid);

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
  stopped: "Stopped",
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

/** Live agent list over SSE: Mondo's agents plus every other running Claude session. */
export function useAgents() {
  const [agents, setAgents] = useState<AgentView[] | null>(null);
  const [others, setOthers] = useState<OtherSessionView[]>([]);
  const [skew, setSkew] = useState(0);
  useEffect(() => {
    const es = new EventSource("/api/agents/stream");
    es.addEventListener("agents", (ev) => {
      const d = JSON.parse((ev as MessageEvent).data) as { agents: AgentView[]; others: OtherSessionView[]; now: number };
      setAgents(d.agents);
      setOthers(d.others ?? []);
      setSkew(d.now - Date.now());
    });
    return () => es.close();
  }, []);
  return { agents, others, skew };
}

/** Hook status of a session Mondo didn't start, in the same terms as agents. */
export function shownForSession(status: OtherSessionView["status"]): Shown {
  return status === "ended" ? "stopped" : status;
}

export async function agentAction(id: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/agents/${encodeURIComponent(id)}`, {
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
