import { findProject } from "@/lib/config";
import { getDb } from "@/lib/db";
import { DesignError } from "@/lib/design";
import { startTriage } from "@/lib/design-triage";
import { forbidden, isCrossSite } from "@/lib/guard";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ project: string }> };

/** Start "Check the questions" for this project's open questions. Returns { jobId }. */
export async function POST(req: Request, { params }: Ctx) {
  if (isCrossSite(req)) return forbidden();
  const project = findProject((await params).project);
  if (!project) return Response.json({ error: "unknown project" }, { status: 404 });
  try {
    const job = startTriage(getDb(), project);
    return Response.json({ jobId: job.id }, { status: 201 });
  } catch (err) {
    if (err instanceof DesignError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
