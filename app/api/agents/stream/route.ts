import { getAgents } from "@/lib/agents";
import { fleet } from "@/lib/fleet";
import { sseResponse } from "@/lib/sse";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * The whole fleet (event "fleet"): Mondo's agents, your sessions and recently ended ones.
 * Pushed on every agent or hook change, and re-read every 5s because Claude's session
 * registry changes without telling us. Unchanged snapshots aren't re-sent.
 */
export function GET(req: Request) {
  const agents = getAgents();
  const store = getStore();
  return sseResponse(req, (send) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = "";
    let closed = false;
    const snapshot = async () => {
      const items = await fleet();
      const key = JSON.stringify(items);
      if (closed || key === last) return;
      last = key;
      send("fleet", { items, now: Date.now() });
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
