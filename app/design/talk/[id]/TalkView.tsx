"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Check, Lightbulb, Loader2, MessagesSquare, PenLine, RotateCcw, SearchCheck, Send, Square, X } from "lucide-react";
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
    case "regenerate": {
      const nodes = Array.isArray(a.args.nodes) ? (a.args.nodes as unknown[]).map(String) : s("node") ? [s("node")] : [];
      head = `Re-check against the code: ${nodes.map(nodeName).join(", ")}`;
      content = <p className="text-sm text-muted-foreground">Runs a background job that rewrites their Reality from the merged code.</p>;
      break;
    }
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

type CardDecision = "approve" | "idea" | "revise" | "skip";

const PROPOSAL_STATE: Record<Proposal["status"], { label: string; cls: string }> = {
  pending: { label: "Waiting for you", cls: "border-leeloo/60" },
  locked: { label: "Approved: to be added to the game", cls: "border-earth opacity-90" },
  idea: { label: "Approved as an idea", cls: "border-air/60 opacity-90" },
  revise: { label: "Tweak sent: revised card below", cls: "border-border opacity-60" },
  approved: { label: "Saved as a draft", cls: "border-earth/50 opacity-80" },
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
  onDecide: (decision: CardDecision, note?: string) => Promise<boolean>;
  busy: boolean;
  tree: LinkableNode[];
  slug: string | null;
}) {
  const s = PROPOSAL_STATE[p.status];
  const [tweak, setTweak] = useState("");
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
      {p.note && <p className="text-sm italic text-muted-foreground">Your tweak: {p.note}</p>}
      {p.error && <p className="text-xs text-taxi">{p.error}</p>}
      {(p.status === "pending" || p.status === "failed") && (
        <div className="space-y-2 border-t border-border/60 pt-2">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => onDecide("approve")} title="To be added to the game: saves it and signs the Intent">
              <Check /> Approve
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onDecide("idea")} title="A good idea, but not for development without further review: saved, kept as an idea">
              <Lightbulb /> Approve as idea
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide("skip")}>
              <X /> Skip
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <textarea
              rows={1}
              value={tweak}
              onChange={(e) => setTweak(e.target.value)}
              placeholder="Tweak one bit? e.g. make the cap 20 players"
              className="min-h-9 flex-1 resize-y rounded-md border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring md:text-sm dark:bg-input/30"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !tweak.trim()}
              onClick={async () => {
                if (await onDecide("revise", tweak)) setTweak("");
              }}
            >
              <PenLine /> Revise
            </Button>
          </div>
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
  retry,
}: {
  /** Set on the last turn when it stopped, to ask again. */
  retry?: () => void;
  t: TalkTurn;
  first: boolean;
  tree: LinkableNode[];
  slug: string | null;
  busy: boolean;
  decide: (jobId: string, index: number, decision: CardDecision, note?: string) => Promise<boolean>;
}) {
  return (
    <div className="space-y-3">
      {!first &&
        (t.auto ? (
          <div className="flex justify-center">
            <span className="readout rounded-full border border-brass/40 px-3 py-1 normal-case">{t.text}</span>
          </div>
        ) : (
          <div className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-lg bg-leeloo/15 px-3 py-2 text-sm">{t.text}</div>
        ))}
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
        <ProposalCard
          key={i}
          p={p}
          busy={busy}
          tree={tree}
          slug={slug}
          onDecide={(decision, note) => (t.jobId ? decide(t.jobId, i, decision, note) : Promise.resolve(false))}
        />
      ))}
      {t.status !== "thinking" && t.error && (
        <div className="space-y-2 rounded-md border border-taxi/40 bg-taxi/10 px-3 py-2 text-sm text-taxi">
          <p className="whitespace-pre-wrap">{t.error}</p>
          {retry && (
            <Button size="sm" variant="outline" disabled={busy} onClick={retry}>
              <RotateCcw /> Try again
            </Button>
          )}
        </div>
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
  const input = useRef<HTMLTextAreaElement>(null);
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
        {/* The way out lives in the pinned header, so a long talk never means scrolling back up. */}
        <Button asChild size="sm" variant="outline">
          <Link href={back} title={`Back to ${talk?.nodeTitle ?? "Design"}`}>
            <ArrowLeft /> Back
          </Link>
        </Button>
      </PageHeader>
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
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
                decide={(jobId, index, decision, note) => post({ action: "decide", jobId, index, decision, note })}
                retry={i === talk.turns.length - 1 && (t.status === "failed" || t.status === "stopped") ? () => post({ action: "retry" }) : undefined}
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
              ref={input}
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
          <div className="mx-auto mt-1.5 flex max-w-3xl">
            <button
              type="button"
              disabled={busy || thinking}
              onClick={() => post({ action: "verify" })}
              className="readout flex items-center gap-1 normal-case hover:text-leeloo disabled:opacity-50"
              title="Make the agent stop and check what you're discussing against the merged code, git history and merged PRs"
            >
              <SearchCheck className="size-3.5" /> Check against the code
            </button>
          </div>
          {error && <p className="mx-auto mt-1 max-w-3xl text-xs text-destructive">{error}</p>}
        </form>
      )}
    </>
  );
}
