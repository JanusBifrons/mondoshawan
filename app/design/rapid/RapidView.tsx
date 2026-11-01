"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Loader2, SkipForward, Trash2, Zap } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { QuestionListItem } from "@/lib/design";
import { cn } from "@/lib/utils";
import TalkView from "../talk/[id]/TalkView";

const SKIP_KEY = "mondo.rapid.skipped";

/** Questions skipped "for now" in this browser session, so they don't come straight back. */
function loadSkipped(): number[] {
  try {
    return JSON.parse(sessionStorage.getItem(SKIP_KEY) ?? "[]");
  } catch {
    return [];
  }
}

/**
 * Rapid fire: the open design questions, one at a time. Each question gets its own normal talk
 * with a fresh agent, so no single conversation keeps growing (and costing tokens). When the
 * question closes, the next one comes up.
 */
export default function RapidView({ project }: { project: string | null }) {
  const [questions, setQuestions] = useState<QuestionListItem[] | null>(null);
  const [slugs, setSlugs] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<number[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [answered, setAnswered] = useState(0);
  const [justClosed, setJustClosed] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSkipped(loadSkipped()), []);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/design/questions${project ? `?project=${encodeURIComponent(project)}` : ""}`, { cache: "no-store" });
      const d = (await r.json()) as { questions: QuestionListItem[]; slugs: Record<string, string> };
      setQuestions(d.questions);
      setSlugs(d.slugs);
    } catch {
      /* next poll */
    }
  }, [project]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const queue = useMemo(() => (questions ?? []).filter((q) => !skipped.includes(q.id)), [questions, skipped]);
  const current = queue.find((q) => q.id === currentId) ?? null;

  // Keep the current question until it closes; then say so briefly and move to the next.
  useEffect(() => {
    if (!questions) return;
    if (currentId !== null && !current) {
      const gone = questions.find((q) => q.id === currentId);
      if (!gone) {
        setAnswered((n) => n + 1);
        setJustClosed("Settled. Next question.");
        setTimeout(() => setJustClosed(null), 2500);
      }
    }
    if (!current) {
      setCurrentId(queue[0]?.id ?? null);
      setText("");
      setError(null);
      window.scrollTo({ top: 0 });
    }
  }, [questions, current, currentId, queue]);

  const slug = current ? slugs[current.project] : project;

  const start = async () => {
    if (!current || !slug) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/design/${slug}/discuss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: current.id, message: text, rapid: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const skip = () => {
    if (!current) return;
    const next = [...skipped, current.id];
    setSkipped(next);
    try {
      sessionStorage.setItem(SKIP_KEY, JSON.stringify(next));
    } catch {
      /* fine */
    }
    setCurrentId(null);
  };

  const dismiss = async () => {
    if (!current || !slug || !confirm("Dismiss this question? It's closed without an answer.")) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/design/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve_question", question: current.id, outcome: "dismissed", answer: "" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const back = project ? `/design/${project}` : "/design";
  const left = queue.length;

  return (
    <>
      <PageHeader title="Rapid fire" kicker={project ? (current?.project ?? "Design") : "Design · all projects"}>
        {current && (
          <>
            <Button size="sm" variant="ghost" disabled={busy} onClick={skip} title="Come back to it later">
              <SkipForward /> <span className="hidden sm:inline">Skip</span>
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={dismiss} title="Close it without an answer">
              <Trash2 /> <span className="hidden sm:inline">Dismiss</span>
            </Button>
          </>
        )}
        <Button asChild size="sm" variant="outline">
          <Link href={back}>
            <ArrowLeft /> Back
          </Link>
        </Button>
      </PageHeader>

      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
        <div className="readout flex flex-wrap items-center gap-x-3 normal-case">
          <span className="flex items-center gap-1 text-leeloo">
            <Zap className="size-3.5" /> {left} question{left === 1 ? "" : "s"} left
          </span>
          {answered > 0 && <span className="text-earth">{answered} settled this session</span>}
          {skipped.length > 0 && (
            <button
              type="button"
              className="hover:text-leeloo"
              onClick={() => {
                setSkipped([]);
                try {
                  sessionStorage.removeItem(SKIP_KEY);
                } catch {
                  /* fine */
                }
              }}
            >
              {skipped.length} skipped: bring back
            </button>
          )}
        </div>

        {justClosed && (
          <p className="flex items-center gap-1.5 text-sm text-earth">
            <Check className="size-4" /> {justClosed}
          </p>
        )}

        {!questions ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : !current ? (
          <Card className="gap-2 px-4">
            <p className="font-semibold">No questions left.</p>
            <p className="text-sm text-muted-foreground">
              {skipped.length ? "Only the ones you skipped remain." : "Every open design question is settled."}
            </p>
          </Card>
        ) : (
          <>
            <Card className={cn("gap-2 px-4", current.blocking && "border-taxi/60")}>
              <div className="readout flex flex-wrap items-center gap-x-1.5 normal-case">
                {!project && <span>{current.project} ›</span>}
                <Link href={`/design/${slug}?node=${encodeURIComponent(current.nodeId)}`} className="text-foreground hover:text-leeloo">
                  {current.nodeTitle}
                </Link>
                {current.blocking && <span className="rounded-sm bg-taxi px-1 text-[0.65rem] font-bold text-black">BLOCKING</span>}
              </div>
              <p className="text-base">{current.text}</p>
            </Card>

            {current.discussion ? (
              // Its own talk: a fresh agent for each question keeps token use down.
              <TalkView key={current.discussion} id={current.discussion} embedded />
            ) : (
              <Card className="gap-3 px-4">
                <textarea
                  rows={3}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Your first thoughts (optional)"
                  className="min-h-20 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-base outline-none focus-visible:border-ring md:text-sm dark:bg-input/30"
                />
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={start}>
                    {busy ? <Loader2 className="animate-spin" /> : <Zap />} Talk it through
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={skip}>
                    <SkipForward /> Skip for now
                  </Button>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
              </Card>
            )}
          </>
        )}
      </div>
    </>
  );
}
