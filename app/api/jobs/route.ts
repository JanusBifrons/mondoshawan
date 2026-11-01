import { getJobs } from "@/lib/jobs";
import { jobRun } from "@/lib/usage";

export const dynamic = "force-dynamic";

/** Recent background jobs, as usage runs. */
export function GET() {
  return Response.json({ jobs: getJobs().list(50).map(jobRun), now: Date.now() });
}
