import { notFound } from "next/navigation";
import { DesignBible } from "@/components/design-bible";
import { PageHeader } from "@/components/page-header";
import { findProject } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function ProjectDesignPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const project = findProject(slug);
  if (!project) notFound();
  return (
    <>
      <PageHeader title={project.name} kicker="Design bible" />
      <div className="p-4 md:p-6">
        <DesignBible slug={slug} />
      </div>
    </>
  );
}
