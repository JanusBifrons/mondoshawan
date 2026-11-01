"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ExternalLink, Loader2, Play, Smartphone, Square, Trash2 } from "lucide-react";
import { AgentStatusBadge, SHOWN_LABEL, agentAction, ago, folderName, isLive, shownStatus, useAgents, useNow } from "@/components/agent-ui";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** One agent: where it is, what it's doing, and Stop / Resume. Chatting happens in the Claude app. */
export default function AgentView({ id }: { id: string }) {
  const router = useRouter();
  const { agents, skew } = useAgents();
  const now = useNow(skew);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const a = agents?.find((x) => x.id === id);

  const act = async (action: "stop" | "resume") => {
    if (action === "stop" && !confirm("Stop this agent? Its window on the PC closes. You can resume it later.")) return;
    setBusy(true);
    setError(null);
    try {
      await agentAction(id, { action });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("Remove this agent from Mondo? Its Claude conversation and any worktree are kept.")) return;
    await fetch(`/api/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
    router.push("/agents");
  };

  if (agents && !a) {
    return (
      <>
        <PageHeader title="Agent" kicker="Command" />
        <div className="p-6 text-sm text-muted-foreground">
          This agent no longer exists. <Link href="/agents" className="text-diva underline">Back to agents</Link>
        </div>
      </>
    );
  }

  const shown = a ? shownStatus(a) : null;
  const live = a ? isLive(a) : false;
  const title = a ? `${a.project}: ${a.name}` : "";

  return (
    <>
      <PageHeader title={a?.name ?? "Agent"} kicker="Agent">
        {shown && <AgentStatusBadge shown={shown} />}
      </PageHeader>

      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/agents">
            <ArrowLeft /> Agents
          </Link>
        </Button>

        {!a ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {live && (
              <Card className="gap-2 px-4">
                <div className="flex items-center gap-2 font-semibold">
                  <Smartphone className="size-4 text-leeloo" /> Chat in the Claude app
                </div>
                {a.remoteUrl ? (
                  <Button asChild className="w-full sm:w-fit">
                    <a href={a.remoteUrl} target="_blank" rel="noreferrer">
                      <ExternalLink /> Open in Claude
                    </a>
                  </Button>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> Waiting for it to connect…
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  It&apos;s listed as <b>{title}</b> under Remote Control in the Claude app. You can also type in its Git
                  Bash window on the PC.
                </p>
              </Card>
            )}

            {a.status === "failed" && a.exitInfo && (
              <p className="rounded-md border border-taxi/40 bg-taxi/10 px-3 py-2 text-sm text-taxi">{a.exitInfo}</p>
            )}

            <Card className="gap-3 px-4 text-sm">
              <Row label="Status">{shown ? SHOWN_LABEL[shown] : "—"}</Row>
              {a.session?.lastMessage && <Row label="Latest">{a.session.lastMessage}</Row>}
              <Row label="Project">{a.project}</Row>
              <Row label="Folder">
                <span title={a.session?.cwd ?? a.cwd}>{a.session?.worktree || folderName(a.session?.cwd ?? a.cwd)}</span>
              </Row>
              {a.session?.branch && (
                <Row label="Branch">
                  <span className="font-mono text-diva">{a.session.branch}</span>
                </Row>
              )}
              {a.worktreeName && <Row label="Worktree">{a.worktreeName} (the agent creates it)</Row>}
              <Row label="Permissions">{a.permissionMode}</Row>
              {a.model && <Row label="Model">{a.model}</Row>}
              <Row label="Last activity">{ago(now - Math.max(a.lastActivity, a.session?.lastActivity ?? 0))}</Row>
              {!live && a.exitInfo && a.status !== "failed" && <Row label="Ended">{a.exitInfo}</Row>}
            </Card>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex flex-wrap gap-2">
              {live ? (
                <Button variant="outline" className="hover:text-destructive" disabled={busy} onClick={() => act("stop")}>
                  <Square /> Stop (closes its window)
                </Button>
              ) : (
                <>
                  <Button disabled={busy} onClick={() => act("resume")}>
                    <Play /> Resume in a new window
                  </Button>
                  <Button variant="ghost" className="hover:text-destructive" onClick={remove}>
                    <Trash2 /> Remove
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="readout w-28 shrink-0 pt-0.5">{label}</span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  );
}
