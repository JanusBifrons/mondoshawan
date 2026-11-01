"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ExternalLink, Loader2, Plus, X } from "lucide-react";
import { AgentStatusBadge, EDGE, FIELD, ago, folderName, isLive, shownForSession, shownStatus, useAgents, useNow } from "@/components/agent-ui";
import { MondoMark } from "@/components/elements";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AgentView, OtherSessionView } from "@/lib/agent-views";
import { cn } from "@/lib/utils";

interface Place {
  slug: string;
  name: string;
  path: string;
  exists: boolean;
  trusted: boolean;
  worktrees: { path: string; branch: string | null; trusted: boolean }[];
}

export default function AgentsPage() {
  const { agents, others, skew } = useAgents();
  const now = useNow(skew);
  const [creating, setCreating] = useState(false);

  // Everything running on the PC, newest activity first: Mondo's agents and your own sessions.
  const live = [
    ...(agents ?? []).filter(isLive).map((a) => ({ kind: "agent" as const, a, at: Math.max(a.lastActivity, a.session?.lastActivity ?? 0) })),
    ...others.map((o) => ({ kind: "other" as const, o, at: o.lastActivity })),
  ].sort((x, y) => y.at - x.at);
  const done = (agents ?? []).filter((a) => !isLive(a));

  return (
    <>
      <PageHeader title="Agents" kicker="Command">
        {!creating && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> New agent
          </Button>
        )}
      </PageHeader>

      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
        {creating && <NewAgentForm onClose={() => setCreating(false)} />}

        {agents && agents.length === 0 && others.length === 0 && !creating && (
          <Card className="items-center gap-3 px-6 py-12 text-center">
            <MondoMark className="size-16 opacity-80" />
            <p className="display text-sm font-bold text-leeloo">No agents yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Start a Claude Code agent in one of your projects. It opens in its own Git Bash window on the PC, and you
              chat with it in the Claude app under Remote Control.
            </p>
            <Button onClick={() => setCreating(true)}>
              <Plus /> New agent
            </Button>
          </Card>
        )}

        {live.length > 0 && (
          <section className="space-y-2">
            <h2 className="readout">Running ({live.length})</h2>
            {live.map((x) =>
              x.kind === "agent" ? (
                <AgentRow key={x.a.id} agent={x.a} now={now} />
              ) : (
                <OtherRow key={x.o.sessionId} s={x.o} now={now} />
              ),
            )}
          </section>
        )}

        {done.length > 0 && (
          <section className="space-y-2 opacity-80">
            <h2 className="readout">Stopped ({done.length})</h2>
            {done.map((a) => (
              <AgentRow key={a.id} agent={a} now={now} />
            ))}
          </section>
        )}
      </div>
    </>
  );
}

function AgentRow({ agent: a, now }: { agent: AgentView; now: number }) {
  const shown = shownStatus(a);
  const where = a.session?.worktree || a.worktreeName || folderName(a.cwd);
  return (
    <Link href={`/agents/${a.id}`} className="block">
      <Card size="sm" className={cn("flex-row items-center gap-3 px-4 transition-colors hover:bg-accent/40", EDGE[shown])}>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold">{a.name}</span>
            <AgentStatusBadge shown={shown} />
            <Origin mondo />
          </div>
          <div className="readout truncate normal-case">
            {a.project} · {where} · {ago(now - Math.max(a.lastActivity, a.session?.lastActivity ?? 0))}
          </div>
          {a.session?.lastMessage && isLive(a) && (
            <p className="line-clamp-1 text-xs text-muted-foreground">{a.session.lastMessage}</p>
          )}
        </div>
        <ChevronRight className="size-4 shrink-0 text-brass" />
      </Card>
    </Link>
  );
}

/** Who started it: Mondo, or you (and from where). */
function Origin({ mondo, from }: { mondo?: boolean; from?: string }) {
  return (
    <span
      className={cn(
        "readout rounded-sm border px-1.5 py-0.5 normal-case",
        mondo ? "border-leeloo/50 text-leeloo" : "border-brass/40 text-brass",
      )}
    >
      {mondo ? "Mondo" : `You · ${from}`}
    </span>
  );
}

/** A session you started yourself. Mondo only watches these; chat via Claude if it has Remote Control. */
function OtherRow({ s, now }: { s: OtherSessionView; now: number }) {
  const shown = shownForSession(s.status);
  return (
    <Card size="sm" className={cn("gap-2 px-4", EDGE[shown])}>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-semibold">{s.name ?? s.worktree ?? "Claude session"}</span>
          <AgentStatusBadge shown={shown} />
          <Origin from={s.from} />
        </div>
        <div className="readout truncate normal-case">
          {s.project ?? "Unregistered folder"} · {s.worktree || folderName(s.cwd)}
          {s.branch ? ` · ${s.branch}` : ""} · {ago(now - s.lastActivity)}
        </div>
        {s.lastMessage && <p className="line-clamp-1 text-xs text-muted-foreground">{s.lastMessage}</p>}
      </div>
      {s.remoteUrl ? (
        <Button asChild size="sm" variant="outline" className="w-fit">
          <a href={s.remoteUrl} target="_blank" rel="noreferrer">
            <ExternalLink /> Open in Claude
          </a>
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">Remote Control is off for this one, so it can only be used at the PC.</p>
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
      router.push(`/agents/${d.id}`);
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
