import { KnowledgeBrowser } from "@/components/knowledge-browser";
import { KnowledgeStats } from "@/components/knowledge-stats";
import { PageHeader } from "@/components/page-header";
import { getKnowledge } from "@/lib/knowledge";

export const dynamic = "force-dynamic";

/** Every project's sources in one searchable list. */
export default async function KnowledgePage() {
  const sources = await getKnowledge();
  return (
    <>
      <PageHeader title="Knowledge base" kicker="All projects" />
      <div className="space-y-6 p-4 md:p-6">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Docs, plans and notes from every registered project: repo markdown, design folders outside the repos, and
          linked Google Drive docs. Click a row to read it.
        </p>
        <KnowledgeStats sources={sources} groupBy="project" />
        <KnowledgeBrowser sources={sources} showProject />
      </div>
    </>
  );
}
