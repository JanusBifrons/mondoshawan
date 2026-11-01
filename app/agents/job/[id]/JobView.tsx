"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, Square, Trash2, Wrench } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Confidence, TOKENS_HELP, TokenGrid, fmtDuration, fmtTokens, modelName } from "@/components/usage-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ActivityLine } from "@/lib/fleet";
import type { Job } from "@/lib/jobs";
import type { UsageRun } from "@/lib/usage";
import { cn } from "@/lib/utils";

interface Detail {
  job: Job;
  run: UsageRun;
  activity: ActivityLine[];
}

const STATUS: Record<Job["status"], { label: string; cls: string }> = {
  running: { label: "Running", cls: "border-fire/50 bg-fire/15 text-fire" },
  done: { label: "Done", cls: "border-earth/40 bg-earth/10 text-earth" },
  failed: { label: "Failed", cls: "border-transparent bg-taxi text-black" },
  stopped: { label: "Stopped", cls: "border-water/30 bg-water/10 text-water/80" },
};

export function JobStatusBadge({ status }: { status: Job["status"] }) {
  const s = STATUS[status];
  return (
    <Badge variant="outline" className={cn("gap-1.5 rounded-sm font-semibold uppercase tracking-wide", s.cls)}>
      {status === "running" && <Loader2 className="size-3 animate-spin" />}
      {s.label}
    </Badge>
  );
}

/** A background job: what it's doing, what it found, and what it used. */
export default function JobView({ id }: { id: string }) {
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/jobs/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (r.status === 404) return setMissing(true);
      setD(await r.json());
    } catch {
      /* next poll */
    }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (action: "stop" | "remove", confirmText: string) => {
    if (!confirm(confirmText)) return;
    setBusy(true);
    await fetch(`/api/jobs/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => {});
    setBusy(false);
    if (action === "remove") router.push("/agents");
    else load();
  };

  if (missing) {
    return (
      <>
        <PageHeader title="Job" kicker="Background job" />
        <div className="p-6 text-sm text-muted-foreground">
          This job no longer exists. <Link href="/agents" className="text-diva underline">Back to agents</Link>
        </div>
      </>
    );
  }

  const j = d?.job;
  const r = d?.run;
  const result = (j?.result ?? {}) as { rewritten?: string[]; created?: string[]; concerns?: string[] };

  return (
    <>
      <PageHeader title={j?.title ?? "Job"} kicker="Background job">
        {j && <JobStatusBadge status={j.status} />}
      </PageHeader>
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/agents">
            <ArrowLeft /> Agents
          </Link>
        </Button>

        {!j || !r ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {j.status === "running" && (
              <Card className="gap-2 px-4">
                <div className="flex items-center gap-2 font-semibold">
                  <Loader2 className="size-4 animate-spin text-fire" /> Working · {fmtDuration(r.durationMs)}
                </div>
                <p className="text-sm text-muted-foreground">
                  It runs in the background with no window; this page updates as it goes. {j.toolCalls} step
                  {j.toolCalls === 1 ? "" : "s"} so far.
                </p>
                {j.progress && <p className="font-mono text-xs text-diva">{j.progress}</p>}
              </Card>
            )}

            {j.error && (
              <p className="whitespace-pre-wrap rounded-md border border-taxi/40 bg-taxi/10 px-3 py-2 text-sm text-taxi">{j.error}</p>
            )}

            {j.summary && (
              <Card className="gap-3 px-4 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="readout">Result</h2>
                  <span className="readout normal-case">
                    Confidence <Confidence value={j.confidence} />
                  </span>
                </div>
                <p className="whitespace-pre-wrap">{j.summary}</p>
                {!!result.rewritten?.length && (
                  <p>
                    <span className="readout normal-case">Rewrote: </span>
                    {result.rewritten.join(", ")}
                  </p>
                )}
                {!!result.created?.length && (
                  <p>
                    <span className="readout normal-case">Created: </span>
                    {result.created.join(", ")}
                  </p>
                )}
                {!!result.concerns?.length && (
                  <div>
                    <span className="readout normal-case text-taxi">Concerns</span>
                    <ul className="mt-1 list-disc space-y-1 pl-5">
                      {result.concerns.map((c, n) => (
                        <li key={n}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            )}

            <Card className="gap-3 px-4 text-sm">
              <h2 className="readout">Usage</h2>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                <Stat label="Model">{r.models.map(modelName).join(", ") || "—"}</Stat>
                <Stat label="Effort">{j.effort ?? "—"}</Stat>
                <Stat label="Took">{fmtDuration(r.durationMs)}</Stat>
                <Stat label="Thinking time">{fmtDuration(j.apiMs)}</Stat>
                <Stat label="Turns">{j.turns ?? "—"}</Stat>
                <Stat label="Tool calls">{j.toolCalls}</Stat>
              </div>
              <TokenGrid t={r.tokens} thinking={j.thinkingTokens} />
              {j.modelUsage.length > 1 && (
                <div className="space-y-1">
                  {j.modelUsage.map((m) => (
                    <p key={m.model} className="readout normal-case">
                      {modelName(m.model)}: {fmtTokens(m.input + m.output + m.cacheWrite)} new · {fmtTokens(m.cacheRead)} cache read
                    </p>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">{TOKENS_HELP}</p>
            </Card>

            <div className="flex flex-wrap gap-2">
              {j.status === "running" ? (
                <Button variant="outline" className="hover:text-destructive" disabled={busy} onClick={() => act("stop", "Stop this job? Its work so far stays in the design.")}>
                  <Square /> Stop
                </Button>
              ) : (
                <Button variant="ghost" className="hover:text-destructive" disabled={busy} onClick={() => act("remove", "Remove this job and its log? Its changes to the design stay.")}>
                  <Trash2 /> Remove
                </Button>
              )}
            </div>

            {d.activity.length > 0 && (
              <section className="space-y-2">
                <h2 className="readout">What it did</h2>
                <ol className="space-y-2">
                  {[...d.activity].reverse().map((a, n) => (
                    <li key={n} className="text-sm">
                      {a.kind === "tool" ? (
                        <span className="flex gap-2 font-mono text-xs text-diva">
                          <Wrench className="mt-0.5 size-3.5 shrink-0 text-brass" />
                          <span className="min-w-0 break-words">{a.text}</span>
                        </span>
                      ) : a.kind === "claude" ? (
                        <p className="whitespace-pre-wrap break-words rounded-md bg-muted/40 px-3 py-2">{a.text}</p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="readout normal-case">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}
