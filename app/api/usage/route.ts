import { usageRuns } from "@/lib/usage";

export const dynamic = "force-dynamic";

/** The usage log: every job and agent Mondo started, in tokens. */
export function GET() {
  return Response.json({ runs: usageRuns(), now: Date.now() });
}
