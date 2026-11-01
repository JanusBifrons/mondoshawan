import { recentActivity, transcriptFile } from "@/lib/fleet";
import { forbidden, isCrossSite } from "@/lib/guard";
import { getJobs } from "@/lib/jobs";
import { jobRun } from "@/lib/usage";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** One job: its record, usage, and recent activity (from its session transcript). */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const job = getJobs().get(id);
  if (!job) return Response.json({ error: "not found" }, { status: 404 });
  const cwd = typeof job.input.cwd === "string" ? job.input.cwd : "";
  const activity = recentActivity(transcriptFile({ sessionId: job.sessionId, cwd, transcriptPath: null }), 40);
  return Response.json({ job, run: jobRun(job), activity, now: Date.now() });
}

/** { action: "stop" | "remove" }. */
export async function POST(req: Request, { params }: Ctx) {
  if (isCrossSite(req)) return forbidden();
  const { id } = await params;
  let b: { action?: unknown };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const jobs = getJobs();
  const ok = b.action === "stop" ? jobs.stop(id) : b.action === "remove" ? jobs.remove(id) : null;
  if (ok === null) return Response.json({ error: "unknown action" }, { status: 400 });
  return ok ? Response.json({ job: jobs.get(id) }) : Response.json({ error: "not possible right now" }, { status: 409 });
}
