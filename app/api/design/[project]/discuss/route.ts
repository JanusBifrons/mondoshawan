import { findProject } from "@/lib/config";
import { getDb } from "@/lib/db";
import { DesignError } from "@/lib/design";
import { startDiscussion } from "@/lib/design-discuss";
import { forbidden, isCrossSite } from "@/lib/guard";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ project: string }> };

/**
 * Start a design conversation with an agent: { node?: id or title path, message? }.
 * With a question id, the agent talks that one open question through and closes it once agreed.
 * Without a node it's an open discussion about the project (e.g. a new idea).
 * Returns the agent; the page sends the owner to its drill-down / Open in Claude.
 */
export async function POST(req: Request, { params }: Ctx) {
  if (isCrossSite(req)) return forbidden();
  const project = findProject((await params).project);
  if (!project) return Response.json({ error: "unknown project" }, { status: 404 });
  let b: { node?: unknown; message?: unknown; question?: unknown };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const node = typeof b.node === "string" && b.node.trim() ? b.node.trim() : null;
  const message = typeof b.message === "string" ? b.message : "";
  try {
    const question = typeof b.question === "number" && Number.isInteger(b.question) ? b.question : undefined;
    const agent = startDiscussion(getDb(), project, node, message, { question });
    return Response.json({ sessionId: agent.sessionId, name: agent.name }, { status: 201 });
  } catch (err) {
    if (err instanceof DesignError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
