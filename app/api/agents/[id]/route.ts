import { getAgents } from "@/lib/agents";
import { forbidden, isCrossSite } from "@/lib/guard";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const agents = getAgents();
  const agent = agents.get(id);
  if (!agent) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ agent, entries: agents.entries(id), now: Date.now() });
}

/** Actions: { action: "send", text } | "interrupt" | "stop" | "resume". */
export async function POST(req: Request, { params }: Ctx) {
  if (isCrossSite(req)) return forbidden();
  const { id } = await params;
  const agents = getAgents();
  if (!agents.get(id)) return Response.json({ error: "not found" }, { status: 404 });
  let b: { action?: unknown; text?: unknown };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  let ok = false;
  switch (b.action) {
    case "send": {
      const text = typeof b.text === "string" ? b.text.trim().slice(0, 20_000) : "";
      if (!text) return Response.json({ error: "text is required" }, { status: 400 });
      ok = agents.send(id, text);
      break;
    }
    case "interrupt":
      ok = agents.interrupt(id);
      break;
    case "stop":
      ok = agents.stop(id);
      break;
    case "resume":
      ok = !!agents.resume(id);
      break;
    default:
      return Response.json({ error: "unknown action" }, { status: 400 });
  }
  return ok
    ? Response.json(agents.get(id))
    : Response.json({ error: "agent is not running" }, { status: 409 });
}

/** Forget a stopped agent (its Claude conversation and worktree are kept). */
export async function DELETE(req: Request, { params }: Ctx) {
  if (isCrossSite(req)) return forbidden();
  const { id } = await params;
  return getAgents().remove(id)
    ? new Response(null, { status: 204 })
    : Response.json({ error: "not found, or still running" }, { status: 409 });
}
