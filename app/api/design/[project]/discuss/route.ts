import { findProject } from "@/lib/config";
import { getDb } from "@/lib/db";
import { DesignError } from "@/lib/design";
import { startTalk } from "@/lib/design-talk";
import { codeChanges } from "@/lib/design-freshness";
import { forbidden, isCrossSite } from "@/lib/guard";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ project: string }> };

/**
 * Start a design talk inside Mondo: { node?: id or title path, question?: id, message? }.
 * With a question, the talk is about that one open question. Without a node, it's about
 * the project as a whole (e.g. a new idea). Returns { talkId }; the page opens /design/talk/<id>.
 */
export async function POST(req: Request, { params }: Ctx) {
  if (isCrossSite(req)) return forbidden();
  const project = findProject((await params).project);
  if (!project) return Response.json({ error: "unknown project" }, { status: 404 });
  let b: { node?: unknown; message?: unknown; question?: unknown; rapid?: unknown };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const node = typeof b.node === "string" && b.node.trim() ? b.node.trim() : null;
  const question = typeof b.question === "number" && Number.isInteger(b.question) ? b.question : undefined;
  const message = typeof b.message === "string" ? b.message : "";
  try {
    await codeChanges(getDb(), project).catch(() => null); // so the agent knows which nodes are stale
    const talk = startTalk(getDb(), project, { node, question, message, rapid: b.rapid === true });
    return Response.json({ talkId: talk.id }, { status: 201 });
  } catch (err) {
    if (err instanceof DesignError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
