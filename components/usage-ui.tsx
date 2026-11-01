"use client";

import { cn } from "@/lib/utils";
import type { Tokens } from "@/lib/usage";

/** 1234 -> "1.2k", 3_400_000 -> "3.4M". */
export function fmtTokens(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Short model name: "claude-sonnet-5-5" -> "Sonnet 5.5". */
export function modelName(id: string): string {
  const m = id.match(/(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?/i);
  if (!m) return id;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? "." + m[3] : ""}`;
}

/** Confidence 0..1 as a coloured percentage. */
export function Confidence({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  const pct = Math.round(value * 100);
  return <span className={cn("font-mono", pct >= 80 ? "text-earth" : pct >= 50 ? "text-taxi" : "text-destructive")}>{pct}%</span>;
}

/** The token breakdown as a small grid. */
export function TokenGrid({ t, thinking }: { t: Tokens; thinking?: number | null }) {
  const cells: [string, number | null][] = [
    ["Total (new)", t.total],
    ["Input", t.input],
    ["Output", t.output],
    ...(thinking ? ([["of which thinking", thinking]] as [string, number][]) : []),
    ["Cache written", t.cacheWrite],
    ["Cache read", t.cacheRead],
  ];
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
      {cells.map(([label, n]) => (
        <div key={label} className="flex items-baseline justify-between gap-2">
          <span className="readout normal-case">{label}</span>
          <span className="font-mono text-sm">{fmtTokens(n)}</span>
        </div>
      ))}
    </div>
  );
}

export const TOKENS_HELP =
  "Total (new) = input + output + cache written: tokens processed fresh. Cache read is earlier context re-used from the cache, far cheaper, so it's shown on its own.";
