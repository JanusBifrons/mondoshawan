import { agentViews } from "@/lib/agent-views";
import { getAgents } from "@/lib/agents";
import { sseResponse } from "@/lib/sse";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Pushes the agent list (with live session status from the hooks) on every change. */
export function GET(req: Request) {
  const agents = getAgents();
  const store = getStore();
  return sseResponse(req, (send) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const snapshot = () => send("agents", { agents: agentViews(), now: Date.now() });
    const soon = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        snapshot();
      }, 250);
    };
    snapshot();
    agents.on("change", soon);
    store.on("change", soon);
    return () => {
      if (timer) clearTimeout(timer);
      agents.off("change", soon);
      store.off("change", soon);
    };
  });
}
