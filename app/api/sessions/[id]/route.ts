import { forbidden, isCrossSite } from "@/lib/guard";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Update hand-edited fields. Currently just `system`. */
export async function PATCH(req: Request, { params }: Ctx) {
  if (isCrossSite(req)) return forbidden();
  const { id } = await params;
  let body: { system?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof body.system !== "string") {
    return Response.json({ error: "system must be a string" }, { status: 400 });
  }
  const s = getStore().setSystem(id, body.system);
  return s ? Response.json(s) : Response.json({ error: "not found" }, { status: 404 });
}

/** Forget a session (used to tidy the Ended list). */
export async function DELETE(req: Request, { params }: Ctx) {
  if (isCrossSite(req)) return forbidden();
  const { id } = await params;
  return getStore().remove(id)
    ? new Response(null, { status: 204 })
    : Response.json({ error: "not found" }, { status: 404 });
}
