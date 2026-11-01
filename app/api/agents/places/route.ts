import { loadConfig, projectSlug } from "@/lib/config";
import { MODELS, PERMISSION_MODES } from "@/lib/agents";
import { folderTrusted } from "@/lib/claude-trust";
import { dirExists, listWorktrees } from "@/lib/git";
import { toNativePath } from "@/lib/paths";

export const dynamic = "force-dynamic";

/** Where an agent can be started: each project and its existing worktrees, with Claude's trust. */
export async function GET() {
  const projects = await Promise.all(
    loadConfig().projects.map(async (p) => {
      const exists = dirExists(toNativePath(p.path));
      const worktrees = exists ? await listWorktrees(toNativePath(p.path)) : [];
      return {
        slug: projectSlug(p.name),
        name: p.name,
        path: p.path,
        exists,
        trusted: folderTrusted(p.path),
        worktrees: worktrees
          .filter((w) => !w.bare)
          .map((w) => ({ path: w.path, branch: w.branch, trusted: folderTrusted(w.path) })),
      };
    }),
  );
  return Response.json({ projects, models: MODELS, permissionModes: PERMISSION_MODES });
}
