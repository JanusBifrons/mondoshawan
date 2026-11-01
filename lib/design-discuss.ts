import { getAgents, type Agent } from "./agents";
import { folderTrusted } from "./claude-trust";
import { loadConfig, projectSlug, rootDir, type ProjectConfig } from "./config";
import type { DB } from "./db";
import { DesignError, HUMAN, addSource, getNodeDetail, getQuestion, resolveNode, setQuestionDiscussion } from "./design";
import { toNativePath } from "./paths";

/**
 * "Talk it through with an agent" on a design node. Starts a Mondo agent (Remote Control,
 * its own Git Bash window) briefed on that node, so the owner can discuss it in the Claude
 * app. The agent runs in Mondo's own folder, where the design CLI lives, and reads the
 * game's code read-only. The conversation is recorded on the node as a link.
 */

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

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "node";

/** The agent's brief: what it's discussing, how to read it, and the rules. Pure, for tests. */
export function discussBrief(opts: {
  project: ProjectConfig;
  /** The node being discussed, or null for an open discussion about the project (e.g. a new idea). */
  node: { id: string; path: string } | null;
  agentName: string;
  mondoPath: string;
  /** Talking through one open question on the node. */
  question?: { id: number; text: string; blocking: boolean } | null;
}): string {
  const { project, node, agentName, mondoPath, question } = opts;
  const cli = (args: string) => `npm run -s design -- ${project.name} ${args} --as agent:${agentName}`;
  return [
    node
      ? `You were started from Mondo's design bible so the owner can talk through one design node with you. They talk to you through the Claude app.`
      : `You were started from Mondo's design bible so the owner can explore part of ${project.name}'s design with you, possibly something new. They talk to you through the Claude app.`,
    node
      ? `The node: "${node.path}" (id ${node.id}) in the ${project.name} design bible. Read it first, from ${mondoPath}: \`${cli(`get '{"node":"${node.id}"}'`)}\`.`
      : `Start by reading the tree, from ${mondoPath}: \`${cli("tree")}\`, then find where their idea fits. A new idea becomes a new node under the right parent, at stage "idea".`,
    `Also useful: \`${cli("tree")}\`, \`${cli("gaps")}\` and \`npm run -s design -- help\`.`,
    `${project.name}'s code is at ${toNativePath(project.path)}. Read it when it helps, but don't change any code: this is a design conversation. ${mergedCodeRule(project)}`,
    `Follow the design bible's rules in ${mondoPath}\\CLAUDE.md ("Design bible"). You can add idea nodes, raise questions, write draft intent, and add chases and links. You can't sign intent or move nodes into canon; only the owner does that.`,
    `Your job is to make sure what's decided fits the rest of the design: check the nodes it connects to, and ask about connecting systems and anywhere you'd otherwise be assuming. Don't silently fill gaps.`,
    `Be sensible and measured. Nothing will be perfect: only raise what changes how the thing works or how it fits with other parts. When the remaining points are small, or a matter of taste, say so, suggest a sensible default, and wrap up rather than digging further into detail.`,
    `Ask the owner questions one at a time, each with options and your recommendation.`,
    `Anything you write to the bible must be plain English that needs zero context, and must link other nodes it mentions with [[Title]] or [[Parent/Title|label]].`,
    `Before writing anything to the bible, say exactly what you'll write and wait for the owner's OK.`,
    ...(question ? questionBrief(question, cli) : []),
  ].join("\n");
}

/** The extra brief when the conversation is about one open question. Pure. */
function questionBrief(q: { id: number; text: string; blocking: boolean }, cli: (args: string) => string): string[] {
  const close = cli(`resolve_question '{"question":${q.id},"outcome":"answered","answer":"<one-line agreed answer>"}'`);
  return [
    `This conversation is about one open design question on that node (question ${q.id}): "${q.text}".`,
    `The owner's first message is their first thoughts on it, not a final answer. Talk it through: say what you think, check it against the nodes it touches (and the code, if built), and ask follow-ups one at a time where it leaves an assumption or affects a connecting system. Aim to settle it in a few exchanges; as soon as what's left is minor or taste, propose wrapping up.`,
    `Once you agree: (1) propose the change to the node's Intent and, after their OK, write it as a draft with \`${cli(`write_intent '{"node":"<id>","text":"..."}'`)}\` (the owner signs it in Mondo);`,
    q.blocking
      ? `(2) this question blocks approval, so only the owner can close it: give them a one-line agreed answer and ask them to paste it and tap "Close with this answer" on the question in Mondo;`
      : `(2) close the question with \`${close}\`;`,
    `(3) raise any new questions the discussion uncovered with \`ask\`. Then tell the owner it's settled and what changed.`,
  ];
}

const OPENER_NODE =
  "Read this node and the nodes around it, then give me a short summary of where it stands and the most important open questions.";
const OPENER_PROJECT = "Give me a short overview of the design as it stands, and ask what I'd like to explore.";

/** Start a design conversation about a node (`nodeRef`), or about the project as a whole (null). */
export function startDiscussion(
  db: DB,
  project: ProjectConfig,
  nodeRef: string | null,
  message: string,
  opts: { name?: string; linkTitle?: string; question?: number } = {},
): Agent {
  let node: { id: string; path: string; title: string } | null = null;
  if (nodeRef) {
    const row = resolveNode(db, project.name, nodeRef);
    if (!row) throw new DesignError("no such design node", 404);
    const detail = getNodeDetail(db, row.id);
    node = { id: row.id, path: detail.path.map((p) => p.title).join(" › "), title: row.title };
  }

  let question: { id: number; text: string; blocking: boolean } | null = null;
  if (opts.question !== undefined) {
    const q = getQuestion(db, opts.question);
    if (!q || (node && q.nodeId !== node.id)) throw new DesignError("no such question on this node", 404);
    if (q.status !== "open") throw new DesignError("that question is already closed");
    if (!node) {
      const detail = getNodeDetail(db, q.nodeId);
      node = { id: q.nodeId, path: detail.path.map((p) => p.title).join(" › "), title: detail.node.title };
    }
    question = { id: q.id, text: q.text, blocking: q.blocking };
  }

  const cwd = mondoFolder();
  if (!folderTrusted(cwd)) {
    throw new DesignError(`Claude hasn't been told to trust ${cwd} yet. At the PC, use Settings → Folder trust, then try again.`, 409);
  }

  const name = opts.name
    ? slugify(opts.name).replace(/^-+/, "") || "agent"
    : question
      ? `q-${slugify(question.text)}`
      : `design-${slugify(node?.title ?? "explore")}`;
  const text = message.trim().slice(0, 20_000);
  const agent = getAgents().spawn({
    name,
    project: project.name,
    cwd,
    worktreeName: null,
    model: null,
    permissionMode: "auto",
    prompt: question
      ? text
        ? `My first thoughts on "${question.text}":\n\n${text}`
        : `Let's talk through this question: "${question.text}". What do you think, and what are the options?`
      : text || (node ? OPENER_NODE : OPENER_PROJECT),
    brief: discussBrief({ project, node, agentName: name, mondoPath: cwd, question }),
  });
  if (question) setQuestionDiscussion(db, question.id, agent.sessionId);

  if (node) {
    const when = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const about = question
      ? `: ${question.text.slice(0, 80)}`
      : text && !opts.linkTitle
        ? `: ${text.split("\n")[0].slice(0, 80)}`
        : "";
    const label = opts.linkTitle ?? (question ? "Question talked through with an agent" : "Conversation with an agent");
    addSource(db, node.id, { ref: `/agents/${agent.sessionId}`, title: `${label}, ${when}${about}` }, HUMAN);
  }
  return agent;
}
