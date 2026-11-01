import { getAgents, type Entry } from "@/lib/agents";
import { sseResponse } from "@/lib/sse";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * One agent, live: "agent" events carry its summary, "entry" events each new transcript line.
 * Pass ?after=<entry id> to receive only entries after the ones the page already has.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const agents = getAgents();
  if (!agents.get(id)) return Response.json({ error: "not found" }, { status: 404 });
  const after = Number(new URL(req.url).searchParams.get("after")) || 0;

  return sseResponse(req, (send) => {
    const sendAgent = () => send("agent", { agent: agents.get(id), now: Date.now() });
    for (const e of agents.entries(id, after)) send("entry", e);
    sendAgent();
    const onChange = (c: { agentId: string }) => {
      if (c.agentId === id) sendAgent();
    };
    const onEntry = (e: Entry) => {
      if (e.agentId === id) send("entry", e);
    };
    agents.on("change", onChange);
    agents.on("entry", onEntry);
    return () => {
      agents.off("change", onChange);
      agents.off("entry", onEntry);
    };
  });
}
