import AgentView from "./AgentView";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgentView id={id} />;
}
