"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { QuestionListItem } from "@/lib/design";
import type { TriageDrop } from "@/lib/triage-drops";
import { cn } from "@/lib/utils";

/**
 * The result of "Check the questions": the ones the job suggests dropping, each with its reason.
 * The owner unticks any to keep and dismisses the rest in one go. Nothing changes until then.
 */
export function TriagePanel({ project, drops }: { project: string; drops: TriageDrop[] }) {
  const [open, setOpen] = useState<Map<number, QuestionListItem> | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(() => new Set(drops.map((d) => d.question)));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/design/questions", { cache: "no-store" });
    const d = (await r.json()) as { questions: QuestionListItem[]; slugs: Record<string, string> };
    setOpen(new Map(d.questions.map((q) => [q.id, q])));
    setSlug(d.slugs[project] ?? null);
  }, [project]);

  useEffect(() => {
    load().catch(() => setError("Couldn't load the questions."));
  }, [load]);

  const still = drops.filter((d) => open?.has(d.question));
  const chosen = still.filter((d) => picked.has(d.question));

  const dismiss = async () => {
    if (!slug || !chosen.length) return;
    setBusy(true);
    setError(null);
    let n = 0;
    for (const d of chosen) {
      const r = await fetch(`/api/design/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve_question", question: d.question, outcome: "dismissed", answer: d.answer || d.reason }),
      });
      if (r.ok) n++;
      else setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Question ${d.question} failed`);
    }
    setDone(n);
    await load();
    setBusy(false);
  };

  if (!open) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading the questions…
      </div>
    );
  }

  return (
    <Card className="gap-3 px-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="readout">Suggested to drop ({still.length})</h2>
        {slug && (
          <a href={`/design/rapid?project=${encodeURIComponent(slug)}`} className="readout flex items-center gap-1 normal-case hover:text-leeloo">
            <Zap className="size-3.5" /> Rapid fire the rest
          </a>
        )}
      </div>
      {done !== null && (
        <p className="flex items-center gap-1.5 text-earth">
          <Check className="size-4" /> Dismissed {done}. The rest stay in the queue.
        </p>
      )}
      {still.length === 0 ? (
        <p className="text-muted-foreground">Nothing left to drop: these are all closed already.</p>
      ) : (
        <>
          <p className="text-muted-foreground">Untick any you want to keep. Each one is closed with the note shown.</p>
          <ul className="space-y-2">
            {still.map((d) => {
              const q = open.get(d.question)!;
              const on = picked.has(d.question);
              return (
                <li key={d.question}>
                  <label className={cn("flex cursor-pointer gap-3 rounded-lg border p-3", on ? "border-taxi/50" : "opacity-60")}>
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={on}
                      onChange={() =>
                        setPicked((s) => {
                          const n = new Set(s);
                          if (n.has(d.question)) n.delete(d.question);
                          else n.add(d.question);
                          return n;
                        })
                      }
                    />
                    <span className="min-w-0 space-y-1">
                      <span className="readout block normal-case">{q.nodeTitle}</span>
                      <span className="block">{q.text}</span>
                      <span className="block text-taxi">Why drop it: {d.reason}</span>
                      {d.answer && <span className="block text-muted-foreground">Note recorded: {d.answer}</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <Button disabled={busy || !chosen.length} onClick={dismiss}>
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />} Dismiss {chosen.length} question{chosen.length === 1 ? "" : "s"}
          </Button>
        </>
      )}
      {error && <p className="text-destructive">{error}</p>}
    </Card>
  );
}
