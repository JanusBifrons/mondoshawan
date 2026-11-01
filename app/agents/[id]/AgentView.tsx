"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, Loader2, Play, Square, Trash2, Wrench } from "lucide-react";
import {
  AgentStatusBadge,
  Origin,
  SystemField,
  ago,
  folderName,
  itemAction,
  type FleetItem,
} from "@/components/agent-ui";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ActivityLine } from "@/lib/fleet";
import { cn } from "@/lib/utils";

interface Detail {
  item: FleetItem;
  activity: ActivityLine[];
  now: number;
}

/**
 * One session's drill-down: what it's doing, where, and a few high-level actions.
 * No chat on purpose: that's what the Claude app is for ("Open in Claude").
 */
export default function AgentView({ id }: { id: string }) {
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skew, setSkew] = useState(0);
  const [tick, setTick] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/agents/item/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (r.status === 404) return setMissing(true);
      const next = (await r.json()) as Detail;
      setD(next);
      setSkew(next.now - Date.now());
    } catch {
      /* server restarting; next poll */
    }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    const c = setInterval(() => setTick(Date.now()), 1000);
    return () => {
      clearInterval(t);
      clearInterval(c);
    };
  }, [load]);

  const now = tick + skew;

  const act = async (action: string, extra: Record<string, unknown> = {}, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      await itemAction(id, { action, ...extra });
      if (action === "forget") return router.push("/agents");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (missing) {
    return (
      <>
        <PageHeader title="Agent" kicker="Command" />
        <div className="p-6 text-sm text-muted-foreground">
          This session isn&apos;t known any more. <Link href="/agents" className="text-diva underline">Back to agents</Link>
        </div>
      </>
    );
  }

  const i = d?.item;
  const waiting = !!i && i.live && (i.shown === "waiting" || i.shown === "needs_permission" || i.shown === "failed");

  return (
    <>
      <PageHeader title={i?.name ?? "Agent"} kicker="Agent">
        {i && <AgentStatusBadge shown={i.shown} />}
      </PageHeader>

      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/agents">
            <ArrowLeft /> Agents
          </Link>
        </Button>

        {!i ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {/* What needs you, front and centre. */}
            {waiting && (
              <Card className="glow-box gap-3 px-4 pt-5">
                <div className="hazard absolute inset-x-0 top-0 h-1.5" />
                <p className="font-semibold">
                  {i.shown === "needs_permission"
                    ? "It's asking for permission."
                    : i.shown === "failed"
                      ? "It needs attention."
                      : "It's waiting for you."}
                </p>
                {i.shown === "failed" && i.exitInfo && <p className="text-sm text-taxi">{i.exitInfo}</p>}
                {i.lastMessage && <p className="text-sm text-muted-foreground">{i.lastMessage}</p>}
                {i.remoteUrl ? (
                  <Button asChild className="w-full sm:w-fit">
                    <a href={i.remoteUrl} target="_blank" rel="noreferrer">
                      <ExternalLink /> Open in Claude to answer
                    </a>
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Remote Control is off for this session, so answer it in its window on the PC.
                  </p>
                )}
              </Card>
            )}

            <Card className="gap-3 px-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <AgentStatusBadge shown={i.shown} />
                <Origin item={i} />
                <span className="readout normal-case">active {ago(now - i.lastActivity)}</span>
              </div>
              {!waiting && i.lastMessage && <Row label="Latest">{i.lastMessage}</Row>}
              <Row label="Project">{i.project ?? "Unregistered folder"}</Row>
              <Row label="Folder">
                <span title={i.cwd}>{i.worktree || folderName(i.cwd)}</span>
              </Row>
              {i.branch && (
                <Row label="Branch">
                  <span className="font-mono text-diva">{i.branch}</span>
                </Row>
              )}
              {i.startedAt && <Row label="Started">{new Date(i.startedAt).toLocaleString("en-GB")}</Row>}
              {i.permissionMode && <Row label="Permissions">{i.permissionMode}</Row>}
              {i.model && <Row label="Model">{i.model}</Row>}
              {!i.live && i.exitInfo && <Row label="Ended">{i.exitInfo}</Row>}
              <Row label="System">
                <SystemField value={i.system} onSave={(v) => act("system", { value: v })} />
              </Row>
            </Card>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex flex-wrap gap-2">
              {!waiting && i.remoteUrl && (
                <Button asChild variant="outline">
                  <a href={i.remoteUrl} target="_blank" rel="noreferrer">
                    <ExternalLink /> Open in Claude
                  </a>
                </Button>
              )}
              {i.canStop && (
                <Button
                  variant="outline"
                  className="hover:text-destructive"
                  disabled={busy}
                  onClick={() =>
                    act(
                      "stop",
                      {},
                      i.origin === "mondo"
                        ? "Stop this agent? Its window on the PC closes. You can resume it later."
                        : `Stop ${i.name}? Its Claude closes straight away and anything it's doing is cut off. The conversation is saved (claude --resume).`,
                    )
                  }
                >
                  <Square /> Stop
                </Button>
              )}
              {i.canResume && (
                <Button disabled={busy} onClick={() => act("resume")}>
                  <Play /> Resume in a new window
                </Button>
              )}
              {i.canForget && (
                <Button
                  variant="ghost"
                  className="hover:text-destructive"
                  disabled={busy}
                  onClick={() => act("forget", {}, "Remove it from the list? Its Claude conversation and any worktree are kept.")}
                >
                  <Trash2 /> Remove from list
                </Button>
              )}
            </div>

            <section className="space-y-2">
              <h2 className="readout">Recent activity</h2>
              {d.activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
              ) : (
                <ol className="space-y-2">
                  {[...d.activity].reverse().map((a, n) => (
                    <li key={n} className={cn("text-sm", a.kind === "tool" && "text-xs")}>
                      {a.kind === "tool" ? (
                        <span className="flex gap-2 font-mono text-diva">
                          <Wrench className="mt-0.5 size-3.5 shrink-0 text-brass" />
                          <span className="min-w-0 break-words">{a.text}</span>
                        </span>
                      ) : (
                        <div
                          className={cn(
                            "rounded-md px-3 py-2 whitespace-pre-wrap break-words",
                            a.kind === "you" ? "bg-leeloo/10 shadow-[inset_2px_0_0_var(--leeloo)]" : "bg-muted/40",
                          )}
                        >
                          <span className="readout mr-2 normal-case">{a.kind === "you" ? "You" : "Claude"}</span>
                          {a.text}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              <p className="text-xs text-muted-foreground">Newest first, from its saved conversation. Read-only.</p>
            </section>
          </>
        )}
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span className="readout w-24 shrink-0">{label}</span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  );
}

