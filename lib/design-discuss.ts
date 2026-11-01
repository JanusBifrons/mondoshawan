import { loadConfig, projectSlug, rootDir, type ProjectConfig } from "./config";
import { toNativePath } from "./paths";

/** Shared helpers for agents that work on the design bible (talks, Regenerate). */

/** Mondo's main checkout: where the design CLI and the real data/mondo.db live. */
export function mondoFolder(): string {
  const mondo = loadConfig().projects.find((p) => projectSlug(p.name) === "mondo");
  return toNativePath(mondo?.path ?? rootDir());
}

/** How agents read the game's merged code, whatever branch the folder has checked out. Pure. */
export function mergedCodeRule(project: ProjectConfig): string {
  const p = toNativePath(project.path);
  return [
    `The game as merged is \`origin/main\` in ${p}. That folder may have another branch checked out, so don't read its working files:`,
    `run \`git -C "${p}" fetch origin\`, list files with \`git -C "${p}" ls-tree -r --name-only origin/main\`, read one with \`git -C "${p}" show origin/main:<path>\`,`,
    `and record the commit as \`git -C "${p}" rev-parse --short origin/main\`.`,
  ].join(" ");
}
