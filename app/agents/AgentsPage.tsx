"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Loader2, Plus, X } from "lucide-react";
import { AgentStatusBadge, FIELD, ago, folderName, isRunning, useNow } from "@/components/agent-ui";
import { MondoMark } from "@/components/elements";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Agent } from "@/lib/agents";
import { cn } from "@/lib/utils";

interface Place {
  slug: string;
  name: string;
  path: string;
  exists: boolean;
  worktrees: { path: string; branch: string | null }[];
}

function useAgents() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [skew, setSkew] = useState(0);
  useEffect(() => {
    const es = new EventSource("/api/agents/stream");
    es.addEventListener("agents", (ev) => {
      const d = JSON.parse((ev as MessageEvent).data) as { agents: Agent[]; now: number };
      setAgents(d.agents);
      setSkew(d.now - Date.now());
    });
    return () => es.close();
  }, []);
  return { agents, skew };
}

export default function AgentsPage() {
  const { agents, skew } = useAgents();
  const now = useNow(skew);
  const [creating, setCreating] = useState(false);

  const running = (agents ?? []).filter((a) => isRunning(a.status));
  const stopped = (agents ?? []).filter((a) => !isRunning(a.status));
  const yourMove = running.filter((a) => a.status === "idle").length;

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

        {agents && agents.length === 0 && !creating && (
          <Card className="items-center gap-3 px-6 py-12 text-center">
            <MondoMark className="size-16 opacity-80" />
            <p className="display text-sm font-bold text-leeloo">No agents yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Start a Claude Code agent in one of your projects, then talk to it from here or from your phone.
            </p>
            <Button onClick={() => setCreating(true)}>
              <Plus /> New agent
            </Button>
          </Card>
        )}

        {running.length > 0 && (
          <section className="space-y-2">
            <h2 className="readout">
              Running ({running.length}){yourMove > 0 && <span className="text-air"> · {yourMove} waiting for you</span>}
            </h2>
            {running.map((a) => (
              <AgentRow key={a.id} agent={a} now={now} />
            ))}
          </section>
        )}

        {stopped.length > 0 && (
          <section className="space-y-2 opacity-80">
            <h2 className="readout">Stopped ({stopped.length})</h2>
            {stopped.map((a) => (
              <AgentRow key={a.id} agent={a} now={now} />
            ))}
          </section>
        )}
      </div>
    </>
  );
}

const EDGE: Record<Agent["status"], string> = {
  starting: "shadow-[inset_3px_0_0_var(--earth)]",
  working: "shadow-[inset_3px_0_0_var(--fire)]",
  idle: "shadow-[inset_3px_0_0_var(--air)]",
  stopping: "shadow-[inset_3px_0_0_var(--water)]",
  stopped: "shadow-[inset_3px_0_0_var(--water)]",
  failed: "shadow-[inset_3px_0_0_var(--taxi)]",
};

function AgentRow({ agent: a, now }: { agent: Agent; now: number }) {
  return (
    <Link href={`/agents/${a.id}`} className="block">
      <Card size="sm" className={cn("flex-row items-center gap-3 px-4 transition-colors hover:bg-accent/40", EDGE[a.status])}>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold">{a.name}</span>
            <AgentStatusBadge status={a.status} />
          </div>
          <div className="readout truncate normal-case">
            {a.project} · {folderName(a.cwd)} · {ago(now - a.lastActivity)}
          </div>
        </div>
        <ChevronRight className="size-4 shrink-0 text-brass" />
      </Card>
    </Link>
  );
}

const MODE_HELP: Record<string, string> = {
  auto: "Auto: Claude decides what's safe to run (recommended)",
  acceptEdits: "Accept edits: file edits allowed, risky commands denied",
  plan: "Plan: read and plan only, no changes",
  manual: "Manual: anything that would ask permission is denied",
};

function NewAgentForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [project, setProject] = useState("");
  const [where, setWhere] = useState<string>("root"); // "root" | "new" | worktree path
  const [worktreeName, setWorktreeName] = useState("");
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
        setProject((p) => p || d.projects.find((x) => x.exists)?.slug || "");
      })
      .catch(() => setError("Couldn't load projects"));
  }, []);

  const current = places?.find((p) => p.slug === project);
  const worktrees = useMemo(
    () => (current?.worktrees ?? []).filter((w) => w.path.replace(/\/$/, "").toLowerCase() !== current?.path.toLowerCase()),
    [current],
  );

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
          newWorktree: where === "new" ? worktreeName : "",
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
              <select className={FIELD} value={project} onChange={(e) => (setProject(e.target.value), setWhere("root"))}>
                {places.map((p) => (
                  <option key={p.slug} value={p.slug} disabled={!p.exists}>
                    {p.name}
                    {!p.exists && " (missing)"}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="readout">Where</span>
              <select className={FIELD} value={where} onChange={(e) => setWhere(e.target.value)}>
                <option value="root">Main checkout ({current ? folderName(current.path) : ""})</option>
                <option value="new">New worktree…</option>
                {worktrees.map((w) => (
                  <option key={w.path} value={w.path}>
                    Worktree: {folderName(w.path)}
                    {w.branch ? ` [${w.branch}]` : ""}
                  </option>
                ))}
              </select>
            </label>

            {where === "new" && (
              <label className="block space-y-1.5">
                <span className="readout">Worktree name</span>
                <Input
                  required
                  value={worktreeName}
                  onChange={(e) => setWorktreeName(e.target.value)}
                  placeholder="e.g. missiles"
                  pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,39}"
                  autoCapitalize="off"
                  autoCorrect="off"
                />
                <span className="block text-xs text-muted-foreground">
                  Created at .claude/worktrees/{worktreeName || "name"} on branch worktree-{worktreeName || "name"}.
                </span>
              </label>
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
                  <option value="manual">Manual (deny)</option>
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

            <Button type="submit" className="w-full" disabled={busy || !project}>
              {busy ? <Loader2 className="animate-spin" /> : <Plus />} Start agent
            </Button>
          </>
        )}
      </form>
    </Card>
  );
}
