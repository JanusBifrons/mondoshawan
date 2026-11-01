"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, ChevronRight, Loader2, Play, Send, Square, Trash2, Wrench, Zap } from "lucide-react";
import { AgentStatusBadge, agentAction, ago, folderName, isRunning, useNow, FIELD } from "@/components/agent-ui";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import type { Agent, Entry } from "@/lib/agents";
import { cn } from "@/lib/utils";

function useAgent(id: string) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [skew, setSkew] = useState(0);
  const [missing, setMissing] = useState(false);
  const lastId = useRef(0);

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    // Reconnect with ?after= so a dropped phone connection doesn't duplicate lines.
    const connect = () => {
      if (closed) return;
      es = new EventSource(`/api/agents/${encodeURIComponent(id)}/stream?after=${lastId.current}`);
      es.addEventListener("agent", (ev) => {
        const d = JSON.parse((ev as MessageEvent).data) as { agent: Agent | null; now: number };
        if (!d.agent) return setMissing(true);
        setAgent(d.agent);
        setSkew(d.now - Date.now());
      });
      es.addEventListener("entry", (ev) => {
        const e = JSON.parse((ev as MessageEvent).data) as Entry;
        if (e.id <= lastId.current) return;
        lastId.current = e.id;
        setEntries((prev) => [...prev, e]);
      });
      es.onerror = () => {
        es?.close();
        if (!closed) setTimeout(connect, 2000);
        fetch(`/api/agents/${encodeURIComponent(id)}`).then((r) => r.status === 404 && setMissing(true)).catch(() => {});
      };
    };
    connect();
    return () => {
      closed = true;
      es?.close();
    };
  }, [id]);

  return { agent, setAgent, entries, skew, missing };
}

export default function AgentView({ id }: { id: string }) {
  const router = useRouter();
  const { agent, setAgent, entries, skew, missing } = useAgent(id);
  const now = useNow(skew);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Keep the newest line in view unless the user has scrolled up to read.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      setAgent(await agentAction(id, body));
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    stick.current = true;
    if (await act({ action: "send", text })) setDraft("");
  };

  const remove = async () => {
    if (!confirm("Remove this agent from Mondo? Its Claude conversation and any worktree are kept.")) return;
    await fetch(`/api/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
    router.push("/agents");
  };

  if (missing) {
    return (
      <>
        <PageHeader title="Agent" kicker="Command" />
        <div className="p-6 text-sm text-muted-foreground">
          This agent no longer exists. <Link href="/agents" className="text-diva underline">Back to agents</Link>
        </div>
      </>
    );
  }

  const running = agent ? isRunning(agent.status) : false;

  return (
    <div className="flex h-dvh flex-col">
      <PageHeader title={agent?.name ?? "Agent"} kicker="Agent">
        {agent && <AgentStatusBadge status={agent.status} />}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 border-b border-brass/20 px-4 py-2 md:px-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/agents">
            <ArrowLeft /> Agents
          </Link>
        </Button>
        {agent && (
          <span className="readout min-w-0 flex-1 truncate normal-case" title={agent.cwd}>
            {agent.project} · {folderName(agent.cwd)} · {agent.permissionMode}
            {agent.model ? ` · ${agent.model}` : ""} · ${agent.costUsd.toFixed(2)}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {agent?.status === "working" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: "interrupt" })}>
              <Zap /> Interrupt
            </Button>
          )}
          {running ? (
            <Button
              size="sm"
              variant="outline"
              className="hover:text-destructive"
              disabled={busy || agent?.status === "stopping"}
              onClick={() => act({ action: "stop" })}
            >
              <Square /> Stop
            </Button>
          ) : (
            agent && (
              <>
                <Button size="sm" disabled={busy} onClick={() => act({ action: "resume" })}>
                  <Play /> Resume
                </Button>
                <Button size="sm" variant="ghost" className="hover:text-destructive" onClick={remove} aria-label="Remove">
                  <Trash2 />
                </Button>
              </>
            )
          )}
        </div>
      </div>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-6"
      >
        <div className="mx-auto max-w-3xl space-y-3">
          {!agent && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Connecting…
            </div>
          )}
          {groupTools(entries).map((item) =>
            Array.isArray(item) ? <ToolGroup key={item[0].id} entries={item} /> : <Line key={item.id} entry={item} />,
          )}
          {agent?.status === "working" && (
            <div className="readout flex items-center gap-2 text-fire">
              <Loader2 className="size-3.5 animate-spin" /> Working · {ago(now - agent.lastActivity)}
            </div>
          )}
        </div>
      </div>

      <form
        onSubmit={send}
        className="border-t border-brass/20 bg-background/90 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:px-6"
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            className={cn(FIELD, "max-h-40 min-h-11 flex-1 resize-none")}
            rows={1}
            value={draft}
            disabled={!running}
            placeholder={running ? (agent?.status === "working" ? "Queue a message…" : "Message the agent…") : "Resume the agent to send messages"}
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              // Enter sends on desktop; on phones the keyboard's return adds a line and the button sends.
              if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) {
                e.preventDefault();
                send();
              }
            }}
          />
          <Button type="submit" size="icon-lg" disabled={!running || busy || !draft.trim()} aria-label="Send">
            <Send />
          </Button>
        </div>
        {error && <p className="mx-auto mt-2 max-w-3xl text-sm text-destructive">{error}</p>}
      </form>
    </div>
  );
}

/** Runs of tool calls and results collapse into one expandable group. */
function groupTools(entries: Entry[]): (Entry | Entry[])[] {
  const out: (Entry | Entry[])[] = [];
  for (const e of entries) {
    const isTool = e.kind === "tool" || e.kind === "tool_result";
    const last = out[out.length - 1];
    if (isTool && Array.isArray(last)) last.push(e);
    else out.push(isTool ? [e] : e);
  }
  return out;
}

function ToolGroup({ entries }: { entries: Entry[] }) {
  const [open, setOpen] = useState(false);
  const calls = entries.filter((e) => e.kind === "tool");
  const latest = calls[calls.length - 1]?.text ?? "";
  return (
    <div className="rounded-md border border-brass/20 bg-muted/30 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        <Wrench className="size-3.5 shrink-0 text-brass" />
        <span className="shrink-0">
          {calls.length} tool call{calls.length === 1 ? "" : "s"}
        </span>
        {!open && <span className="truncate font-mono">{latest}</span>}
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-brass/20 px-3 py-2 font-mono">
          {entries.map((e) =>
            e.kind === "tool" ? (
              <div key={e.id} className="break-words text-diva">
                ▸ {e.text}
              </div>
            ) : (
              <pre key={e.id} className="max-h-48 overflow-auto whitespace-pre-wrap break-words pl-3 text-muted-foreground">
                {e.text}
              </pre>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function Line({ entry: e }: { entry: Entry }) {
  switch (e.kind) {
    case "user":
      return (
        <div className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-lg rounded-br-sm bg-leeloo/15 px-3 py-2 text-sm shadow-[inset_-2px_0_0_var(--leeloo)]">
          {e.text}
        </div>
      );
    case "assistant":
      return (
        <article className="prose prose-sm max-w-none break-words dark:prose-invert prose-a:text-diva prose-strong:text-foreground prose-code:text-taxi prose-pre:overflow-x-auto prose-table:block prose-table:overflow-x-auto">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{e.text}</ReactMarkdown>
        </article>
      );
    case "result":
      return <div className="readout text-earth">✓ {e.text}</div>;
    case "error":
      return (
        <div className="whitespace-pre-wrap break-words rounded-md border border-taxi/40 bg-taxi/10 px-3 py-2 font-mono text-xs text-taxi">
          {e.text}
        </div>
      );
    default:
      return <div className="readout text-center normal-case text-muted-foreground">— {e.text} —</div>;
  }
}
