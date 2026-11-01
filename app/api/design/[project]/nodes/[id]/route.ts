import { findProject } from "@/lib/config";
import { getDb } from "@/lib/db";
import { DesignError, getNodeDetail } from "@/lib/design";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ project: string; id: string }> };

/** Everything about one node: texts, revisions, reviews, questions, links, history. */
export async function GET(_req: Request, { params }: Ctx) {
  const { project: slug, id } = await params;
  const project = findProject(slug);
  if (!project) return Response.json({ error: "unknown project" }, { status: 404 });
  try {
    const detail = getNodeDetail(getDb(), id);
    if (detail.node.project !== project.name) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(detail);
  } catch (err) {
    if (err instanceof DesignError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
