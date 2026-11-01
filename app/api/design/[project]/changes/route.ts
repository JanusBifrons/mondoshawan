import { findProject } from "@/lib/config";
import { getDb } from "@/lib/db";
import { codeChanges } from "@/lib/design-freshness";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ project: string }> };

/** Built nodes whose evidence files changed in the game's merged code since they were checked. */
export async function GET(_req: Request, { params }: Ctx) {
  const project = findProject((await params).project);
  if (!project) return Response.json({ error: "unknown project" }, { status: 404 });
  return Response.json(await codeChanges(getDb(), project));
}
