import { forbidden, isCrossSite } from "@/lib/guard";
import type { HookPayload } from "@/lib/status";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Receives Claude Code hook payloads from hooks/mondo-hook.js. */
export async function POST(req: Request) {
  if (isCrossSite(req)) return forbidden();
  let body: HookPayload;
  try {
    body = (await req.json()) as HookPayload;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body.session_id !== "string" || !body.session_id ||
      typeof body.hook_event_name !== "string") {
    return Response.json({ error: "session_id and hook_event_name are required" }, { status: 400 });
  }
  // Reply immediately; git lookups happen in the background so the hook never waits.
  void getStore().applyHook(body);
  return new Response(null, { status: 202 });
}
