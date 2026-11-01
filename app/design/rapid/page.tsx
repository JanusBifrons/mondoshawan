import RapidView from "./RapidView";

/** Rapid fire: open design questions one after another (?project=<slug> for one project). */
export default async function Page({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  return <RapidView project={project ?? null} />;
}
