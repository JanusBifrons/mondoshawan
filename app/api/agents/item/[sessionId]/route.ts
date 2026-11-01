import { getAgents, stopProcessTree } from "@/lib/agents";
import { fleetItem, recentActivity, transcriptFile } from "@/lib/fleet";
import { forbidden, isCrossSite } from "@/lib/guard";
import { liveSessions } from "@/lib/live-sessions";
import { getStore } from "@/lib/store";
import { sessionUsage, sumModels } from "@/lib/usage";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ sessionId: string }> };

/** One session in detail: the fleet item plus its recent activity (read from its transcript). */
export async function GET(_req: Request, { params }: Ctx) {
  const { sessionId } = await params;
  const item = await fleetItem(sessionId);
  if (!item) return Response.json({ error: "not found" }, { status: 404 });
  const u = sessionUsage(item.sessionId, item.cwd, item.transcriptPath);
  const usage = u ? { tokens: sumModels(u.models), models: u.models.map((m) => m.model), calls: u.calls } : null;
  return Response.json({ item, activity: recentActivity(transcriptFile(item)), usage, now: Date.now() });
}

/**
 * High-level actions (no chat; that happens in the Claude app):
 *   { action: "stop" }    close it (Mondo agent: its window; your session: its claude process)
 *   { action: "resume" }  reopen a stopped Mondo agent in a new window
 *   { action: "forget" }  remove a finished session from the list
 *   { action: "system", value }  set its System tag
 */
export async function POST(req: Request, { params }: Ctx) {
  if (isCrossSite(req)) return forbidden();
  const { sessionId } = await params;
  let b: { action?: unknown; value?: unknown };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const item = await fleetItem(sessionId);
  if (!item) return Response.json({ error: "not found" }, { status: 404 });
  const agents = getAgents();
  const store = getStore();
  const nope = (why: string) => Response.json({ error: why }, { status: 409 });

  switch (b.action) {
    case "stop": {
      if (!item.canStop) return nope("it isn't running");
      if (item.agentId) {
        if (!agents.stop(item.agentId)) return nope("it isn't running");
      } else {
        // Only a session Claude's registry lists as running, with the PID from there.
        const live = liveSessions().find((s) => s.sessionId === sessionId);
        if (!live) return nope("it isn't running");
        stopProcessTree(live.pid);
        store.markEnded(sessionId, "Stopped from Mondo");
      }
      break;
    }
    case "resume":
      if (!item.canResume || !item.agentId) return nope("only a stopped Mondo agent can be resumed");
      agents.resume(item.agentId);
      break;
    case "forget":
      if (!item.canForget) return nope("it's still running");
      if (item.agentId) agents.remove(item.agentId);
      store.remove(sessionId);
      break;
    case "system":
      if (typeof b.value !== "string") return Response.json({ error: "value must be a string" }, { status: 400 });
      if (!store.setSystem(sessionId, b.value)) return nope("Mondo hasn't seen this session's hooks yet");
      break;
    default:
      return Response.json({ error: "unknown action" }, { status: 400 });
  }
  return Response.json({ item: await fleetItem(sessionId) });
}
