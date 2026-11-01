import { getAgents, type Agent } from "./agents";
import { folderTrusted } from "./claude-trust";
import { loadConfig, projectSlug, rootDir, type ProjectConfig } from "./config";
import type { DB } from "./db";
import { DesignError, HUMAN, addSource, getNodeDetail, resolveNode } from "./design";
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

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "node";

/** The agent's brief: what it's discussing, how to read it, and the rules. Pure, for tests. */
export function discussBrief(opts: {
  project: ProjectConfig;
  /** The node being discussed, or null for an open discussion about the project (e.g. a new idea). */
  node: { id: string; path: string } | null;
  agentName: string;
  mondoPath: string;
}): string {
  const { project, node, agentName, mondoPath } = opts;
  const cli = (args: string) => `npm run -s design -- ${project.name} ${args} --as agent:${agentName}`;
  return [
    node
      ? `You were started from Mondo's design bible so the owner can talk through one design node with you. They talk to you through the Claude app.`
      : `You were started from Mondo's design bible so the owner can explore part of ${project.name}'s design with you, possibly something new. They talk to you through the Claude app.`,
    node
      ? `The node: "${node.path}" (id ${node.id}) in the ${project.name} design bible. Read it first, from ${mondoPath}: \`${cli(`get '{"node":"${node.id}"}'`)}\`.`
      : `Start by reading the tree, from ${mondoPath}: \`${cli("tree")}\`, then find where their idea fits. A new idea becomes a new node under the right parent, at stage "idea".`,
    `Also useful: \`${cli("tree")}\`, \`${cli("gaps")}\` and \`npm run -s design -- help\`.`,
    `${project.name}'s code is at ${toNativePath(project.path)}. Read it when it helps, but don't change any code: this is a design conversation.`,
    `Follow the design bible's rules in ${mondoPath}\\CLAUDE.md ("Design bible"). You can add idea nodes, raise questions, write draft intent, and add chases and links. You can't sign intent or move nodes into canon; only the owner does that.`,
    `Ask the owner questions one at a time, each with options and your recommendation.`,
    `Anything you write to the bible must be plain English that needs zero context, and must link other nodes it mentions with [[Title]] or [[Parent/Title|label]].`,
    `Before writing anything to the bible, say exactly what you'll write and wait for the owner's OK.`,
  ].join("\n");
}

const OPENER_NODE =
  "Read this node and the nodes around it, then give me a short summary of where it stands and the most important open questions.";
const OPENER_PROJECT = "Give me a short overview of the design as it stands, and ask what I'd like to explore.";

/** Start a design conversation about a node (`nodeRef`), or about the project as a whole (null). */
export function startDiscussion(db: DB, project: ProjectConfig, nodeRef: string | null, message: string): Agent {
  let node: { id: string; path: string; title: string } | null = null;
  if (nodeRef) {
    const row = resolveNode(db, project.name, nodeRef);
    if (!row) throw new DesignError("no such design node", 404);
    const detail = getNodeDetail(db, row.id);
    node = { id: row.id, path: detail.path.map((p) => p.title).join(" › "), title: row.title };
  }

  const cwd = mondoFolder();
  if (!folderTrusted(cwd)) {
    throw new DesignError(`Claude hasn't been told to trust ${cwd} yet. At the PC, use Settings → Folder trust, then try again.`, 409);
  }

  const name = `design-${slugify(node?.title ?? "explore")}`;
  const text = message.trim().slice(0, 20_000);
  const agent = getAgents().spawn({
    name,
    project: project.name,
    cwd,
    worktreeName: null,
    model: null,
    permissionMode: "auto",
    prompt: text || (node ? OPENER_NODE : OPENER_PROJECT),
    brief: discussBrief({ project, node, agentName: name, mondoPath: cwd }),
  });

  if (node) {
    const when = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const about = text ? `: ${text.split("\n")[0].slice(0, 80)}` : "";
    addSource(db, node.id, { ref: `/agents/${agent.sessionId}`, title: `Conversation with an agent, ${when}${about}` }, HUMAN);
  }
  return agent;
}
