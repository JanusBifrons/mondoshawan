import { loadConfig } from "./config";
import { dirExists, getBranch, listWorktrees, type Worktree } from "./git";

export interface ProjectCheck {
  name: string;
  path: string;
  exists: boolean;
  branch: string | null;
  worktrees: Worktree[];
}

/** Phase 1 proof: for each registered project, check folder, branch and worktrees. */
export async function checkProjects(): Promise<ProjectCheck[]> {
  const { projects } = loadConfig();
  return Promise.all(
    projects.map(async (p) => {
      const exists = dirExists(p.path);
      const [branch, worktrees] = exists
        ? await Promise.all([getBranch(p.path), listWorktrees(p.path)])
        : [null, []];
      return { name: p.name, path: p.path, exists, branch, worktrees };
    }),
  );
}
