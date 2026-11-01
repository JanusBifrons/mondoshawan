import { stopProcessTree } from "@/lib/agents";
import { forbidden, isCrossSite } from "@/lib/guard";
import { liveSessions } from "@/lib/live-sessions";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ sessionId: string }> };

/**
 * Stop a Claude session you started yourself ({ action: "stop" }). Only a session that
 * Claude's registry lists as running right now can be targeted, and its PID comes from
 * there, so this can't be pointed at any other process. The page asks for confirmation.
 */
export async function POST(req: Request, { params }: Ctx) {
  if (isCrossSite(req)) return forbidden();
  const { sessionId } = await params;
  let b: { action?: unknown };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (b.action !== "stop") return Response.json({ error: "unknown action" }, { status: 400 });
  const live = liveSessions().find((s) => s.sessionId === sessionId);
  if (!live) return Response.json({ error: "that session isn't running" }, { status: 404 });
  stopProcessTree(live.pid);
  getStore().markEnded(sessionId, "Stopped from Mondo");
  return Response.json({ ok: true });
}
