// Prints each registered project's folder status, branch and worktrees.
import { checkProjects } from "../lib/projects";

async function main() {
  const results = await checkProjects();
  if (!results.length) console.log("No projects registered in mondo.config.json");
  let ok = true;
  for (const p of results) {
    console.log(`\n${p.name}  ${p.path}`);
    if (!p.exists) {
      ok = false;
      console.log("  ✗ folder not found");
      continue;
    }
    console.log(`  branch: ${p.branch ?? "(not a git repo)"}`);
    console.log(`  worktrees (${p.worktrees.length}):`);
    for (const wt of p.worktrees) {
      console.log(`    - ${wt.path}  [${wt.branch ?? `detached ${wt.head?.slice(0, 7) ?? ""}`}]`);
    }
  }
  process.exit(ok ? 0 : 1);
}

main();
