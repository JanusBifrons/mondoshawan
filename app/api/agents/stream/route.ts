import { getAgents } from "@/lib/agents";
import { sseResponse } from "@/lib/sse";

export const dynamic = "force-dynamic";

/** Pushes the agent list on every change (event "agents"). */
export function GET(req: Request) {
  const agents = getAgents();
  return sseResponse(req, (send) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const snapshot = () => send("agents", { agents: agents.list(), now: Date.now() });
    // Entries arrive in bursts; coalesce list refreshes.
    const soon = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        snapshot();
      }, 250);
    };
    snapshot();
    agents.on("change", soon);
    agents.on("entry", soon);
    return () => {
      if (timer) clearTimeout(timer);
      agents.off("change", soon);
      agents.off("entry", soon);
    };
  });
}
