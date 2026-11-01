"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, CircleHelp, Loader2, MessagesSquare, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { QuestionListItem, TreeNode } from "@/lib/design";
import { cn } from "@/lib/utils";

/** Native form controls styled to match shadcn inputs. */
const FIELD =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

function since(ms: number): string {
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const asker = (a: string) => (a === "human" ? "you" : a.replace(/^agent:/, "an agent (") + (a.startsWith("agent:") ? ")" : ""));

/**
 * Open design questions as cards. Tapping one opens its node on the Questions tab, where it
 * can be answered or talked through with an agent.
 */
export function QuestionCards({
  items,
  slugs,
  onOpen,
  showProject = false,
  limit = 6,
}: {
  items: QuestionListItem[];
  /** Project name -> URL slug, for links across projects (plain data: server pages pass it). */
  slugs: Record<string, string>;
  /** On a project page: open the node in place instead of navigating. */
  onOpen?: (nodeId: string) => void;
  showProject?: boolean;
  limit?: number;
}) {
  const [all, setAll] = useState(false);
  if (!items.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No open design questions. Start a discussion to explore something, and the agent will raise them.
      </p>
    );
  }
  const shown = all ? items : items.slice(0, limit);
  return (
    <div className="space-y-2">
      {shown.map((q) => {
        const href = `/design/${slugs[q.project] ?? ""}?node=${encodeURIComponent(q.nodeId)}&tab=questions`;
        const body = (
          <>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="readout flex flex-wrap items-center gap-x-1.5 normal-case">
                {showProject && <span>{q.project} ›</span>}
                <span className="text-foreground">{q.nodeTitle}</span>
                {q.blocking && <span className="rounded-sm bg-taxi px-1 text-[0.65rem] font-bold text-black">BLOCKING</span>}
                {q.discussion && (
                  <span className="flex items-center gap-1 text-leeloo">
                    <MessagesSquare className="size-3" /> being talked through
                  </span>
                )}
              </div>
              <p className="text-sm">{q.text}</p>
              <p className="readout normal-case">
                Asked by {asker(q.raisedBy)} · {since(q.createdAt)}
              </p>
            </div>
            <ChevronRight className="size-4 shrink-0 self-center text-brass" />
          </>
        );
        const cls = cn(
          "flex w-full gap-3 rounded-lg border bg-card/60 p-3 text-left transition-colors hover:border-leeloo",
          q.blocking && "border-taxi/50",
        );
        return onOpen ? (
          <button key={q.id} type="button" className={cls} onClick={() => onOpen(q.nodeId)}>
            {body}
          </button>
        ) : (
          <a key={q.id} href={href} className={cls}>
            {body}
          </a>
        );
      })}
      {items.length > limit && (
        <button type="button" className="readout hover:text-leeloo" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

/** "Projects › Combat › Weapons" for every node, for the area picker. */
function nodeOptions(tree: TreeNode[]) {
  const byId = new Map(tree.map((t) => [t.id, t]));
  const label = (n: TreeNode) => {
    const parts = [n.title];
    let cur = n.parentId ? byId.get(n.parentId) : undefined;
    for (let g = 0; cur && g < 50; g++) {
      parts.unshift(cur.title);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return parts.join(" › ");
  };
  return tree
    .filter((n) => n.stage !== "retired")
    .map((n) => ({ id: n.id, label: label(n) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Start a design conversation with an agent: pick a project and an area (or "something
 * new"), say what's on your mind. It opens as a design talk inside Mondo.
 */
export function StartDiscussion({
  projects,
  project: fixedProject,
  node: fixedNode,
  startOpen = false,
  compact = false,
}: {
  projects?: { slug: string; name: string }[];
  /** Fix the project (on a project page or node). */
  project?: string;
  /** Fix the node (on a node's drill-down). */
  node?: { id: string; title: string };
  startOpen?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  const [slug, setSlug] = useState(fixedProject ?? projects?.[0]?.slug ?? "");
  const [tree, setTree] = useState<TreeNode[] | null>(null);
  const [area, setArea] = useState(fixedNode?.id ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || fixedNode || !slug) return;
    setTree(null);
    fetch(`/api/design/${slug}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { tree: TreeNode[] }) => setTree(d.tree))
      .catch(() => setTree([]));
  }, [open, slug, fixedNode]);

  const options = useMemo(() => (tree ? nodeOptions(tree) : []), [tree]);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/design/${slug}/discuss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node: area || null, message }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      router.push(`/design/talk/${encodeURIComponent(d.talkId)}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button variant={compact ? "outline" : "default"} size={compact ? "sm" : "default"} onClick={() => setOpen(true)}>
        <MessagesSquare /> {fixedNode ? "Talk it through with an agent" : "Start a design discussion"}
      </Button>
    );
  }

  return (
    <Card className="gap-3 px-4">
      <form onSubmit={start} className="space-y-3">
        <div className="flex items-center gap-2 font-semibold">
          <MessagesSquare className="size-4 text-leeloo" />
          {fixedNode ? `Talk through "${fixedNode.title}"` : "Start a design discussion"}
        </div>
        {!fixedProject && projects && projects.length > 1 && (
          <label className="block space-y-1.5">
            <span className="readout">Project</span>
            <select className={FIELD} value={slug} onChange={(e) => (setSlug(e.target.value), setArea(""))}>
              {projects.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!fixedNode && (
          <label className="block space-y-1.5">
            <span className="readout">About</span>
            <select className={FIELD} value={area} onChange={(e) => setArea(e.target.value)} disabled={!tree}>
              <option value="">Something new, or the design as a whole</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block space-y-1.5">
          <span className="readout">What&apos;s on your mind? (optional)</span>
          <textarea
            className={cn(FIELD, "min-h-24 resize-y")}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={fixedNode || area ? "A question, a worry, an idea…" : "What if we added mines?"}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          An agent reads the design (and the code, read-only) and talks it through with you here. Any change it suggests
          shows as a card you approve before it's saved.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !slug}>
            {busy ? <Loader2 className="animate-spin" /> : <MessagesSquare />} Start the conversation
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** A collapsed section, e.g. for follow-ups (chases), which matter but don't lead the page. */
export function Collapsed({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!count) return null;
  return (
    <section className="space-y-2">
      <button type="button" className="readout flex items-center gap-1 hover:text-leeloo" onClick={() => setOpen((v) => !v)}>
        <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
        {title} ({count})
      </button>
      {open && children}
    </section>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="readout flex items-center gap-2">
      <CircleHelp className="size-3.5" /> {children}
    </h2>
  );
}

/** Starts a regeneration (fixed instruction) for one or more nodes, then shows the agent. */
export function RegenerateButton({
  slug,
  nodes,
  label = "Regenerate",
  primary = false,
  confirmText,
}: {
  slug: string;
  nodes: string[];
  label?: string;
  primary?: boolean;
  confirmText?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/design/${slug}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      router.push(`/agents/job/${encodeURIComponent(d.jobId)}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-col gap-1">
      <Button size="sm" variant={primary ? "default" : "outline"} disabled={busy || !nodes.length} onClick={go}>
        {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} {label}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

export interface CodeChangeItem {
  nodeId: string;
  title: string;
  since: string;
  files: string[];
}

/** Nodes whose code changed since they were checked, with "Update all" (one agent for all of them). */
export function ChangedSection({
  slug,
  changes,
  against,
  onOpen,
}: {
  slug: string;
  changes: CodeChangeItem[];
  against: string | null;
  onOpen: (nodeId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!changes.length) return null;
  const batch = changes.slice(0, 40);
  return (
    <section className="space-y-2 rounded-lg border border-taxi/40 bg-taxi/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="readout flex items-center gap-1 text-taxi hover:text-leeloo" onClick={() => setOpen((v) => !v)}>
          <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
          Code changed since checked ({changes.length})
        </button>
        <span className="ml-auto">
          <RegenerateButton
            slug={slug}
            nodes={batch.map((c) => c.nodeId)}
            label={`Update ${batch.length === changes.length ? "all" : batch.length}`}
            primary
            confirmText={`Start an agent to re-check and rewrite ${batch.length} node${batch.length === 1 ? "" : "s"} against the merged code? It runs on its own; you can watch it on the Agents page.`}
          />
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        The code these descriptions cite has changed in the merged game{against ? ` (${against})` : ""} since they were
        written.
      </p>
      {open && (
        <div className="space-y-1.5">
          {changes.map((c) => (
            <button
              key={c.nodeId}
              type="button"
              onClick={() => onOpen(c.nodeId)}
              className="flex w-full items-center gap-2 rounded-md border bg-card/60 px-3 py-2 text-left text-sm hover:border-leeloo"
            >
              <span className="min-w-0 flex-1 truncate">{c.title}</span>
              <span className="readout shrink-0 normal-case">
                {c.files.length} file{c.files.length === 1 ? "" : "s"} · since {c.since}
              </span>
              <ChevronRight className="size-4 shrink-0 text-brass" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
