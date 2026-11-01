import { findProject } from "@/lib/config";
import { getDb } from "@/lib/db";
import { DesignError, HUMAN, lastEventId, listOpenChases, listTree, recentEvents } from "@/lib/design";
import { runAction, type ActionInput } from "@/lib/design-actions";
import { forbidden, isCrossSite } from "@/lib/guard";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ project: string }> };

/** The whole tree for a project, plus the change marker the page uses to refresh. */
export async function GET(_req: Request, { params }: Ctx) {
  const project = findProject((await params).project);
  if (!project) return Response.json({ error: "unknown project" }, { status: 404 });
  const db = getDb();
  return Response.json({
    project: project.name,
    tree: listTree(db, project.name),
    chases: listOpenChases(db, project.name),
    events: recentEvents(db, project.name, 30),
    lastEvent: lastEventId(db, project.name),
  });
}

/**
 * Every change goes through here as `{ action, ...args }` (see lib/design-actions.ts).
 * Requests from the UI always act as the human. Agents use `npm run design` instead.
 */
export async function POST(req: Request, { params }: Ctx) {
  if (isCrossSite(req)) return forbidden();
  const project = findProject((await params).project);
  if (!project) return Response.json({ error: "unknown project" }, { status: 404 });
  let body: ActionInput;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    return Response.json({ result: runAction(getDb(), project.name, body, HUMAN) });
  } catch (err) {
    if (err instanceof DesignError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
