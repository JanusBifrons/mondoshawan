"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, ExternalLink, Search } from "lucide-react";
import { OriginIcon, since } from "@/components/knowledge-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { KnowledgeSource } from "@/lib/knowledge";
import { cn } from "@/lib/utils";

// Active filter chip: lit orange.
const CHIP_ON = "bg-leeloo/15 text-leeloo hover:bg-leeloo/20 hover:text-leeloo";

// Kept in sync with CATEGORY_ORDER in lib/knowledge.ts (that module is server-only).
const CATEGORY_ORDER = [
  "Design", "Plans", "Architecture", "Features", "Handoffs", "Bugs & feedback",
  "Guides", "Ops & perf", "Agent skills", "Other",
];

function countBy<T>(items: T[], key: (t: T) => string) {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
  return m;
}

function FilterChips({
  label,
  counts,
  value,
  onChange,
  order,
}: {
  label: string;
  counts: Map<string, number>;
  value: string | null;
  onChange: (v: string | null) => void;
  order?: string[];
}) {
  const keys = [...counts.keys()].sort((a, b) =>
    order ? (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) : a.localeCompare(b),
  );
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="readout mr-1 w-16">{label}</span>
      <Button size="sm" variant="ghost" className={cn("h-7 rounded-sm", value === null && CHIP_ON)} onClick={() => onChange(null)}>
        All <span className="text-muted-foreground">{total}</span>
      </Button>
      {keys.map((k) => (
        <Button
          key={k}
          size="sm"
          variant="ghost"
          className={cn("h-7 rounded-sm", value === k && CHIP_ON)}
          onClick={() => onChange(value === k ? null : k)}
        >
          {k} <span className="text-muted-foreground">{counts.get(k)}</span>
        </Button>
      ))}
    </div>
  );
}

export function KnowledgeBrowser({ sources, showProject = false }: { sources: KnowledgeSource[]; showProject?: boolean }) {
  const [query, setQuery] = useState("");
  const [project, setProject] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const [selected, setSelected] = useState<KnowledgeSource | null>(null);

  const q = query.trim().toLowerCase();
  const matchesQuery = (s: KnowledgeSource) =>
    !q || [s.title, s.summary, s.relPath, s.category, s.project].some((f) => f?.toLowerCase().includes(q));

  // Each chip row counts what the *other* filters leave, so numbers always add up.
  const base = sources.filter(matchesQuery);
  const byProject = base.filter((s) => (!category || s.category === category) && (!origin || s.originLabel === origin));
  const byCategory = base.filter((s) => (!project || s.project === project) && (!origin || s.originLabel === origin));
  const byOrigin = base.filter((s) => (!project || s.project === project) && (!category || s.category === category));

  const visible = useMemo(
    () =>
      base
        .filter((s) => (!project || s.project === project) && (!category || s.category === category) && (!origin || s.originLabel === origin))
        .sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? "")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sources, q, project, category, origin],
  );

  // Read it here when Mondo has the text; otherwise open the original (e.g. in Drive).
  const open = (s: KnowledgeSource) => {
    if (s.hasContent) setSelected(s);
    else if (s.url) window.open(s.url, "_blank", "noopener");
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="relative max-w-md">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search titles, summaries, paths…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {showProject && (
          <FilterChips label="Project" counts={countBy(byProject, (s) => s.project)} value={project} onChange={setProject} />
        )}
        <FilterChips label="Source" counts={countBy(byOrigin, (s) => s.originLabel)} value={origin} onChange={setOrigin} />
        <FilterChips
          label="Category"
          counts={countBy(byCategory, (s) => s.category)}
          value={category}
          onChange={setCategory}
          order={CATEGORY_ORDER}
        />
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="readout pl-4">Title</TableHead>
              {showProject && <TableHead className="readout">Project</TableHead>}
              <TableHead className="readout">Category</TableHead>
              <TableHead className="readout">Source</TableHead>
              <TableHead className="readout pr-4 text-right">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  Nothing matches.
                </TableCell>
              </TableRow>
            )}
            {visible.map((s) => (
              <TableRow key={`${s.projectSlug}/${s.id}`} className="group/row cursor-pointer" onClick={() => open(s)}>
                <TableCell className="max-w-0 w-full pl-4 whitespace-normal">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold group-hover/row:text-leeloo">{s.title}</span>
                    {s.url && !s.hasContent && <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />}
                    {s.flags.map((f) => (
                      <Badge key={f} variant="outline" className="shrink-0 text-[10px] uppercase text-muted-foreground">
                        {f}
                      </Badge>
                    ))}
                  </div>
                  {s.summary && <p className="truncate text-xs text-muted-foreground">{s.summary}</p>}
                </TableCell>
                {showProject && <TableCell className="text-muted-foreground">{s.project}</TableCell>}
                <TableCell>
                  <Badge variant="outline" className="rounded-sm border-brass/40 text-brass">{s.category}</Badge>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <OriginIcon origin={s.origin} />
                    {s.originLabel}
                  </span>
                </TableCell>
                <TableCell className="pr-4 text-right font-mono text-xs whitespace-nowrap text-muted-foreground" title={s.modified ?? ""}>
                  {since(s.modified)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <p className="text-xs text-muted-foreground">
        {visible.length} of {sources.length} sources
      </p>

      <DocSheet source={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function DocSheet({ source, onClose }: { source: KnowledgeSource | null; onClose: () => void }) {
  const [doc, setDoc] = useState<{ content: string; absPath: string | null } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setDoc(null);
    setError(false);
    if (!source) return;
    let cancelled = false;
    fetch(`/api/knowledge/${source.projectSlug}/doc?id=${encodeURIComponent(source.id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => !cancelled && setDoc(d))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [source]);

  return (
    <Sheet open={!!source} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        {source && (
          <>
            <SheetHeader className="border-b">
              <SheetTitle className="display pr-8 text-base text-leeloo">{source.title}</SheetTitle>
              <SheetDescription asChild>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="secondary">{source.category}</Badge>
                  <span className="flex items-center gap-1">
                    <OriginIcon origin={source.origin} /> {source.project} · {source.originLabel}
                  </span>
                  <span>· updated {since(source.modified)}</span>
                  {source.words != null && <span>· {source.words.toLocaleString()} words</span>}
                </div>
              </SheetDescription>
              {doc?.absPath && (
                <div className="flex items-center gap-2">
                  <code className="truncate rounded bg-muted px-1.5 py-0.5 text-xs">{doc.absPath}</code>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0"
                    title="Copy path"
                    onClick={() => navigator.clipboard?.writeText(doc.absPath ?? "")}
                  >
                    <Copy />
                  </Button>
                </div>
              )}
              {source.url && (
                <div>
                  <Button asChild size="sm" variant="outline">
                    <a href={source.url} target="_blank" rel="noreferrer">
                      <ExternalLink /> Open in {source.originLabel}
                    </a>
                  </Button>
                </div>
              )}
            </SheetHeader>
            <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4">
              {error && <p className="text-sm text-destructive">Couldn&apos;t load this document.</p>}
              {!doc && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
              {doc && (
                <article className="prose prose-sm max-w-none break-words dark:prose-invert prose-headings:font-[family-name:var(--ff-display)] prose-headings:uppercase prose-headings:tracking-wider prose-headings:text-leeloo prose-a:text-diva prose-strong:text-foreground prose-code:text-taxi prose-pre:overflow-x-auto prose-table:block prose-table:overflow-x-auto">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ href, children }) =>
                        href && /^https?:\/\//.test(href) ? (
                          <a href={href} target="_blank" rel="noreferrer">
                            {children}
                          </a>
                        ) : (
                          <span className="underline decoration-dotted">{children}</span>
                        ),
                      img: () => null,
                    }}
                  >
                    {doc.content}
                  </ReactMarkdown>
                </article>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
