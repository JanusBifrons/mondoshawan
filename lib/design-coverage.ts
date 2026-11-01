import type { ProjectConfig } from "./config";
import type { DB } from "./db";
import { DesignError } from "./design";
import { mergedCodeRule, mondoFolder } from "./design-discuss";
import { jobBrief } from "./design-regenerate";
import { getJobs, type Job } from "./jobs";
import { toNativePath } from "./paths";

/**
 * "Find what's missing": a background job that compares what's actually built in the merged code
 * (and recent merged PRs) with the design tree, and adds a Built node, with Reality written from
 * the code, for each built feature that has no node. Regenerate only refreshes nodes that already
 * exist; this catches what the tree never knew about (the owner's catch, after a day where credits,
 * a wallet and a Research Lab turned out to have no nodes). Run it before a Regenerate sweep.
 */

/** The fixed instruction. Pure, for tests. */
export function coverageInstruction(project: ProjectConfig, agentName: string): string {
  const cli = (args: string) => `npm run -s design -- ${project.name} ${args} --as agent:${agentName}`;
  const p = toNativePath(project.path);
  return [
    `Find what's built in ${project.name} but missing from its design bible, and add it. The owner has approved this, so write without asking.`,
    ``,
    mergedCodeRule(project),
    ``,
    `1. **Read the tree:** \`${cli("tree")}\`. Use \`${cli(`search '{"text":"<key words>"}'`)}\` to check whether a feature is already covered anywhere.`,
    `2. **List what's built:** the merged code's structure (\`git -C "${p}" ls-tree -r --name-only origin/main\`), and the merged pull requests, which name the features (run \`gh pr list --state merged --limit 200 --json number,title,mergedAt\` from ${p}). Read code where a title isn't enough.`,
    `3. **Compare.** A feature is missing when no node covers it, not even as part of a broader node. Something a broader node already covers is NOT missing: list it under "gaps" instead (that node gets refreshed by Regenerate afterwards). Don't create duplicates.`,
    `4. **Add each missing feature** as a Built node under the right parent (\`add_node\` with stage "built"; create a parent with \`ensure\` only if none fits), then write its Reality with \`write_reality\`, with evidence (path:line from the merged code) and the merged commit, following ${mondoFolder()}\\.claude\\skills\\design-survey\\SKILL.md. Plain English that needs zero context; link related nodes with [[Title]]. Link it to the nodes it connects to with \`link\`.`,
    `5. **Note nodes that describe things no longer in the code** under "gone" (don't retire or change them: that's the owner's call).`,
    ``,
    `Keep nodes at the level of a feature or system a designer would talk about, not individual functions. Don't raise questions. When done, return: a summary, the nodes you created (with their parent), the gaps in existing nodes, what's gone, your confidence and any concerns.`,
  ].join("\n");
}

export const COVERAGE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "What you found and added, in plain English." },
    created: { type: "array", items: { type: "string" }, description: "Nodes created, as 'Parent/Title'." },
    gaps: { type: "array", items: { type: "string" }, description: "Existing nodes that are missing part of what's built: 'Node: what's missing'." },
    gone: { type: "array", items: { type: "string" }, description: "Nodes describing things no longer in the code: 'Node: why'." },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    concerns: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "created", "gaps", "gone", "confidence", "concerns"],
  additionalProperties: false,
};

/** Start "Find what's missing" for a project. Follow it at /agents/job/<id>. */
export function startCoverage(_db: DB, project: ProjectConfig): Job {
  if (!project.path) throw new DesignError("this project has no folder to read");
  const mondoPath = mondoFolder();
  const agentName = "coverage";
  return getJobs().start({
    kind: "coverage",
    project: project.name,
    title: `Find what's missing in ${project.name}`,
    prompt: coverageInstruction(project, agentName),
    brief: jobBrief(project, mondoPath, agentName),
    schema: COVERAGE_SCHEMA,
    cwd: mondoPath,
    input: {},
  });
}
