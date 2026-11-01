import { agentViews, otherSessions } from "@/lib/agent-views";
import { getAgents } from "@/lib/agents";
import { sseResponse } from "@/lib/sse";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Pushes Mondo's agents plus every other live Claude session on the PC (event "agents")
 * on every change. Claude's session registry changes without telling us, so also re-read
 * it every few seconds.
 */
export function GET(req: Request) {
  const agents = getAgents();
  const store = getStore();
  return sseResponse(req, (send) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = "";
    let closed = false;
    const snapshot = async () => {
      const body = { agents: agentViews(), others: await otherSessions() };
      const key = JSON.stringify(body);
      if (closed || key === last) return;
      last = key;
      send("agents", { ...body, now: Date.now() });
    };
    const soon = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void snapshot();
      }, 250);
    };
    void snapshot();
    const poll = setInterval(() => void snapshot(), 5000);
    agents.on("change", soon);
    store.on("change", soon);
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      agents.off("change", soon);
      store.off("change", soon);
    };
  });
}
