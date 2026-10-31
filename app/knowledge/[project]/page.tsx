import { notFound } from "next/navigation";
import { KnowledgeBrowser } from "@/components/knowledge-browser";
import { KnowledgeStats } from "@/components/knowledge-stats";
import { PageHeader } from "@/components/page-header";
import { findProject } from "@/lib/config";
import { getKnowledge } from "@/lib/knowledge";

export const dynamic = "force-dynamic";

export default async function ProjectKnowledgePage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const project = findProject(slug);
  if (!project) notFound();
  const sources = await getKnowledge(slug);

  return (
    <>
      <PageHeader title={`${project.name} · Knowledge`} />
      <div className="space-y-6 p-4 md:p-6">
        <p className="max-w-2xl break-all text-sm text-muted-foreground">{project.path}</p>
        <KnowledgeStats sources={sources} groupBy="origin" />
        <KnowledgeBrowser sources={sources} />
      </div>
    </>
  );
}
