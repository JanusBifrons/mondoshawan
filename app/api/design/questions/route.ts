import { findProject, loadConfig, projectSlug } from "@/lib/config";
import { getDb } from "@/lib/db";
import { listOpenQuestions } from "@/lib/design";

export const dynamic = "force-dynamic";

/** Open design questions for rapid fire: ?project=<slug> for one project, or all. Blocking first, then priority. */
export function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("project");
  const project = slug ? findProject(slug) : null;
  if (slug && !project) return Response.json({ error: "unknown project" }, { status: 404 });
  const db = getDb();
  const slugs = Object.fromEntries(loadConfig().projects.map((p) => [p.name, projectSlug(p.name)]));
  // A question can point at a talk that no longer exists (or an older kind of discussion): treat it as not started.
  const talks = new Set((db.prepare("SELECT id FROM design_talks").all() as { id: string }[]).map((r) => r.id));
  const questions = listOpenQuestions(db, project?.name).map((q) => (q.discussion && !talks.has(q.discussion) ? { ...q, discussion: null } : q));
  return Response.json({ questions, slugs });
}
