import { findProject } from "@/lib/config";
import { getDb } from "@/lib/db";
import { DesignError } from "@/lib/design";
import { startRegenerate } from "@/lib/design-regenerate";
import { forbidden, isCrossSite } from "@/lib/guard";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ project: string }> };

/** Regenerate nodes with the fixed instruction: { nodes: [id or title path, ...] }. */
export async function POST(req: Request, { params }: Ctx) {
  if (isCrossSite(req)) return forbidden();
  const project = findProject((await params).project);
  if (!project) return Response.json({ error: "unknown project" }, { status: 404 });
  let b: { nodes?: unknown };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const nodes = Array.isArray(b.nodes) ? b.nodes.filter((n): n is string => typeof n === "string" && !!n.trim()) : [];
  try {
    const agent = startRegenerate(getDb(), project, nodes);
    return Response.json({ sessionId: agent.sessionId, name: agent.name }, { status: 201 });
  } catch (err) {
    if (err instanceof DesignError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
