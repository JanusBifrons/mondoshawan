import { getKnowledge } from "@/lib/knowledge";

export const dynamic = "force-dynamic";

/** All knowledge sources, optionally for one project: /api/knowledge?project=<slug> */
export async function GET(req: Request) {
  const project = new URL(req.url).searchParams.get("project") ?? undefined;
  return Response.json({ sources: await getKnowledge(project) });
}
