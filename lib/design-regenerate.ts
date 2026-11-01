import type { ProjectConfig } from "./config";
import type { DB } from "./db";
import { DesignError, HUMAN, addSource, resolveNode } from "./design";
import { mergedCodeRule, mondoFolder } from "./design-discuss";
import { getJobs, type Job } from "./jobs";

/**
 * "Regenerate": re-check one or more nodes against the game's merged code and rewrite their
 * Reality in the standard style, with one fixed instruction (so every regeneration is done
 * the same way). It runs as a normal Mondo agent, like a discussion, so it can be watched.
 */

/** The fixed Regenerate instruction. Pure, for tests. */
export function regenerateInstruction(project: ProjectConfig, nodes: { id: string; title: string }[]): string {
  const list = nodes.map((n) => `- "${n.title}" (id ${n.id})`).join("\n");
  return [
    `Regenerate (the owner has approved this, so don't ask before writing). Re-check these ${project.name} design nodes against the game's merged code and rewrite their Reality:`,
    list,
    ``,
    mergedCodeRule(project),
    ``,
    `For each node:`,
    `1. Read its current Reality and links with the design CLI (\`get\`).`,
    `2. Check every claim against the merged code. Fix what's changed, add what's new, and remove what's gone. Say "not implemented" plainly where that's true.`,
    `3. Rewrite it in the standard style: plain English that needs zero context. Open with what the thing is and what it's for, then the detail, then the numbers. No code names, file names or jargon in the prose. Link every mention that has its own node with [[Title]] or [[Parent/Title|label]]. Create a Built node for anything that deserves its own, and link it.`,
    `4. Write it with \`write_reality\`, with evidence (path:line from the merged code) and the merged commit, as .claude/skills/design-survey/SKILL.md describes.`,
    `5. If the behaviour now differs from signed intent, record drift (\`fidelity\`). If something needs a designer's decision, raise a question.`,
    ``,
    `When done, return the result: a short summary of what changed in the game, the nodes you rewrote and created, your confidence (0 to 1) that the new text is accurate and complete, and any concerns (things you couldn't verify or weren't sure about).`,
  ].join("\n");
}

/** How a background job works: nobody is watching, so no questions; finish and report. Pure. */
export function jobBrief(project: ProjectConfig, mondoPath: string, agentName: string): string {
  const cli = (args: string) => `npm run -s design -- ${project.name} ${args} --as agent:${agentName}`;
  return [
    `You are a background job started by Mondo. Nobody is watching and nobody will answer questions: don't ask any, make sensible decisions, finish the task and return the result.`,
    `Work from ${mondoPath}, where the design bible's CLI lives: \`${cli("get '{\"node\":\"<id>\"}'")}\`, \`${cli("tree")}\` and \`npm run -s design -- help\`.`,
    `Follow the design bible's rules in ${mondoPath}\\CLAUDE.md ("Design bible"). Don't change any code.`,
    `Be efficient: read only what you need, and don't re-read files you've already read.`,
  ].join("\n");
}

/** The result every Regenerate job returns (validated by Claude Code). */
export const REGENERATE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "What changed in the game and what you rewrote, in plain English." },
    rewritten: { type: "array", items: { type: "string" }, description: "Titles of nodes whose Reality you rewrote." },
    created: { type: "array", items: { type: "string" }, description: "Titles of nodes you created." },
    confidence: { type: "number", minimum: 0, maximum: 1, description: "How sure you are the new text is accurate and complete." },
    concerns: { type: "array", items: { type: "string" }, description: "Anything you couldn't verify or weren't sure about." },
  },
  required: ["summary", "rewritten", "created", "confidence", "concerns"],
  additionalProperties: false,
};

/** Start a Regenerate job for some nodes. It runs invisibly; follow it at /agents/job/<id>. */
export function startRegenerate(db: DB, project: ProjectConfig, refs: string[]): Job {
  if (!refs.length) throw new DesignError("no nodes to regenerate");
  if (refs.length > 40) throw new DesignError("too many nodes at once (40 max); do it in batches");
  const nodes = refs.map((ref) => {
    const row = resolveNode(db, project.name, ref);
    if (!row) throw new DesignError(`no such design node: ${ref}`, 404);
    return { id: row.id, title: row.title };
  });
  const mondoPath = mondoFolder();
  const job = getJobs().start({
    kind: "regenerate",
    project: project.name,
    title: nodes.length === 1 ? `Regenerate ${nodes[0].title}` : `Regenerate ${nodes.length} nodes`,
    prompt: regenerateInstruction(project, nodes),
    brief: jobBrief(project, mondoPath, "regenerate"),
    schema: REGENERATE_SCHEMA,
    cwd: mondoPath,
    input: { nodes, cwd: mondoPath },
  });
  const when = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  for (const n of nodes) addSource(db, n.id, { ref: `/agents/job/${job.id}`, title: `Regenerated, ${when}` }, HUMAN);
  return job;
}
