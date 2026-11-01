"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Confidence, TOKENS_HELP, fmtDuration, fmtTokens, modelName } from "@/components/usage-ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { UsageRun } from "@/lib/usage";
import { cn } from "@/lib/utils";

type Filter = "all" | "job" | "agent";

/** Every run Mondo started, with what it used, so expensive kinds of work stand out. */
export default function UsageView() {
  const [runs, setRuns] = useState<UsageRun[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    const load = () =>
      fetch("/api/usage", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { runs: UsageRun[] }) => setRuns(d.runs))
        .catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  const shown = useMemo(() => (runs ?? []).filter((r) => filter === "all" || r.type === filter), [runs, filter]);
  const sum = (rs: UsageRun[]) => ({
    total: rs.reduce((a, r) => a + r.tokens.total, 0),
    cacheRead: rs.reduce((a, r) => a + r.tokens.cacheRead, 0),
    time: rs.reduce((a, r) => a + (r.durationMs ?? 0), 0),
  });
  const week = sum(shown.filter((r) => Date.now() - r.startedAt < 7 * 86_400_000));
  const all = sum(shown);

  // Average per kind, to see which kind of work costs most.
  const byKind = useMemo(() => {
    const m = new Map<string, { n: number; total: number; time: number }>();
    for (const r of shown) {
      const k = m.get(r.kind) ?? { n: 0, total: 0, time: 0 };
      k.n++;
      k.total += r.tokens.total;
      k.time += r.durationMs ?? 0;
      m.set(r.kind, k);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [shown]);

  return (
    <>
      <PageHeader title="Usage" kicker="Agents" />
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/agents">
            <ArrowLeft /> Agents
          </Link>
        </Button>

        <div className="flex rounded-lg border p-0.5">
          {(["all", "job", "agent"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn("readout flex-1 rounded-md px-3 py-1.5", filter === f && "bg-muted text-leeloo")}
            >
              {f === "all" ? "Everything" : f === "job" ? "Background jobs" : "Visible agents"}
            </button>
          ))}
        </div>

        {!runs ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["Last 7 days", week],
                  ["All time", all],
                ] as const
              ).map(([label, s]) => (
                <Card key={label} size="sm" className="gap-1 px-4">
                  <span className="readout">{label}</span>
                  <span className="font-mono text-2xl text-leeloo">{fmtTokens(s.total)}</span>
                  <span className="readout normal-case">
                    new tokens · {fmtTokens(s.cacheRead)} cache read · {fmtDuration(s.time)}
                  </span>
                </Card>
              ))}
            </div>

            {byKind.length > 1 && (
              <Card size="sm" className="gap-1 px-4">
                <span className="readout">Average per run</span>
                {byKind.map(([kind, k]) => (
                  <div key={kind} className="flex justify-between gap-2 text-sm">
                    <span className="capitalize">{kind}</span>
                    <span className="font-mono text-xs">
                      {fmtTokens(Math.round(k.total / k.n))} · {fmtDuration(k.time / k.n)} · {k.n} run{k.n === 1 ? "" : "s"}
                    </span>
                  </div>
                ))}
              </Card>
            )}

            <p className="text-xs text-muted-foreground">{TOKENS_HELP}</p>

            <div className="space-y-2">
              {shown.map((r) => (
                <Link key={`${r.type}:${r.id}`} href={r.href} className="block">
                  <Card size="sm" className="flex-row items-center gap-3 px-4 transition-colors hover:bg-accent/40">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-semibold">{r.title}</span>
                        <span className="readout rounded-sm border border-brass/40 px-1.5 normal-case">
                          {r.type === "job" ? `job · ${r.kind}` : r.kind}
                        </span>
                        {r.status === "running" && <Loader2 className="size-3.5 animate-spin text-fire" />}
                        {r.status === "failed" && <span className="text-xs text-taxi">failed</span>}
                      </div>
                      <div className="readout flex flex-wrap gap-x-3 normal-case">
                        <span className="text-foreground">{fmtTokens(r.tokens.total)} new</span>
                        <span>{fmtTokens(r.tokens.cacheRead)} cache</span>
                        <span>{fmtDuration(r.durationMs)}</span>
                        {r.models.length > 0 && <span>{r.models.map(modelName).join(", ")}</span>}
                        {r.effort && <span>{r.effort}</span>}
                        {r.confidence !== null && (
                          <span>
                            conf. <Confidence value={r.confidence} />
                          </span>
                        )}
                      </div>
                      <div className="readout normal-case">
                        {r.project ?? ""} · {new Date(r.startedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-brass" />
                  </Card>
                </Link>
              ))}
              {shown.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
            </div>
          </>
        )}
      </div>
    </>
  );
}
