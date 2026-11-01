"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Check, Loader2, MessagesSquare, Send, Square, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { fmtDuration, fmtTokens } from "@/components/usage-ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { findNodeRef, wikiLinks, type LinkableNode } from "@/lib/design-links";
import type { Proposal, Talk, TalkAction, TalkTurn } from "@/lib/design-talk";
import { cn } from "@/lib/utils";

/** Agent text with [[node]] links that open the node in the design bible. */
function Text({ md, tree, slug }: { md: string; tree: LinkableNode[]; slug: string | null }) {
  return (
    <article className="prose prose-sm max-w-none break-words dark:prose-invert prose-a:text-diva prose-strong:text-foreground prose-code:text-taxi prose-pre:overflow-x-auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (url.startsWith("node:") ? url : defaultUrlTransform(url))}
        components={{
          img: () => null,
          a: ({ href, children }) => {
            if (href?.startsWith("node:")) {
              const target = findNodeRef(tree, decodeURI(href.slice(5)));
              return target && slug ? (
                <a href={`/design/${slug}?node=${encodeURIComponent(target.id)}`}>{children}</a>
              ) : (
                <span className="underline decoration-dotted">{children}</span>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {wikiLinks(md)}
      </ReactMarkdown>
    </article>
  );
}

const WAITING: Record<string, string> = { you: "you", you_at_pc: "you at the PC", agent: "an agent", other: "someone else" };

/** One action of a proposal, shown as exactly what will be saved. */
function ActionView({ a, tree, slug }: { a: TalkAction; tree: LinkableNode[]; slug: string | null }) {
  const s = (k: string) => (typeof a.args[k] === "string" ? (a.args[k] as string) : a.args[k] !== undefined ? String(a.args[k]) : "");
  const nodeName = (ref: string) => (ref ? (findNodeRef(tree, ref)?.title ?? ref.split("/").at(-1) ?? ref) : "this node");
  const label = (text: string) => <div className="readout normal-case text-brass">{text}</div>;
  const body = (md: string) => (md ? <Text md={md} tree={tree} slug={slug} /> : null);
  let head: string;
  let content: React.ReactNode = null;
  switch (a.action) {
    case "add_node":
      head = `New node: ${s("title")}${a.args.parent ? ` (under ${nodeName(s("parent"))})` : ""}${a.args.stage ? ` · ${s("stage")}` : ""}`;
      content = body(s("summary"));
      break;
    case "ensure":
      head = `New node(s): ${s("path").split("/").join(" › ")}`;
      content = body(s("summary"));
      break;
    case "write_intent":
      head = `Intent for ${nodeName(s("node"))} (draft)`;
      content = body(s("text"));
      break;
    case "ask":
      head = `Question on ${nodeName(s("node"))}${a.args.blocking ? " (blocks approval)" : ""}`;
      content = body(s("text"));
      break;
    case "resolve_question":
      head = `Close the question (${s("outcome") || "answered"})`;
      content = body(s("answer"));
      break;
    case "chase":
      head = `To-do on ${nodeName(s("node"))}: waiting on ${WAITING[s("waiting_on") || s("waitingOn")] ?? "you"}${a.args.due ? `, due ${s("due").slice(0, 10)}` : ""}`;
      content = body(s("text"));
      break;
    case "link":
      head = `Link: ${nodeName(s("from"))} ${s("type") || "relates to"} ${nodeName(s("to"))}`;
      content = body(s("note"));
      break;
    case "update_node":
      head = `Update ${nodeName(s("node"))}${a.args.title ? `: rename to "${s("title")}"` : ""}`;
      content = body(s("summary"));
      break;
    case "priority":
      head = `Priority of ${nodeName(s("node"))}: ${s("priority")}`;
      break;
    case "flag":
      head = `Flag ${nodeName(s("node"))}'s Reality as wrong`;
      content = body(s("note"));
      break;
    case "source":
      head = `Link on ${nodeName(s("node"))}: ${s("title") || s("ref")}`;
      break;
    default:
      head = a.action;
  }
  return (
    <div className="space-y-1 border-l-2 border-brass/40 pl-3">
      {label(head)}
      {content}
    </div>
  );
}

const PROPOSAL_STATE: Record<Proposal["status"], { label: string; cls: string }> = {
  pending: { label: "Waiting for you", cls: "border-leeloo/60" },
  approved: { label: "Approved and saved", cls: "border-earth/50 opacity-80" },
  skipped: { label: "Skipped", cls: "border-border opacity-60" },
  failed: { label: "Couldn't save", cls: "border-taxi/60" },
};

function ProposalCard({
  p,
  onDecide,
  busy,
  tree,
  slug,
}: {
  p: Proposal;
  onDecide: (approve: boolean) => void;
  busy: boolean;
  tree: LinkableNode[];
  slug: string | null;
}) {
  const s = PROPOSAL_STATE[p.status];
  return (
    <div className={cn("space-y-2 rounded-lg border-2 bg-card/60 p-3", s.cls)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{p.title}</span>
        <span className="readout normal-case">{s.label}</span>
      </div>
      {p.detail && <p className="text-sm text-muted-foreground">{p.detail}</p>}
      <div className="space-y-3">
        {p.actions.map((a, i) => (
          <ActionView key={i} a={a} tree={tree} slug={slug} />
        ))}
      </div>
      {p.error && <p className="text-xs text-taxi">{p.error}</p>}
      {p.status === "pending" && (
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => onDecide(true)}>
            <Check /> Approve
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide(false)}>
            <X /> Skip
          </Button>
        </div>
      )}
    </div>
  );
}

function Turn({
  t,
  first,
  tree,
  slug,
  busy,
  decide,
}: {
  t: TalkTurn;
  first: boolean;
  tree: LinkableNode[];
  slug: string | null;
  busy: boolean;
  decide: (jobId: string, index: number, approve: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      {!first && (
        <div className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-lg bg-leeloo/15 px-3 py-2 text-sm">{t.text}</div>
      )}
      {t.status === "thinking" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-fire" />
          <span>Thinking{t.progress ? ` · ${t.progress}` : "…"}</span>
        </div>
      )}
      {t.reply && (
        <Card className="gap-2 px-4">
          <Text md={t.reply} tree={tree} slug={slug} />
          {t.tokens !== null && (
            <p className="readout normal-case">
              {fmtTokens(t.tokens)} tokens · {fmtDuration(t.durationMs)}
            </p>
          )}
        </Card>
      )}
      {t.proposals.map((p, i) => (
        <ProposalCard key={i} p={p} busy={busy} tree={tree} slug={slug} onDecide={(approve) => t.jobId && decide(t.jobId, i, approve)} />
      ))}
      {t.status !== "thinking" && t.error && (
        <p className="whitespace-pre-wrap rounded-md border border-taxi/40 bg-taxi/10 px-3 py-2 text-sm text-taxi">{t.error}</p>
      )}
    </div>
  );
}

/** A design talk inside Mondo: the conversation, proposals to approve, and a reply box. */
export default function TalkView({ id }: { id: string }) {
  const [talk, setTalk] = useState<Talk | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [tree, setTree] = useState<LinkableNode[]>([]);
  const [missing, setMissing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/design/talk/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (r.status === 404) return setMissing(true);
      const d = (await r.json()) as { talk: Talk; slug: string | null };
      setTalk(d.talk);
      setSlug(d.slug);
    } catch {
      /* next poll */
    }
  }, [id]);

  const thinking = !!talk?.turns.some((t) => t.status === "thinking");

  useEffect(() => {
    load();
    const t = setInterval(load, thinking ? 2000 : 8000);
    return () => clearInterval(t);
  }, [load, thinking]);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/design/${slug}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { tree: LinkableNode[] }) => setTree(d.tree))
      .catch(() => {});
  }, [slug, talk?.turns.length]);

  // Keep the newest message in view as the talk grows.
  const size = (talk?.turns.length ?? 0) * 10 + (talk?.turns.at(-1)?.reply ? 1 : 0);
  useEffect(() => {
    if (size !== lastCount.current) {
      lastCount.current = size;
      bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [size]);

  const post = async (body: object) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/design/talk/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setTalk(d.talk);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await post({ action: "say", text })) setText("");
  };

  if (missing) {
    return (
      <>
        <PageHeader title="Design talk" kicker="Design" />
        <div className="p-6 text-sm text-muted-foreground">
          This talk no longer exists. <Link href="/design" className="text-diva underline">Back to Design</Link>
        </div>
      </>
    );
  }

  const back = slug ? `/design/${slug}${talk?.nodeId ? `?node=${encodeURIComponent(talk.nodeId)}` : ""}` : "/design";
  const pending = talk?.turns.flatMap((t) => t.proposals).filter((p) => p.status === "pending").length ?? 0;
  const settled = !!talk?.turns.at(-1)?.settled;

  return (
    <>
      <PageHeader title="Design talk" kicker={talk?.project ?? "Design"}>
        {thinking && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => post({ action: "stop" })}>
            <Square /> Stop
          </Button>
        )}
      </PageHeader>
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={back}>
            <ArrowLeft /> {talk?.nodeTitle ?? "Design"}
          </Link>
        </Button>

        {!talk ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-semibold">
                <MessagesSquare className="size-4 text-leeloo" />
                {talk.questionText ? "Talking through a question" : talk.nodeTitle ? `Talking through ${talk.nodeTitle}` : "Design discussion"}
              </div>
              {talk.questionText && <p className="text-sm">{talk.questionText}</p>}
              <div className="whitespace-pre-wrap rounded-lg bg-leeloo/15 px-3 py-2 text-sm">{talk.turns[0]?.text}</div>
            </div>

            {talk.turns.map((t, i) => (
              <Turn
                key={t.id}
                t={t}
                first={i === 0}
                tree={tree}
                slug={slug}
                busy={busy}
                decide={(jobId, index, approve) => post({ action: "decide", jobId, index, approve })}
              />
            ))}
            {settled && !thinking && (
              <p className="readout normal-case text-earth">
                The agent thinks this is settled{pending ? `: ${pending} change${pending === 1 ? "" : "s"} waiting for you above` : ""}. You can
                keep going if you like.
              </p>
            )}
            <div ref={bottom} />
          </>
        )}
      </div>

      {talk && (
        <form
          onSubmit={send}
          className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t bg-background/95 p-3 backdrop-blur-md md:bottom-0"
        >
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(e);
              }}
              placeholder={thinking ? "The agent is thinking…" : "Reply…"}
              className="min-h-11 flex-1 resize-y rounded-md border border-input bg-transparent px-3 py-2 text-base outline-none focus-visible:border-ring md:text-sm dark:bg-input/30"
            />
            <Button type="submit" disabled={busy || thinking || !text.trim()} aria-label="Send">
              {busy ? <Loader2 className="animate-spin" /> : <Send />}
            </Button>
          </div>
          {error && <p className="mx-auto mt-1 max-w-3xl text-xs text-destructive">{error}</p>}
        </form>
      )}
    </>
  );
}
