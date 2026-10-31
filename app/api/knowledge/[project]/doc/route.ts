import { getKnowledgeDoc } from "@/lib/knowledge";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ project: string }> };

/** Markdown text of one indexed source: /api/knowledge/<project>/doc?id=<source id> */
export async function GET(req: Request, { params }: Ctx) {
  const { project } = await params;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  const doc = await getKnowledgeDoc(project, id);
  return doc ? Response.json(doc) : Response.json({ error: "not found" }, { status: 404 });
}
