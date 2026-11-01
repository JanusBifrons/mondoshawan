"use client";

import { useEffect, useState } from "react";
import { ElementGlyph, type Element } from "@/components/elements";
import { Badge } from "@/components/ui/badge";
import type { AgentStatus } from "@/lib/agents";
import { cn } from "@/lib/utils";

/** Agent statuses borrow the session elements: working = fire, your move = air, gone = water. */
export const AGENT_ELEMENT: Record<AgentStatus, Element> = {
  starting: "earth",
  working: "fire",
  idle: "air",
  stopping: "water",
  stopped: "water",
  failed: "fifth",
};

export const AGENT_LABEL: Record<AgentStatus, string> = {
  starting: "Starting",
  working: "Working",
  idle: "Your move",
  stopping: "Stopping",
  stopped: "Stopped",
  failed: "Failed",
};

const CLASS: Record<AgentStatus, string> = {
  starting: "border-earth/40 bg-earth/10 text-earth",
  working: "border-fire/50 bg-fire/15 text-fire",
  idle: "border-air/50 bg-air/10 text-air",
  stopping: "border-water/30 bg-water/10 text-water/80",
  stopped: "border-water/30 bg-water/10 text-water/80",
  failed: "border-transparent bg-taxi text-black",
};

export const isRunning = (s: AgentStatus) => s === "starting" || s === "working" || s === "idle" || s === "stopping";

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  return (
    <Badge variant="outline" className={cn("gap-1.5 rounded-sm font-semibold uppercase tracking-wide", CLASS[status])}>
      <ElementGlyph
        element={AGENT_ELEMENT[status]}
        className={cn("size-3", status === "working" && "animate-ember")}
        strokeWidth={2.5}
      />
      {AGENT_LABEL[status]}
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
