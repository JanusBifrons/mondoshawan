import { agentView } from "@/lib/agent-views";
import { getAgents } from "@/lib/agents";
import { forbidden, isCrossSite } from "@/lib/guard";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const agent = agentView(id);
  return agent ? Response.json({ agent, now: Date.now() }) : Response.json({ error: "not found" }, { status: 404 });
}

/** Actions: { action: "stop" | "resume" }. Chatting happens in the Claude app. */
export async function POST(req: Request, { params }: Ctx) {
  if (isCrossSite(req)) return forbidden();
  const { id } = await params;
  const agents = getAgents();
  if (!agents.get(id)) return Response.json({ error: "not found" }, { status: 404 });
  let b: { action?: unknown };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  let ok = false;
  if (b.action === "stop") ok = agents.stop(id);
  else if (b.action === "resume") ok = !!agents.resume(id);
  else return Response.json({ error: "unknown action" }, { status: 400 });
  return ok ? Response.json(agentView(id)) : Response.json({ error: "not possible right now" }, { status: 409 });
}

/** Forget a stopped agent (its Claude conversation and worktree are kept). */
export async function DELETE(req: Request, { params }: Ctx) {
  if (isCrossSite(req)) return forbidden();
  const { id } = await params;
  return getAgents().remove(id)
    ? new Response(null, { status: 204 })
    : Response.json({ error: "not found, or still running" }, { status: 409 });
}
