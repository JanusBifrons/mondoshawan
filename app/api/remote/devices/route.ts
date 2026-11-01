import { isRemote, listApproved, listPending } from "@/lib/devices";

export const dynamic = "force-dynamic";

/** Pairing requests and approved phones. This PC only. */
export function GET(req: Request) {
  if (isRemote(req)) return Response.json({ error: "only available on the PC" }, { status: 403 });
  return Response.json({ pending: listPending(), approved: listApproved() });
}
