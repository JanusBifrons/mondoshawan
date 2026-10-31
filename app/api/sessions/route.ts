import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ sessions: getStore().list(), now: Date.now() });
}
