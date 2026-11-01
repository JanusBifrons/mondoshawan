import type { ProjectConfig } from "./config";
import type { DB } from "./db";
import { DesignError, listOpenQuestions } from "./design";
import { mergedCodeRule, mondoFolder } from "./design-discuss";
import { jobBrief } from "./design-regenerate";
import { getJobs, type Job } from "./jobs";

export { triageDrops, type TriageDrop } from "./triage-drops";

/**
 * "Check the questions": a background job that reviews every open design question against the
 * owner's rule that questions must earn their place (a real decision, at this stage, not already
 * answered), and lists the ones to drop with reasons. It changes nothing: the owner ticks which
 * to dismiss on the job's page.
 */

/** The fixed instruction. Pure, for tests. */
export function triageInstruction(project: ProjectConfig, questions: { id: number; node: string; text: string }[], agentName: string): string {
  const cli = (args: string) => `npm run -s design -- ${project.name} ${args} --as agent:${agentName}`;
  return [
    `Check these ${questions.length} open design questions for ${project.name} against the owner's rule: a question must earn its place.`,
    ``,
    ...questions.map((q) => `- Question ${q.id} (on "${q.node}"): ${q.text}`),
    ``,
    `**Check every question on its own, one by one; don't judge them from a few broad searches.** For each question: (a) run at least one \`search\` with its own key words; (b) read the node it's on; (c) check its premise against the merged code. Many questions were raised by agents surveying older code. ${mergedCodeRule(project)}`,
    ``,
    `A question should be DROPPED when any of these is true:`,
    `1. **Already answered**: the owner has already decided it somewhere. \`${cli(`search '{"text":"<key words>"}'`)}\` covers every node, Intent, question with its answer, and the owner's own words in design talks. Quote where the answer is.`,
    `2. **Out of date**: the code has changed since it was asked, so its premise is no longer true (e.g. it says something "never heals" but repair now exists). Say what the code does now, with the commit or file.`,
    `3. **A bug, not a design decision**: it describes something broken or unfinished that obviously just needs fixing (a dead-end button, a fake number on screen, a cap that's defined but not enforced). The note should say it's a bug to fix in the build.`,
    `4. **Micro detail**: which items go in a list, exact prices, numbers, limits or tuning, or a tooling or hosting choice rather than game design. That's a default to suggest when it's planned for building, not a decision to ask about now.`,
    `5. **Not a real decision**: asked for the sake of asking, or a duplicate of another open question.`,
    `A question that bundles several things can be dropped if every part falls under these; if one part is a real decision, keep it and say which part in concerns.`,
    ``,
    `Keep a question only if it is a real open design decision that changes how something works or how it fits. When genuinely unsure, keep it, but don't keep things just because checking them is effort.`,
    `You can't change anything (the design CLI is read-only for you). Return the questions to drop, each with the reason and a one-line answer to record when the owner dismisses it, plus a short summary, your confidence and any concerns.`,
  ].join("\n");
}

export const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "In plain English: how many to drop and why, how many are worth keeping." },
    drop: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "number" },
          reason: { type: "string", description: "Why it should go, short and plain: already answered (where), out of date (what the code does now), a bug, micro detail, or not a real decision." },
          answer: { type: "string", description: "The one-line note to record on the question when it's dismissed." },
        },
        required: ["question", "reason", "answer"],
        additionalProperties: false,
      },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    concerns: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "drop", "confidence", "concerns"],
  additionalProperties: false,
};

/** Start the check for one project's open questions. Follow it at /agents/job/<id>. */
export function startTriage(db: DB, project: ProjectConfig): Job {
  const qs = listOpenQuestions(db, project.name);
  if (!qs.length) throw new DesignError("there are no open questions to check");
  const mondoPath = mondoFolder();
  const agentName = "question-check";
  return getJobs().start({
    kind: "triage",
    project: project.name,
    title: `Check ${qs.length} open question${qs.length === 1 ? "" : "s"}`,
    prompt: triageInstruction(
      project,
      qs.map((q) => ({ id: q.id, node: q.nodeTitle, text: q.text })),
      agentName,
    ),
    brief: jobBrief(project, mondoPath, agentName),
    schema: TRIAGE_SCHEMA,
    cwd: mondoPath,
    input: { questions: qs.map((q) => q.id) },
    disallowedTools: ["Edit", "Write", "NotebookEdit"],
    env: { MONDO_DESIGN_READONLY: "1" },
  });
}
