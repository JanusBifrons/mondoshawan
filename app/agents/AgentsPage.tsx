"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Loader2, Plus, X } from "lucide-react";
import {
  AgentStatusBadge,
  EDGE,
  FIELD,
  Origin,
  StatusTiles,
  ago,
  folderName,
  useFleet,
  useNow,
  type FleetItem,
} from "@/components/agent-ui";
import { MondoMark } from "@/components/elements";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Place {
  slug: string;
  name: string;
  path: string;
  exists: boolean;
  trusted: boolean;
  worktrees: { path: string; branch: string | null; trusted: boolean }[];
}

const isNeedsYou = (i: FleetItem) => i.live && (i.shown === "waiting" || i.shown === "needs_permission" || i.shown === "failed");

/**
 * Mondo's home: every Claude session on the PC (Mondo's agents and yours), with what
 * needs you first. Tap one for its details and actions.
 */
export default function AgentsPage() {
  const { items, skew } = useFleet();
  const now = useNow(skew);
  const [creating, setCreating] = useState(false);
  const [showEnded, setShowEnded] = useState(false);

  const all = items ?? [];
  const needs = all.filter(isNeedsYou);
  const running = all.filter((i) => i.live && !isNeedsYou(i));
  const ended = all.filter((i) => !i.live);

  useEffect(() => {
    document.title = needs.length ? `(${needs.length}) Mondo` : "Mondo";
  }, [needs.length]);

  return (
    <>
      <PageHeader title="Agents" kicker="Command">
        {needs.length > 0 && (
          <span className="flex items-center gap-2 rounded-sm bg-taxi px-2 py-1 text-xs font-bold uppercase tracking-wider text-black">
            <span className="hazard h-3 w-3 rounded-[2px]" />
            {needs.length} need{needs.length === 1 ? "s" : ""} you
          </span>
        )}
        {!creating && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> New
          </Button>
        )}
      </PageHeader>

      <div className="mx-auto w-full max-w-3xl space-y-5 p-4 md:p-6">
        {creating && <NewAgentForm onClose={() => setCreating(false)} />}

        {items && <StatusTiles items={all} />}

        {items && all.filter((i) => i.live).length === 0 && !creating && (
          <Card className="items-center gap-3 px-6 py-10 text-center">
            <MondoMark className="size-16 opacity-80" />
            <p className="display text-sm font-bold text-leeloo">All quiet in the city</p>
            <p className="max-w-md text-sm text-muted-foreground">
              No Claude sessions are running. Start one here, or run <code>claude</code> in a terminal and it shows up
              within a second.
            </p>
            <Button onClick={() => setCreating(true)}>
              <Plus /> New agent
            </Button>
          </Card>
        )}

        {needs.length > 0 && (
          <section className="space-y-2">
            <h2 className="readout text-taxi">Needs you ({needs.length})</h2>
            {needs.map((i) => (
              <Row key={i.sessionId} item={i} now={now} />
            ))}
          </section>
        )}

        {running.length > 0 && (
          <section className="space-y-2">
            <h2 className="readout">Running ({running.length})</h2>
            {running.map((i) => (
              <Row key={i.sessionId} item={i} now={now} />
            ))}
          </section>
        )}

        {ended.length > 0 && (
          <section className="space-y-2">
            <button
              type="button"
              className="readout flex items-center gap-1 hover:text-leeloo"
              onClick={() => setShowEnded((v) => !v)}
            >
              <ChevronDown className={cn("size-3.5 transition-transform", !showEnded && "-rotate-90")} />
              Ended, last 7 days ({ended.length})
            </button>
            {showEnded && (
              <div className="space-y-2 opacity-75">
                {ended.map((i) => (
                  <Row key={i.sessionId} item={i} now={now} />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </>
  );
}

/** One session. Tapping it opens the drill-down; if it needs you, "Open in Claude" is right there. */
function Row({ item: i, now }: { item: FleetItem; now: number }) {
  const where = [i.project ?? "Unregistered folder", i.worktree || folderName(i.cwd), i.branch].filter(Boolean).join(" · ");
  return (
    <Card size="sm" className={cn("gap-2 px-4 transition-colors hover:bg-accent/40", EDGE[i.shown])}>
      <Link href={`/agents/${encodeURIComponent(i.sessionId)}`} className="flex items-center gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold">{i.name}</span>
            <AgentStatusBadge shown={i.shown} />
            <Origin item={i} />
          </div>
          <div className="readout truncate normal-case">
            {where} · {ago(now - i.lastActivity)}
          </div>
          {i.lastMessage && <p className="line-clamp-2 text-xs text-muted-foreground">{i.lastMessage}</p>}
        </div>
        <ChevronRight className="size-4 shrink-0 text-brass" />
      </Link>
      {isNeedsYou(i) && i.remoteUrl && (
        <Button asChild size="sm" className="w-fit">
          <a href={i.remoteUrl} target="_blank" rel="noreferrer">
            <ExternalLink /> Open in Claude
          </a>
        </Button>
      )}
    </Card>
  );
}

const MODE_HELP: Record<string, string> = {
  auto: "Auto: Claude decides what's safe; anything else asks you in the Claude app",
  acceptEdits: "Accept edits: file edits allowed; commands ask you in the Claude app",
  plan: "Plan: reads and plans only, no changes",
  manual: "Manual: everything asks you in the Claude app",
};

function NewAgentForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [project, setProject] = useState("");
  const [where, setWhere] = useState<string>("new"); // "new" | "root" | worktree path
  const [model, setModel] = useState("");
  const [mode, setMode] = useState("auto");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/agents/places")
      .then((r) => r.json())
      .then((d: { projects: Place[] }) => {
        setPlaces(d.projects);
        setProject((p) => p || d.projects.find((x) => x.exists && x.trusted)?.slug || d.projects.find((x) => x.exists)?.slug || "");
      })
      .catch(() => setError("Couldn't load projects"));
  }, []);

  const current = places?.find((p) => p.slug === project);
  const worktrees = useMemo(
    () => (current?.worktrees ?? []).filter((w) => w.path.replace(/\/$/, "").toLowerCase() !== current?.path.toLowerCase()),
    [current],
  );
  const chosenTrusted =
    where === "new" || where === "root" ? current?.trusted : worktrees.find((w) => w.path === where)?.trusted;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project,
          cwd: where === "root" || where === "new" ? current?.path : where,
          newWorktree: where === "new",
          model,
          permissionMode: mode,
          prompt,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      router.push(`/agents/${encodeURIComponent(d.sessionId)}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Card className="gap-4 px-4">
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="display text-sm font-bold text-leeloo">New agent</h2>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>

        {!places ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading projects…
          </div>
        ) : (
          <>
            <label className="block space-y-1.5">
              <span className="readout">Project</span>
              <select className={FIELD} value={project} onChange={(e) => (setProject(e.target.value), setWhere("new"))}>
                {places.map((p) => (
                  <option key={p.slug} value={p.slug} disabled={!p.exists}>
                    {p.name}
                    {!p.exists ? " (missing)" : !p.trusted ? " (not trusted yet)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="readout">Where</span>
              <select className={FIELD} value={where} onChange={(e) => setWhere(e.target.value)}>
                <option value="new">New worktree and branch (recommended)</option>
                <option value="root">Main checkout ({current ? folderName(current.path) : ""})</option>
                {worktrees.map((w) => (
                  <option key={w.path} value={w.path}>
                    Worktree: {folderName(w.path)}
                    {w.branch ? ` [${w.branch}]` : ""}
                    {!w.trusted ? " (not trusted yet)" : ""}
                  </option>
                ))}
              </select>
              {where === "new" && (
                <span className="block text-xs text-muted-foreground">
                  The agent makes its own worktree and branch, then opens a pull request into main when done.
                </span>
              )}
            </label>

            {current && !chosenTrusted && (
              <p className="rounded-md border border-taxi/40 bg-taxi/10 px-3 py-2 text-sm text-taxi">
                Claude hasn&apos;t been told to trust this folder yet, so the agent would get stuck on that question in
                its window. Next time you&apos;re at the PC, open <b>Settings → Folder trust</b> there and click the
                button: it opens the question for every project at once.
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1.5">
                <span className="readout">Model</span>
                <select className={FIELD} value={model} onChange={(e) => setModel(e.target.value)}>
                  <option value="">Default</option>
                  <option value="opus">Opus</option>
                  <option value="sonnet">Sonnet</option>
                  <option value="haiku">Haiku</option>
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="readout">Permissions</span>
                <select className={FIELD} value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="auto">Auto</option>
                  <option value="acceptEdits">Accept edits</option>
                  <option value="plan">Plan only</option>
                  <option value="manual">Ask for everything</option>
                </select>
              </label>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">{MODE_HELP[mode]}</p>

            <label className="block space-y-1.5">
              <span className="readout">First message (optional)</span>
              <textarea
                className={cn(FIELD, "min-h-24 resize-y")}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Say hello world"
              />
            </label>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={busy || !project || !chosenTrusted}>
              {busy ? <Loader2 className="animate-spin" /> : <Plus />} Start agent
            </Button>
          </>
        )}
      </form>
    </Card>
  );
}
