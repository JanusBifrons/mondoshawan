import { checkProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";

/** Phase 1 check: each registered project's folder, branch and worktrees. */
export async function GET() {
  return Response.json({ projects: await checkProjects() });
}
