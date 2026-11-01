import { decideDevice, isRemote, type DeviceAction } from "@/lib/devices";
import { forbidden, isCrossSite } from "@/lib/guard";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const ACTIONS: DeviceAction[] = ["approve", "deny", "revoke"];

/**
 * { action: "approve" | "deny" | "revoke" }. Only from this PC: a phone can never approve
 * itself or another device, even once it is signed in.
 */
export async function POST(req: Request, { params }: Ctx) {
  if (isCrossSite(req)) return forbidden();
  if (isRemote(req)) return Response.json({ error: "approve devices on the PC" }, { status: 403 });
  const { id } = await params;
  let body: { action?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const action = body.action as DeviceAction;
  if (!ACTIONS.includes(action)) return Response.json({ error: "unknown action" }, { status: 400 });
  return decideDevice(id, action)
    ? Response.json({ ok: true })
    : Response.json({ error: "no such device, or it has already been decided" }, { status: 409 });
}
