"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlarmClock,
  AlertTriangle,
  Check,
  ChevronsUp,
  ExternalLink,
  Flame,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Flag,
  GitCompareArrows,
  Link2,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ElementGlyph, type Element } from "@/components/elements";
import { cn } from "@/lib/utils";
import {
  BAND_LABEL,
  DECISION_LABEL,
  FIDELITY_LABEL,
  KINDS,
  KIND_LABEL,
  LINK_LABEL,
  LINK_TYPES,
  REVIEW_DECISIONS,
  STAGES,
  STAGE_HINT,
  STAGE_LABEL,
  bandOf,
  chaseUrgency,
  PRIORITIES,
  PRIORITY_LABEL,
  PRIORITY_RANK,
  WAITING_LABEL,
  WAITING_ON,
  type Priority,
  type WaitingOn,
  type Band,
  type Kind,
  type LinkType,
  type Stage,
} from "@/lib/design-meta";
import type { ChaseListItem, DesignEvent, NodeDetail, QuestionListItem, Revision, TreeNode } from "@/lib/design";
import { Collapsed, QuestionCards, SectionTitle, StartDiscussion } from "@/components/design-home";
import { findNodeRef, wikiLinks } from "@/lib/design-links";

// ---------- look ----------

/** Ideas are air (open sky), proposals water (still shifting), approved the fifth (a human signed it),
 *  in build fire (being forged), built earth (solid ground). */
export const STAGE_ELEMENT: Record<Stage, Element | null> = {
  idea: "air",
  proposed: "water",
  approved: "fifth",
  in_build: "fire",
  built: "earth",
  retired: null,
};

const STAGE_TEXT: Record<Stage, string> = {
  idea: "text-air",
  proposed: "text-water",
  approved: "text-fifth",
  in_build: "text-fire",
  built: "text-earth",
  retired: "text-muted-foreground",
};

function StageGlyph({ stage, className }: { stage: Stage; className?: string }) {
  const el = STAGE_ELEMENT[stage];
  return el ? (
    <ElementGlyph element={el} className={cn(STAGE_TEXT[stage], className)} />
  ) : (
    <X className={cn("size-4 text-muted-foreground", className)} aria-hidden />
  );
}

function StageBadge({ stage }: { stage: Stage }) {
  return (
    <span className={cn("readout inline-flex items-center gap-1 normal-case", STAGE_TEXT[stage])} title={STAGE_HINT[stage]}>
      <StageGlyph stage={stage} className="size-3.5" />
      {STAGE_LABEL[stage]}
    </span>
  );
}

const fmt = (t: number) =>
  new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const who = (actor: string) => (actor === "human" ? "You" : actor.replace(/^agent:/, "Agent · "));

/**
 * Links between nodes inside design text, so nothing needs outside context. Write
 * `[[Sectors]]`, `[[Galaxy map/Sectors|sectors]]` or `[sectors](node:<id or title path>)`.
 * A link opens that node; one to a node that doesn't exist yet shows dotted.
 */
const NodeLinks = createContext<{ tree: TreeNode[]; onSelect: (id: string) => void } | null>(null);

function NodeLink({ href, children }: { href: string; children: React.ReactNode }) {
  const ctx = useContext(NodeLinks);
  const ref = decodeURI(href.slice("node:".length));
  const target = ctx ? findNodeRef(ctx.tree, ref) : null;
  if (!target || !ctx) {
    return (
      <span className="cursor-help underline decoration-dotted" title={`No design node called "${ref}" yet`}>
        {children}
      </span>
    );
  }
  return (
    <button type="button" className="font-medium text-diva underline underline-offset-2 hover:text-leeloo" onClick={() => ctx.onSelect(target.id)}>
      {children}
    </button>
  );
}

function Markdown({ children }: { children: string }) {
  return (
    <article className="prose prose-sm max-w-none break-words dark:prose-invert prose-headings:font-[family-name:var(--ff-display)] prose-headings:uppercase prose-headings:tracking-wider prose-headings:text-leeloo prose-a:text-diva prose-strong:text-foreground prose-code:text-taxi prose-pre:overflow-x-auto prose-table:block prose-table:overflow-x-auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (url.startsWith("node:") ? url : defaultUrlTransform(url))}
        components={{
          img: () => null,
          a: ({ href, children }) =>
            href?.startsWith("node:") ? (
              <NodeLink href={href}>{children}</NodeLink>
            ) : (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
        }}
      >
        {wikiLinks(children)}
      </ReactMarkdown>
    </article>
  );
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
        props.className,
      )}
    />
  );
}

function Select<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={cn("h-8 rounded-lg border border-input bg-background px-2 text-sm dark:bg-input/30", className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ---------- data ----------

interface TreeData {
  project: string;
  tree: TreeNode[];
  chases: ChaseListItem[];
  questions: QuestionListItem[];
  events: DesignEvent[];
  lastEvent: number;
}

/** Loads the tree and reloads whenever the design changes (SSE, polling as a fallback). */
function useDesign(slug: string) {
  const [data, setData] = useState<TreeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState(0);

  const reload = useCallback(async () => {
    try {
      const r = await fetch(`/api/design/${slug}`, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
      const d: TreeData = await r.json();
      setData(d);
      setLastEvent(d.lastEvent);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [slug]);

  useEffect(() => {
    reload();
    let poll: ReturnType<typeof setInterval> | null = null;
    const es = new EventSource(`/api/design/${slug}/stream`);
    es.onmessage = (m) => {
      const { lastEvent: id } = JSON.parse(m.data) as { lastEvent: number };
      setLastEvent((prev) => {
        if (id !== prev) reload();
        return id;
      });
    };
    es.onerror = () => {
      if (!poll) poll = setInterval(reload, 5000);
    };
    es.onopen = () => {
      if (poll) clearInterval(poll);
      poll = null;
    };
    return () => {
      es.close();
      if (poll) clearInterval(poll);
    };
  }, [slug, reload]);

  return { data, error, reload, lastEvent };
}

async function act(slug: string, body: Record<string, unknown>) {
  const r = await fetch(`/api/design/${slug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error ?? r.statusText);
  return out.result;
}

/** Wraps an action with busy/error state. */
function useAct(slug: string, after?: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const r = await act(slug, body);
        after?.();
        return r;
      } catch (e) {
        setError((e as Error).message);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [slug, after],
  );
  return { run, busy, error, clear: () => setError(null) };
}

function useMinWidth(px: number) {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(`(min-width: ${px}px)`);
    const on = () => setOk(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [px]);
  return ok;
}

// ---------- gaps ----------

type GapKey =
  | "overdue"
  | "priority"
  | "drifted"
  | "openReviews"
  | "blocking"
  | "questions"
  | "flagged"
  | "approvedUnbuilt"
  | "unchecked"
  | "drafts"
  | "stale";

const STALE_MS = 30 * 24 * 3600 * 1000;

const GAPS: { key: GapKey; label: string; test: (n: TreeNode) => boolean; urgent?: boolean }[] = [
  { key: "overdue", label: "Overdue chases", test: (n) => n.nextChaseAt !== null && n.nextChaseAt < Date.now(), urgent: true },
  { key: "priority", label: "High priority", test: (n) => (n.priority === "high" || n.priority === "urgent") && n.stage !== "built", urgent: true },
  { key: "openReviews", label: "Open reviews", test: (n) => n.openReviews > 0, urgent: true },
  { key: "drifted", label: "Drifted", test: (n) => n.fidelity === "drifted", urgent: true },
  { key: "blocking", label: "Blocking questions", test: (n) => n.blockingQuestions > 0, urgent: true },
  { key: "questions", label: "Open questions", test: (n) => n.openQuestions > 0 },
  { key: "flagged", label: "Reality flagged", test: (n) => !!n.realityFlag },
  { key: "drafts", label: "Unsigned intent", test: (n) => n.intentDraft },
  { key: "approvedUnbuilt", label: "Approved, not built", test: (n) => n.stage === "approved" },
  { key: "unchecked", label: "Unverified", test: (n) => n.hasCanonIntent && n.hasReality && n.fidelity === "unchecked" },
  {
    key: "stale",
    label: "Stale ideas",
    test: (n) => (n.stage === "idea" || n.stage === "proposed") && n.openChases === 0 && Date.now() - n.updatedAt > STALE_MS,
  },
];

function GapsStrip({ tree, active, onPick }: { tree: TreeNode[]; active: GapKey | null; onPick: (k: GapKey | null) => void }) {
  const live = tree.filter((n) => n.stage !== "retired");
  const counts = GAPS.map((g) => ({ ...g, count: live.filter(g.test).length }));
  const byBand = (b: Band) => live.filter((n) => bandOf(n.stage) === b).length;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {(["sky", "grey", "ground"] as Band[]).map((b) => (
          <div key={b} className="frame rounded-lg border bg-card/60 px-3 py-2">
            <div className="readout truncate">{BAND_LABEL[b].split(" · ")[0]}</div>
            <div className="display text-lg font-bold">{byBand(b)}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {counts
          .filter((g) => g.count > 0 || active === g.key)
          .map((g) => (
            <button
              key={g.key}
              onClick={() => onPick(active === g.key ? null : g.key)}
              className={cn(
                "readout flex items-center gap-1.5 rounded-full border px-2.5 py-1 normal-case transition-colors",
                active === g.key ? "border-leeloo text-leeloo" : "hover:border-leeloo/60",
                g.urgent && g.count > 0 && active !== g.key && "border-taxi/70 text-taxi",
              )}
            >
              {g.label} <span className="font-bold">{g.count}</span>
            </button>
          ))}
        {counts.every((g) => g.count === 0) && <span className="readout normal-case">Nothing needs attention.</span>}
      </div>
    </div>
  );
}

// ---------- tree & flow ----------

function NodeFlags({ n }: { n: TreeNode }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {n.priority === "urgent" && <Flame className="size-3.5 text-fire" aria-label="Urgent" />}
      {n.priority === "high" && <ChevronsUp className="size-3.5 text-taxi" aria-label="High priority" />}
      {n.nextChaseAt !== null && (
        <AlarmClock className={cn("size-3.5", URGENCY_TEXT[chaseUrgency(n.nextChaseAt)])} aria-label="Open chase" />
      )}
      {n.openReviews > 0 && <span className="hazard h-3 w-5 rounded-sm" title="Open review" />}
      {n.fidelity === "drifted" && <GitCompareArrows className="size-3.5 text-taxi" aria-label="Drifted" />}
      {n.realityFlag && <Flag className="size-3.5 text-destructive" aria-label="Reality flagged" />}
      {n.openQuestions > 0 && (
        <span className={cn("readout flex items-center gap-0.5", n.blockingQuestions ? "text-taxi" : "")}>
          <CircleHelp className="size-3.5" />
          {n.openQuestions}
        </span>
      )}
      {n.intentDraft && (
        <span className="readout text-diva" title="Unsigned intent">
          draft
        </span>
      )}
    </span>
  );
}

function NodeRowButton({
  n,
  selected,
  onSelect,
  depth = 0,
  toggle,
  path,
}: {
  n: TreeNode;
  selected: boolean;
  onSelect: (id: string) => void;
  depth?: number;
  toggle?: { open: boolean; onToggle: () => void } | null;
  path?: string;
}) {
  return (
    <div
      className={cn(
        "group flex min-h-10 items-center gap-1.5 rounded-md pr-2 transition-colors hover:bg-muted/60",
        selected && "bg-muted shadow-[inset_2px_0_0_var(--leeloo)]",
        n.stage === "retired" && "opacity-55",
      )}
      style={{ paddingLeft: 4 + depth * 16 }}
    >
      {toggle !== undefined ? (
        <button
          className="grid size-6 shrink-0 place-items-center text-muted-foreground hover:text-foreground disabled:opacity-0"
          disabled={!toggle}
          onClick={toggle?.onToggle}
          aria-label={toggle?.open ? "Collapse" : "Expand"}
        >
          {toggle?.open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
      ) : null}
      <button className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left" onClick={() => onSelect(n.id)}>
        <StageGlyph stage={n.stage} />
        <span className="min-w-0 flex-1">
          {path && <span className="readout block truncate normal-case">{path}</span>}
          <span className={cn("block truncate text-sm", selected && "text-leeloo")}>{n.title}</span>
        </span>
      </button>
      <NodeFlags n={n} />
    </div>
  );
}

function TreeView({
  tree,
  selected,
  onSelect,
  showRetired,
}: {
  tree: TreeNode[];
  selected: string | null;
  onSelect: (id: string) => void;
  showRetired: boolean;
}) {
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const kids = useMemo(() => {
    const m = new Map<string | null, TreeNode[]>();
    const ids = new Set(tree.map((n) => n.id));
    for (const n of tree) {
      if (!showRetired && n.stage === "retired") continue;
      const key = n.parentId && ids.has(n.parentId) ? n.parentId : null;
      m.set(key, [...(m.get(key) ?? []), n]);
    }
    return m;
  }, [tree, showRetired]);

  const render = (parent: string | null, depth: number): React.ReactNode =>
    (kids.get(parent) ?? []).map((n) => {
      const has = (kids.get(n.id) ?? []).length > 0;
      const open = !closed.has(n.id);
      return (
        <div key={n.id}>
          <NodeRowButton
            n={n}
            depth={depth}
            selected={selected === n.id}
            onSelect={onSelect}
            toggle={
              has
                ? {
                    open,
                    onToggle: () =>
                      setClosed((s) => {
                        const next = new Set(s);
                        if (open) next.add(n.id);
                        else next.delete(n.id);
                        return next;
                      }),
                  }
                : null
            }
          />
          {has && open && render(n.id, depth + 1)}
        </div>
      );
    });

  return <div>{render(null, 0)}</div>;
}

function pathLabel(tree: TreeNode[], n: TreeNode): string {
  const byId = new Map(tree.map((t) => [t.id, t]));
  const parts: string[] = [];
  let cur = n.parentId ? byId.get(n.parentId) : undefined;
  let guard = 0;
  while (cur && guard++ < 50) {
    parts.unshift(cur.title);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return parts.join(" › ");
}

/** The three bands, sky at the top down to built ground. */
function FlowView({
  tree,
  selected,
  onSelect,
  showRetired,
}: {
  tree: TreeNode[];
  selected: string | null;
  onSelect: (id: string) => void;
  showRetired: boolean;
}) {
  const bands: Band[] = showRetired ? ["sky", "grey", "ground", "retired"] : ["sky", "grey", "ground"];
  return (
    <div className="space-y-4">
      {bands.map((b) => {
        const nodes = tree.filter((n) => bandOf(n.stage) === b);
        return (
          <section key={b}>
            <h3 className="readout mb-1 border-b border-brass/30 pb-1">
              {BAND_LABEL[b]} <span className="text-foreground">{nodes.length}</span>
            </h3>
            {nodes.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">Nothing here yet.</p>
            ) : (
              nodes.map((n) => (
                <NodeRowButton key={n.id} n={n} selected={selected === n.id} onSelect={onSelect} path={pathLabel(tree, n)} />
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}

// ---------- add node ----------

function AddNodeForm({
  slug,
  parent,
  onDone,
  onCreated,
}: {
  slug: string;
  parent: { id: string; title: string } | null;
  onDone: () => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Kind>(parent ? "mechanic" : "system");
  const [summary, setSummary] = useState("");
  const { run, busy, error } = useAct(slug);
  return (
    <form
      className="frame space-y-2 rounded-lg border bg-card/60 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run({ action: "add_node", title, kind, summary, parent: parent?.id, stage: "idea" });
        if (r?.id) {
          onCreated(r.id);
          onDone();
        }
      }}
    >
      <div className="readout">{parent ? `New idea under ${parent.title}` : "New top-level idea"}</div>
      <Input autoFocus placeholder='e.g. "Mines"' value={title} onChange={(e) => setTitle(e.target.value)} />
      <Input placeholder="One-line summary (optional)" value={summary} onChange={(e) => setSummary(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        <Select value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
        <Button type="submit" size="sm" disabled={busy || !title.trim()}>
          <Plus /> Add idea
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}

// ---------- node panel ----------

type Tab = "intent" | "reality" | "reviews" | "questions" | "links" | "history";

function useNode(slug: string, id: string | null, lastEvent: number) {
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await fetch(`/api/design/${slug}/nodes/${id}`, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
      setDetail(await r.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [slug, id]);
  useEffect(() => {
    setDetail(null);
  }, [id]);
  useEffect(() => {
    load();
  }, [load, lastEvent]);
  return { detail, error, reload: load };
}

function NodePanel({
  slug,
  id,
  tree,
  lastEvent,
  onSelect,
  onReload,
  initialTab,
}: {
  slug: string;
  id: string;
  tree: TreeNode[];
  lastEvent: number;
  onSelect: (id: string) => void;
  onReload: () => void;
  /** Open on this tab (e.g. "questions" when arriving from a question card). */
  initialTab?: Tab;
}) {
  const { detail, error, reload } = useNode(slug, id, lastEvent);
  const refresh = useCallback(() => {
    reload();
    onReload();
  }, [reload, onReload]);
  const [tab, setTab] = useState<Tab>(initialTab ?? "intent");
  const tabChosen = useRef(!!initialTab);
  useEffect(() => {
    if (!detail || tabChosen.current) return;
    tabChosen.current = true;
    if (detail.reality) setTab("reality");
  }, [detail]);
  const [adding, setAdding] = useState(false);

  if (error) return <p className="p-4 text-sm text-destructive">{error}</p>;
  if (!detail) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  const { node } = detail;
  const openQ = detail.questions.filter((q) => q.status === "open").length;
  const openR = detail.reviews.filter((r) => r.status === "open").length;
  const openC = detail.chases.filter((c) => c.status === "open").length;

  const tabs: { key: Tab; label: string; badge?: number; urgent?: boolean }[] = [
    ...(detail.reality
      ? ([
          { key: "reality", label: "Reality" },
          { key: "intent", label: "Intent" },
        ] as const)
      : ([
          { key: "intent", label: "Intent" },
          { key: "reality", label: "Reality" },
        ] as const)),
    { key: "reviews", label: "Reviews", badge: openR, urgent: openR > 0 },
    { key: "questions", label: "Questions", badge: openQ, urgent: detail.questions.some((q) => q.status === "open" && q.blocking) },
    { key: "links", label: "Links", badge: detail.links.length },
    { key: "history", label: "History" },
  ];

  return (
    <div className="flex min-h-0 flex-col">
      <div className="space-y-3 border-b p-4">
        <nav className="readout flex flex-wrap items-center gap-1 normal-case">
          {detail.path.slice(0, -1).map((p) => (
            <span key={p.id} className="flex items-center gap-1">
              <button className="hover:text-leeloo" onClick={() => onSelect(p.id)}>
                {p.title}
              </button>
              <ChevronRight className="size-3" />
            </span>
          ))}
        </nav>
        <TitleEditor slug={slug} node={node} onSaved={refresh} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <StageBadge stage={node.stage} />
          <span className="readout normal-case">{KIND_LABEL[node.kind]}</span>
          {(detail.canonIntent || detail.reality) && (
            <span
              className={cn(
                "readout normal-case",
                node.fidelity === "drifted" && "text-taxi",
                node.fidelity === "matches" && "text-earth",
              )}
            >
              {FIDELITY_LABEL[node.fidelity]}
              {node.checkedSha && ` @ ${node.checkedSha.slice(0, 7)}`}
            </span>
          )}
        </div>
        <StartDiscussion key={node.id} project={slug} node={{ id: node.id, title: node.title }} compact />
        <details className="group rounded-lg border px-3 py-2">
          <summary className="readout cursor-pointer list-none hover:text-leeloo">
            <span className="inline-block transition-transform group-open:rotate-90">›</span> Manage: stage, priority, follow-ups
            {openC > 0 && <span className="text-taxi"> · {openC} follow-up{openC === 1 ? "" : "s"}</span>}
          </summary>
          <div className="mt-3 space-y-3">
            <StageControl slug={slug} detail={detail} onDone={refresh} />
            <PriorityControl slug={slug} node={node} onDone={refresh} />
            <ChasesBlock slug={slug} detail={detail} onDone={refresh} />
            {adding ? (
              <AddNodeForm slug={slug} parent={node} onDone={() => setAdding(false)} onCreated={(nid) => (refresh(), onSelect(nid))} />
            ) : (
              <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                <Plus /> Add an idea under this
              </Button>
            )}
          </div>
        </details>
        {detail.children.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {detail.children.map((c) => (
              <button
                key={c.id}
                onClick={() => onSelect(c.id)}
                className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs hover:border-leeloo"
              >
                <StageGlyph stage={c.stage} className="size-3" /> {c.title}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b px-2" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => ((tabChosen.current = true), setTab(t.key))}
            className={cn(
              "readout flex shrink-0 items-center gap-1 border-b-2 border-transparent px-2.5 py-2 transition-colors hover:text-foreground",
              tab === t.key && "border-leeloo text-leeloo",
            )}
          >
            {t.label}
            {!!t.badge && <span className={cn("rounded-full bg-muted px-1.5 text-[0.65rem]", t.urgent && "bg-taxi text-black")}>{t.badge}</span>}
          </button>
        ))}
      </div>

      <div className="space-y-4 p-4">
        {tab === "intent" && <IntentTab slug={slug} detail={detail} onDone={refresh} />}
        {tab === "reality" && <RealityTab slug={slug} detail={detail} onDone={refresh} />}
        {tab === "reviews" && <ReviewsTab slug={slug} detail={detail} onDone={refresh} />}
        {tab === "questions" && <QuestionsTab slug={slug} detail={detail} tree={tree} onDone={refresh} onSelect={onSelect} />}
        {tab === "links" && <LinksTab slug={slug} detail={detail} tree={tree} onDone={refresh} onSelect={onSelect} />}
        {tab === "history" && <HistoryTab detail={detail} />}
      </div>
    </div>
  );
}

function TitleEditor({ slug, node, onSaved }: { slug: string; node: NodeDetail["node"]; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(node.title);
  const [summary, setSummary] = useState(node.summary);
  const { run, busy, error } = useAct(slug, onSaved);
  useEffect(() => {
    setTitle(node.title);
    setSummary(node.summary);
    setEditing(false);
  }, [node.id, node.title, node.summary]);
  if (!editing)
    return (
      <button className="block w-full text-left" onClick={() => setEditing(true)} title="Edit title and summary">
        <h2 className="display text-lg font-bold text-leeloo">{node.title}</h2>
        {node.summary ? (
          <p className="text-sm text-muted-foreground">{node.summary}</p>
        ) : (
          <p className="text-xs text-muted-foreground/70">Add a summary…</p>
        )}
      </button>
    );
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run({ action: "update_node", node: node.id, title, summary })) setEditing(false);
      }}
    >
      <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      <Input value={summary} placeholder="One-line summary" onChange={(e) => setSummary(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={busy}>
          Save
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}

function StageControl({ slug, detail, onDone }: { slug: string; detail: NodeDetail; onDone: () => void }) {
  const { run, busy, error } = useAct(slug, onDone);
  const stage = detail.node.stage;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {STAGES.map((s) => (
          <button
            key={s}
            disabled={busy || s === stage}
            onClick={() => run({ action: "stage", node: detail.node.id, stage: s })}
            title={STAGE_HINT[s]}
            className={cn(
              "flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors hover:border-leeloo disabled:cursor-default",
              s === stage ? "border-leeloo bg-leeloo/10 text-leeloo" : "text-muted-foreground",
            )}
          >
            <StageGlyph stage={s} className="size-3" />
            {STAGE_LABEL[s]}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function RevisionMeta({ r }: { r: Revision }) {
  return (
    <div className="readout flex flex-wrap gap-x-3 normal-case">
      <span>{who(r.author)}</span>
      <span>{fmt(r.createdAt)}</span>
      {r.commitSha && <span>@ {r.commitSha.slice(0, 7)}</span>}
      {r.signedAt && (
        <span className="flex items-center gap-1 text-fifth">
          <ShieldCheck className="size-3.5" /> Signed {fmt(r.signedAt)}
        </span>
      )}
    </div>
  );
}

function IntentTab({ slug, detail, onDone }: { slug: string; detail: NodeDetail; onDone: () => void }) {
  const { intent, canonIntent, node } = detail;
  const draft = intent && !intent.signedAt ? intent : null;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const { run, busy, error } = useAct(slug, onDone);

  const startEdit = () => {
    setText(intent?.text ?? "");
    setNote("");
    setEditing(true);
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        What {node.title} should be. Only signed intent is canon; anything newer is a draft on top.
      </p>

      {draft && (
        <section className="space-y-2 rounded-lg border border-diva/50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="readout text-diva">Draft · not signed</span>
            <Button size="sm" disabled={busy} onClick={() => run({ action: "sign", node: node.id })}>
              <ShieldCheck /> Sign off
            </Button>
          </div>
          <RevisionMeta r={draft} />
          {draft.note && <p className="text-xs text-muted-foreground">Note: {draft.note}</p>}
          <Markdown>{draft.text}</Markdown>
        </section>
      )}

      {canonIntent ? (
        <section className="frame space-y-2 rounded-lg border p-3">
          <span className="readout text-fifth">Canon</span>
          <RevisionMeta r={canonIntent} />
          <Markdown>{canonIntent.text}</Markdown>
        </section>
      ) : (
        !draft && <p className="text-sm text-muted-foreground">No intent written yet.</p>
      )}

      {editing ? (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run({ action: "write_intent", node: node.id, text, note: note || null });
            if (r) setEditing(false);
          }}
        >
          <TextArea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="Markdown welcome." />
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed and why (optional)" />
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={busy || !text.trim()}>
              Save draft
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button size="sm" variant="outline" onClick={startEdit}>
          {intent ? "Write a new version" : "Write intent"}
        </Button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function RealityTab({ slug, detail, onDone }: { slug: string; detail: NodeDetail; onDone: () => void }) {
  const { reality, node } = detail;
  const [flagging, setFlagging] = useState(false);
  const [note, setNote] = useState("");
  const [gap, setGap] = useState("");
  const [opening, setOpening] = useState(false);
  const { run, busy, error } = useAct(slug, onDone);
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        What the game does today, written by agents from the code. If it&apos;s wrong, flag it and an agent re-surveys it.
      </p>
      {node.realityFlag && (
        <div className="flex gap-2 rounded-lg border border-destructive/50 p-3 text-sm">
          <Flag className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <div className="readout text-destructive">Flagged as wrong</div>
            {node.realityFlag}
          </div>
        </div>
      )}
      {reality ? (
        <section className="space-y-2 rounded-lg border p-3">
          <RevisionMeta r={reality} />
          <Markdown>{reality.text}</Markdown>
          {reality.evidence.length > 0 && (
            <details>
              <summary className="readout cursor-pointer">Evidence ({reality.evidence.length})</summary>
              <ul className="mt-1 space-y-0.5">
                {reality.evidence.map((e) => (
                  <li key={e} className="readout break-all normal-case text-foreground/80">
                    {e}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          Not surveyed. Nothing in the code has been described for this yet{node.stage === "idea" ? " (expected for an idea)" : ""}.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {reality && !flagging && (
          <Button size="sm" variant="outline" onClick={() => setFlagging(true)}>
            <Flag /> This is wrong
          </Button>
        )}
        {(reality || detail.canonIntent) && !opening && (
          <Button size="sm" variant="outline" onClick={() => setOpening(true)}>
            <GitCompareArrows /> Open a review
          </Button>
        )}
      </div>
      {flagging && (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run({ action: "flag", node: node.id, note })) {
              setFlagging(false);
              setNote("");
            }
          }}
        >
          <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's wrong with it?" />
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={busy || !note.trim()}>
              Flag
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setFlagging(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {opening && (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run({ action: "open_review", node: node.id, gap })) {
              setOpening(false);
              setGap("");
            }
          }}
        >
          <TextArea rows={3} value={gap} onChange={(e) => setGap(e.target.value)} placeholder="How does the build differ from the intent?" />
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={busy || !gap.trim()}>
              Open review
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setOpening(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ReviewsTab({ slug, detail, onDone }: { slug: string; detail: NodeDetail; onDone: () => void }) {
  const { run, busy, error } = useAct(slug, onDone);
  const [reason, setReason] = useState<Record<number, string>>({});
  const revText = (id: number | null) => detail.revisions.find((r) => r.id === id)?.text;
  if (!detail.reviews.length)
    return (
      <p className="text-sm text-muted-foreground">
        No reviews. One opens when a verify pass finds the build differs from the signed intent, or when you open one from Reality.
      </p>
    );
  return (
    <div className="space-y-3">
      {detail.reviews.map((r) => (
        <section key={r.id} className={cn("space-y-2 rounded-lg border p-3", r.status === "open" && "border-taxi/70")}>
          <div className="flex items-center gap-2">
            {r.status === "open" && <span className="hazard h-3 w-6 rounded-sm" />}
            <span className="readout">
              {r.status === "open" ? "Open" : DECISION_LABEL[r.decision!]} · {who(r.openedBy)} · {fmt(r.openedAt)}
            </span>
          </div>
          <p className="text-sm">{r.gap}</p>
          <details>
            <summary className="readout cursor-pointer">Intent vs reality at the time</summary>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <div className="rounded border p-2">
                <div className="readout mb-1">Intent</div>
                <Markdown>{revText(r.intentRev) ?? "_none_"}</Markdown>
              </div>
              <div className="rounded border p-2">
                <div className="readout mb-1">Reality</div>
                <Markdown>{revText(r.realityRev) ?? "_none_"}</Markdown>
              </div>
            </div>
          </details>
          {r.status === "open" ? (
            <div className="space-y-2">
              <Input
                placeholder="Why does it differ? (optional)"
                value={reason[r.id] ?? ""}
                onChange={(e) => setReason((s) => ({ ...s, [r.id]: e.target.value }))}
              />
              <div className="flex flex-wrap gap-2">
                {REVIEW_DECISIONS.map((d) => (
                  <Button
                    key={d}
                    size="sm"
                    variant={d === "fix_build" ? "default" : "outline"}
                    disabled={busy}
                    onClick={() => run({ action: "decide_review", review: r.id, decision: d, reason: reason[r.id] ?? "" })}
                  >
                    {DECISION_LABEL[d]}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            r.reason && <p className="text-xs text-muted-foreground">Why: {r.reason}</p>
          )}
        </section>
      ))}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function NodePicker({ tree, value, onChange, exclude }: { tree: TreeNode[]; value: string; onChange: (v: string) => void; exclude?: string }) {
  const options = tree
    .filter((n) => n.id !== exclude && n.stage !== "retired")
    .map((n) => ({ value: n.id, label: [pathLabel(tree, n), n.title].filter(Boolean).join(" › ") }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return <Select className="min-w-0 flex-1" value={value} onChange={onChange} options={[{ value: "", label: "Choose a node…" }, ...options]} />;
}

function QuestionsTab({
  slug,
  detail,
  tree,
  onDone,
  onSelect,
}: {
  slug: string;
  detail: NodeDetail;
  tree: TreeNode[];
  onDone: () => void;
  onSelect: (id: string) => void;
}) {
  const { run, busy, error } = useAct(slug, onDone);
  const [text, setText] = useState("");
  const [blocking, setBlocking] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const title = (id: string) => tree.find((n) => n.id === id)?.title ?? id;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Hardening: how does this fit, and what does it touch? Blocking questions must be resolved before approval.
      </p>
      {detail.questions.map((q) => (
        <section key={q.id} className={cn("space-y-2 rounded-lg border p-3", q.status === "open" && q.blocking && "border-taxi/70")}>
          <div className="readout flex flex-wrap gap-x-3 normal-case">
            <span className={q.status === "open" ? (q.blocking ? "text-taxi" : "text-foreground") : ""}>
              {q.status === "open" ? (q.blocking ? "Blocking" : "Open") : q.status}
            </span>
            <span>{who(q.raisedBy)}</span>
            <span>{fmt(q.createdAt)}</span>
          </div>
          <p className="text-sm">{q.text}</p>
          {q.related.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {q.related.map((id) => (
                <button key={id} onClick={() => onSelect(id)} className="rounded-full border px-2 py-0.5 text-xs hover:border-leeloo">
                  {title(id)}
                </button>
              ))}
            </div>
          )}
          {q.answer && <p className="text-sm text-muted-foreground">→ {q.answer}</p>}
          {q.status === "open" && (
            <div className="space-y-2">
              <TextArea
                rows={2}
                placeholder="Answer"
                value={answers[q.id] ?? ""}
                onChange={(e) => setAnswers((s) => ({ ...s, [q.id]: e.target.value }))}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busy || !(answers[q.id] ?? "").trim()}
                  onClick={() => run({ action: "resolve_question", question: q.id, outcome: "answered", answer: answers[q.id] })}
                >
                  Answer
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => run({ action: "resolve_question", question: q.id, outcome: "accepted", answer: answers[q.id] ?? "" })}
                >
                  Accept the risk
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => run({ action: "resolve_question", question: q.id, outcome: "dismissed", answer: answers[q.id] ?? "" })}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          )}
        </section>
      ))}
      <form
        className="space-y-2 rounded-lg border border-dashed p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run({ action: "ask", node: detail.node.id, text, blocking })) {
            setText("");
            setBlocking(false);
          }
        }}
      >
        <TextArea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Raise a question…" />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} /> Blocks approval
          </label>
          <Button size="sm" type="submit" disabled={busy || !text.trim()}>
            <CircleHelp /> Ask
          </Button>
        </div>
      </form>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function LinksTab({
  slug,
  detail,
  tree,
  onDone,
  onSelect,
}: {
  slug: string;
  detail: NodeDetail;
  tree: TreeNode[];
  onDone: () => void;
  onSelect: (id: string) => void;
}) {
  const { run, busy, error } = useAct(slug, onDone);
  const [type, setType] = useState<LinkType>("affects");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">The web across the tree: what this depends on, affects or conflicts with.</p>
      {detail.links.length === 0 && <p className="text-sm text-muted-foreground">No links yet.</p>}
      <ul className="space-y-1">
        {detail.links.map((l) => {
          const other = l.direction === "out" ? l.toId : l.fromId;
          return (
            <li key={`${l.id}-${l.direction}`} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50">
              <Link2 className="size-3.5 shrink-0 text-brass" />
              <span className="readout shrink-0 normal-case">{LINK_LABEL[l.type][l.direction === "out" ? 0 : 1]}</span>
              <button className="min-w-0 truncate text-sm hover:text-leeloo" onClick={() => onSelect(other)}>
                {l.otherTitle}
              </button>
              {l.note && <span className="min-w-0 truncate text-xs text-muted-foreground">· {l.note}</span>}
              <Button
                size="icon-xs"
                variant="ghost"
                className="ml-auto shrink-0"
                disabled={busy}
                title="Remove link"
                onClick={() => run({ action: "unlink", link: l.id })}
              >
                <Trash2 />
              </Button>
            </li>
          );
        })}
      </ul>
      <form
        className="space-y-2 rounded-lg border border-dashed p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run({ action: "link", from: detail.node.id, to, type, note: note || null })) {
            setTo("");
            setNote("");
          }
        }}
      >
        <div className="flex flex-wrap gap-2">
          <Select value={type} onChange={setType} options={LINK_TYPES.map((t) => ({ value: t, label: LINK_LABEL[t][0] }))} />
          <NodePicker tree={tree} value={to} onChange={setTo} exclude={detail.node.id} />
        </div>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="How? (optional)" />
        <Button size="sm" type="submit" disabled={busy || !to}>
          <Link2 /> Link
        </Button>
      </form>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <ExternalLinks slug={slug} detail={detail} onDone={onDone} />
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  created: "Created",
  edited: "Edited",
  intent_written: "Intent drafted",
  reality_written: "Reality surveyed",
  intent_signed: "Intent signed off",
  stage: "Stage changed",
  fidelity: "Fidelity checked",
  review_opened: "Review opened",
  review_decided: "Review decided",
  reality_flagged: "Reality flagged",
  question_raised: "Question raised",
  question_resolved: "Question resolved",
  linked: "Linked",
  unlinked: "Unlinked",
  source_added: "Link added",
  priority: "Priority changed",
  chase_added: "Chase set",
  chase_snoozed: "Chase snoozed",
  chase_closed: "Chase closed",
};

function eventDetail(e: DesignEvent): string {
  const d = e.detail as Record<string, string | null>;
  if (e.type === "stage") return `${STAGE_LABEL[d.from as Stage] ?? d.from} → ${STAGE_LABEL[d.to as Stage] ?? d.to}${d.note ? ` · ${d.note}` : ""}`;
  if (e.type === "fidelity") return `${d.from} → ${d.to}`;
  if (e.type === "priority") return `${PRIORITY_LABEL[d.from as Priority] ?? d.from} → ${PRIORITY_LABEL[d.to as Priority] ?? d.to}`;
  if (e.type === "chase_added" || e.type === "chase_snoozed") return dueText((e.detail.dueAt ?? e.detail.to) as number);
  if (e.type === "chase_closed") return d.outcome === "dropped" ? "Dropped" : "Done";
  if (e.type === "review_decided") return DECISION_LABEL[d.decision as keyof typeof DECISION_LABEL] ?? "";
  if (e.type === "reality_flagged") return d.note ?? "";
  return "";
}

function HistoryTab({ detail }: { detail: NodeDetail }) {
  return (
    <div className="space-y-4">
      <ol className="space-y-1.5">
        {detail.events.map((e) => (
          <li key={e.id} className="text-sm">
            <span className="readout mr-2 normal-case">{fmt(e.at)}</span>
            <span className="font-medium">{EVENT_LABEL[e.type] ?? e.type}</span>
            <span className="text-muted-foreground"> · {who(e.actor)}</span>
            {eventDetail(e) && <span className="text-muted-foreground"> · {eventDetail(e)}</span>}
          </li>
        ))}
      </ol>
      {detail.revisions.length > 0 && (
        <details>
          <summary className="readout cursor-pointer">All revisions ({detail.revisions.length})</summary>
          <div className="mt-2 space-y-2">
            {detail.revisions.map((r) => (
              <section key={r.id} className="space-y-1 rounded border p-2">
                <div className="readout">
                  #{r.id} · {r.field}
                </div>
                <RevisionMeta r={r} />
                {r.note && <p className="text-xs text-muted-foreground">Note: {r.note}</p>}
                <Markdown>{r.text}</Markdown>
              </section>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ---------- page ----------

export function DesignBible({ slug }: { slug: string }) {
  const { data, error, reload, lastEvent } = useDesign(slug);
  const wide = useMinWidth(1024);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"tree" | "flow">("tree");
  const [gap, setGap] = useState<GapKey | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const [addingRoot, setAddingRoot] = useState(false);
  const [startTab, setStartTab] = useState<Tab | undefined>(undefined);

  // Keep the selected node in the URL (?node=) so links and reloads land on it.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get("node");
    if (id) setSelected(id);
    const t = q.get("tab");
    if (t) setStartTab(t as Tab);
  }, []);
  const select = useCallback((id: string | null) => {
    setSelected(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("node", id);
    else url.searchParams.delete("node");
    window.history.replaceState(null, "", url);
  }, []);

  if (error && !data) return <p className="text-sm text-destructive">Couldn&apos;t load the design: {error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const tree = data.tree;
  const gapDef = GAPS.find((g) => g.key === gap);
  const filtered = gapDef ? tree.filter((n) => n.stage !== "retired" && gapDef.test(n)) : null;

  const panel = selected && (
    <NodeLinks.Provider value={{ tree, onSelect: (nid: string) => (setStartTab(undefined), select(nid)) }}>
    <NodePanel
      key={`${selected}:${startTab ?? ""}`}
      slug={slug}
      id={selected}
      tree={tree}
      lastEvent={lastEvent}
      onSelect={(nid) => (setStartTab(undefined), select(nid))}
      onReload={reload}
      initialTab={startTab}
    />
    </NodeLinks.Provider>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <div className="min-w-0 space-y-4">
        <GapsStrip tree={tree} active={gap} onPick={setGap} />
        <StartDiscussion project={slug} />
        <section className="space-y-2">
          <SectionTitle>
            Open design questions <span className="text-foreground">{data.questions.length}</span>
          </SectionTitle>
          <QuestionCards items={data.questions} slugs={{ [data.project]: slug }} onOpen={(nid) => (setStartTab("questions"), select(nid))} />
        </section>
        <h2 className="readout pt-2">Explore the design</h2>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border p-0.5">
            {(["tree", "flow"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn("readout rounded-md px-3 py-1", view === v && !filtered && "bg-muted text-leeloo")}
              >
                {v === "tree" ? "Tree" : "Flow"}
              </button>
            ))}
          </div>
          <label className="readout flex items-center gap-1.5 normal-case">
            <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} /> Retired
          </label>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => setAddingRoot(true)}>
            <Plus /> New idea
          </Button>
        </div>

        {addingRoot && <AddNodeForm slug={slug} parent={null} onDone={() => setAddingRoot(false)} onCreated={(id) => (reload(), select(id))} />}

        <div className="frame rounded-lg border bg-card/40 p-2">
          {tree.length === 0 ? (
            <EmptyState />
          ) : filtered ? (
            <div>
              <div className="readout flex items-center justify-between px-1 pb-1">
                {gapDef?.label}
                <button className="hover:text-leeloo" onClick={() => setGap(null)}>
                  Clear
                </button>
              </div>
              {filtered.map((n) => (
                <NodeRowButton key={n.id} n={n} selected={selected === n.id} onSelect={select} path={pathLabel(tree, n)} />
              ))}
            </div>
          ) : view === "tree" ? (
            <TreeView tree={tree} selected={selected} onSelect={select} showRetired={showRetired} />
          ) : (
            <FlowView tree={tree} selected={selected} onSelect={select} showRetired={showRetired} />
          )}
        </div>

        <Legend />
        <Collapsed title="Follow-ups" count={data.chases.length}>
          <ChaseList items={data.chases} slug={slug} onSelect={select} onChanged={reload} />
        </Collapsed>
      </div>

      {wide ? (
        <div className="frame sticky top-20 max-h-[calc(100vh-6rem)] min-w-0 self-start overflow-y-auto rounded-lg border bg-card/60">
          {panel || <p className="p-6 text-sm text-muted-foreground">Pick a node to see its intent, reality, reviews and links.</p>}
        </div>
      ) : (
        <Sheet open={!!selected} onOpenChange={(o) => !o && select(null)}>
          <SheetContent className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
            <SheetHeader className="sr-only">
              <SheetTitle>Design node</SheetTitle>
              <SheetDescription>Intent, reality, reviews, questions and links</SheetDescription>
            </SheetHeader>
            <div className="pt-8">{panel}</div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="space-y-2 p-4 text-sm text-muted-foreground">
      <p className="flex items-center gap-2 text-foreground">
        <AlertTriangle className="size-4 text-taxi" /> The bible is empty.
      </p>
      <p>
        The ground layer comes from the code: ask a Claude session to run the <span className="readout normal-case">design-survey</span>{" "}
        skill (e.g. &quot;survey the weapons system&quot;). It writes what the game does today, with evidence.
      </p>
      <p>Or start in the sky: add an idea with “New idea”.</p>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {(["idea", "proposed", "approved", "in_build", "built"] as Stage[]).map((s) => (
        <span key={s} title={STAGE_HINT[s]}>
          <StageBadge stage={s} />
        </span>
      ))}
    </div>
  );
}

// ---------- priority, chases, external links ----------

const URGENCY_TEXT = {
  overdue: "text-destructive",
  today: "text-taxi",
  soon: "text-foreground",
  later: "text-muted-foreground",
} as const;

/** "Overdue · Sat 1 Nov", "Today 09:00", "Tue 4 Nov". */
function dueText(dueAt: number): string {
  const u = chaseUrgency(dueAt);
  const d = new Date(dueAt);
  if (u === "today") return `Today ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  const day = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return u === "overdue" ? `Overdue · ${day}` : day;
}

/** 09:00 local time, `days` days from today. */
function at9(days: number): number {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

/** yyyy-mm-dd for a date input, `days` from today. */
function dateInput(days: number): string {
  const d = new Date(at9(days));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function PriorityControl({ slug, node, onDone }: { slug: string; node: NodeDetail["node"]; onDone: () => void }) {
  const { run, busy, error } = useAct(slug, onDone);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        <span className="readout mr-1">Priority</span>
        {PRIORITIES.map((p) => (
          <button
            key={p}
            disabled={busy || p === node.priority}
            onClick={() => run({ action: "priority", node: node.id, priority: p })}
            className={cn(
              "flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors hover:border-leeloo disabled:cursor-default",
              p === node.priority
                ? p === "urgent"
                  ? "border-fire bg-fire/15 text-fire"
                  : p === "high"
                    ? "border-taxi bg-taxi/15 text-taxi"
                    : "border-leeloo bg-leeloo/10 text-leeloo"
                : "text-muted-foreground",
            )}
          >
            {p === "urgent" && <Flame className="size-3" />}
            {p === "high" && <ChevronsUp className="size-3" />}
            {PRIORITY_LABEL[p]}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** One open chase with quick actions: done, tomorrow, next week, drop. */
function ChaseRow({
  c,
  slug,
  onChanged,
  context,
}: {
  c: { id: number; text: string; waitingOn: WaitingOn; dueAt: number; snoozes: number };
  slug: string;
  onChanged: () => void;
  /** Shown above the text, e.g. the node and project, in lists across nodes. */
  context?: React.ReactNode;
}) {
  const { run, busy, error } = useAct(slug, onChanged);
  const u = chaseUrgency(c.dueAt);
  return (
    <li className={cn("space-y-1.5 rounded-lg border p-2.5", u === "overdue" && "border-destructive/60", u === "today" && "border-taxi/60")}>
      {context}
      <div className="flex items-start gap-2">
        <AlarmClock className={cn("mt-0.5 size-4 shrink-0", URGENCY_TEXT[u])} />
        <div className="min-w-0 flex-1">
          <p className="text-sm">{c.text}</p>
          <p className="readout flex flex-wrap gap-x-3 normal-case">
            <span className={URGENCY_TEXT[u]}>{dueText(c.dueAt)}</span>
            <span>Waiting on: {WAITING_LABEL[c.waitingOn] ?? c.waitingOn}</span>
            {c.snoozes > 0 && <span>Snoozed {c.snoozes}×</span>}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 pl-6">
        <Button size="xs" disabled={busy} onClick={() => run({ action: "close_chase", chase: c.id, outcome: "done" })}>
          <Check /> Done
        </Button>
        <Button size="xs" variant="outline" disabled={busy} onClick={() => run({ action: "snooze_chase", chase: c.id, due: at9(1) })}>
          Tomorrow
        </Button>
        <Button size="xs" variant="outline" disabled={busy} onClick={() => run({ action: "snooze_chase", chase: c.id, due: at9(7) })}>
          Next week
        </Button>
        <Button size="xs" variant="ghost" disabled={busy} onClick={() => run({ action: "close_chase", chase: c.id, outcome: "dropped" })}>
          Drop
        </Button>
      </div>
      {error && <p className="pl-6 text-xs text-destructive">{error}</p>}
    </li>
  );
}

function sortChases<T extends { dueAt: number; priority?: Priority }>(items: T[]): T[] {
  const dueNow = (x: T) => (["overdue", "today"].includes(chaseUrgency(x.dueAt)) ? 0 : 1);
  return [...items].sort(
    (a, b) =>
      dueNow(a) - dueNow(b) || PRIORITY_RANK[b.priority ?? "normal"] - PRIORITY_RANK[a.priority ?? "normal"] || a.dueAt - b.dueAt,
  );
}

/** Open chases for a project (or every project), due and important first. */
export function ChaseList({
  items,
  slug,
  onSelect,
  onChanged,
  showProject = false,
}: {
  items: (ChaseListItem & { slug?: string })[];
  slug?: string;
  onSelect?: (nodeId: string) => void;
  onChanged: () => void;
  showProject?: boolean;
}) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const sorted = sortChases(items);
  const due = sorted.filter((c) => ["overdue", "today"].includes(chaseUrgency(c.dueAt))).length;
  const shown = all ? sorted : sorted.slice(0, 4);
  return (
    <section className="space-y-2">
      <h3 className="readout flex items-center gap-2">
        <AlarmClock className="size-3.5" /> Chases <span className="text-foreground">{items.length}</span>
        {due > 0 && <span className="text-taxi">· {due} due</span>}
      </h3>
      <ul className="space-y-2">
        {shown.map((c) => {
          const s = c.slug ?? slug ?? "";
          const title = (
            <span className="flex items-center gap-1.5">
              {c.priority === "urgent" && <Flame className="size-3 text-fire" />}
              {c.priority === "high" && <ChevronsUp className="size-3 text-taxi" />}
              {showProject && <span>{c.project} ›</span>}
              <span className="truncate text-foreground">{c.nodeTitle}</span>
            </span>
          );
          return (
            <ChaseRow
              key={c.id}
              c={c}
              slug={s}
              onChanged={onChanged}
              context={
                <div className="readout normal-case">
                  {onSelect ? (
                    <button className="hover:text-leeloo" onClick={() => onSelect(c.nodeId)}>
                      {title}
                    </button>
                  ) : (
                    <a className="hover:text-leeloo" href={`/design/${s}?node=${c.nodeId}`}>
                      {title}
                    </a>
                  )}
                </div>
              }
            />
          );
        })}
      </ul>
      {sorted.length > 4 && (
        <button className="readout hover:text-leeloo" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${sorted.length}`}
        </button>
      )}
    </section>
  );
}

/** Cross-project chase list for server pages (refreshes the route after an action). */
export function ChaseBoard({ items }: { items: (ChaseListItem & { slug: string })[] }) {
  const router = useRouter();
  if (!items.length) return <p className="text-sm text-muted-foreground">No open chases.</p>;
  return <ChaseList items={items} onChanged={() => router.refresh()} showProject />;
}

/** The node's chases: open ones with quick actions, a form to add one, and closed history. */
function ChasesBlock({ slug, detail, onDone }: { slug: string; detail: NodeDetail; onDone: () => void }) {
  const open = sortChases(detail.chases.filter((c) => c.status === "open"));
  const closed = detail.chases.filter((c) => c.status !== "open");
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [due, setDue] = useState(() => dateInput(1));
  const [waitingOn, setWaitingOn] = useState<WaitingOn>("you");
  const { run, busy, error } = useAct(slug, onDone);
  return (
    <div className="space-y-2">
      {open.length > 0 && (
        <ul className="space-y-2">
          {open.map((c) => (
            <ChaseRow key={c.id} c={c} slug={slug} onChanged={onDone} />
          ))}
        </ul>
      )}
      {adding ? (
        <form
          className="space-y-2 rounded-lg border border-dashed p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run({ action: "chase", node: detail.node.id, text, due, waiting_on: waitingOn })) {
              setText("");
              setAdding(false);
            }
          }}
        >
          <div className="readout">New chase</div>
          <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="What needs to happen?" />
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="h-8 rounded-lg border border-input bg-background px-2 text-sm dark:bg-input/30"
            />
            <Select value={waitingOn} onChange={setWaitingOn} options={WAITING_ON.map((w) => ({ value: w, label: WAITING_LABEL[w] }))} />
          </div>
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={busy || !text.trim() || !due}>
              <AlarmClock /> Set chase
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </form>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <AlarmClock /> Add a chase
        </Button>
      )}
      {closed.length > 0 && (
        <details>
          <summary className="readout cursor-pointer">Closed chases ({closed.length})</summary>
          <ul className="mt-1 space-y-1">
            {closed.map((c) => (
              <li key={c.id} className="text-xs text-muted-foreground">
                {c.status === "done" ? "✓" : "✕"} {c.text}
                {c.note && ` · ${c.note}`} · {fmt(c.closedAt ?? c.createdAt)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Links out of Mondo: PRs, docs, pages, settings. */
function ExternalLinks({ slug, detail, onDone }: { slug: string; detail: NodeDetail; onDone: () => void }) {
  const { run, busy, error } = useAct(slug, onDone);
  const [ref, setRef] = useState("");
  const [title, setTitle] = useState("");
  return (
    <section className="space-y-2 border-t pt-3">
      <h4 className="readout">External links</h4>
      {detail.sources.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
      <ul className="space-y-1">
        {detail.sources.map((s) => (
          <li key={s.id} className="flex min-w-0 items-center gap-2 text-sm">
            <ExternalLink className="size-3.5 shrink-0 text-brass" />
            {/^https?:\/\//.test(s.ref) ? (
              <a href={s.ref} target="_blank" rel="noreferrer" className="min-w-0 truncate text-diva hover:underline">
                {s.title || s.ref}
              </a>
            ) : (
              <span className="min-w-0 truncate">{s.title ? `${s.title} · ${s.ref}` : s.ref}</span>
            )}
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run({ action: "source", node: detail.node.id, ref, title: title || null })) {
            setRef("");
            setTitle("");
          }
        }}
      >
        <Input className="min-w-0 flex-1" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="https://… or a file path" />
        <Input className="min-w-0 flex-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" />
        <Button size="sm" type="submit" disabled={busy || !ref.trim()}>
          <Plus /> Add link
        </Button>
      </form>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  );
}
