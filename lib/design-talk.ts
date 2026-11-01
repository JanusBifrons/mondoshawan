import crypto from "node:crypto";
import type { ProjectConfig } from "./config";
import { tx, type DB } from "./db";
import { DesignError, HUMAN, addSource, getNodeDetail, getQuestion, resolveNode, setQuestionDiscussion } from "./design";
import { runAction } from "./design-actions";
import { mergedCodeRule, mondoFolder } from "./design-discuss";
import { getJobs, type Job } from "./jobs";
import { toNativePath } from "./paths";

/**
 * Design talks: a conversation with an agent inside Mondo (the owner's choice: no window, no
 * Claude app). Each owner message is one turn, run as a background job (`claude -p`) that
 * carries on the same Claude session (`--resume`). The agent can only read the bible (the
 * design CLI is read-only for it); changes come back as proposals, and Mondo applies one only
 * when the owner taps Approve.
 */

export interface TalkAction {
  action: string;
  args: Record<string, unknown>;
}

export interface Proposal {
  title: string;
  /** Why, in a line or two. The card shows the actions themselves (exactly what gets saved). */
  detail: string;
  actions: TalkAction[];
  /** The owner's decision, if made. */
  status: "pending" | "approved" | "skipped" | "failed";
  error: string | null;
}

export interface TalkTurn {
  id: number;
  /** What the owner said (or the opening request). */
  text: string;
  createdAt: number;
  jobId: string | null;
  status: "thinking" | "done" | "failed" | "stopped";
  /** While thinking: the latest step (e.g. "Read the Regions node"). */
  progress: string | null;
  reply: string | null;
  proposals: Proposal[];
  settled: boolean;
  error: string | null;
  tokens: number | null;
  durationMs: number | null;
}

export interface Talk {
  id: string;
  project: string;
  nodeId: string | null;
  nodeTitle: string | null;
  questionId: number | null;
  questionText: string | null;
  sessionId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  turns: TalkTurn[];
}

/** Changes a talk may propose. Never sign, canon stages, reviews or reality: those stay the owner's or the code's. */
export const PROPOSAL_ACTIONS = [
  "write_intent",
  "ask",
  "resolve_question",
  "add_node",
  "ensure",
  "update_node",
  "link",
  "priority",
  "chase",
  "flag",
  "source",
] as const;

/** The structured reply every talk turn returns. */
export const TALK_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "What you say to the owner, in plain English. Markdown allowed. Short." },
    proposals: {
      type: "array",
      description: "Changes to the design bible you want the owner to approve. Empty if none this turn.",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "One line, e.g. 'Update the Regions Intent'." },
          detail: { type: "string", description: "One or two lines on why. The card shows the actions themselves." },
          actions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                action: { type: "string", enum: [...PROPOSAL_ACTIONS] },
                args: { type: "string", description: "The design CLI's JSON arguments for this action, as a JSON object string." },
              },
              required: ["action", "args"],
              additionalProperties: false,
            },
          },
        },
        required: ["title", "detail", "actions"],
        additionalProperties: false,
      },
    },
    settled: { type: "boolean", description: "True when nothing important is left to discuss." },
  },
  required: ["reply", "proposals", "settled"],
  additionalProperties: false,
};

/** The talk agent's brief, sent with every turn. Pure, for tests. */
export function talkBrief(opts: {
  project: ProjectConfig;
  node: { id: string; path: string } | null;
  question: { id: number; text: string; blocking: boolean } | null;
  agentName: string;
  mondoPath: string;
}): string {
  const { project, node, question, agentName, mondoPath } = opts;
  const cli = (args: string) => `npm run -s design -- ${project.name} ${args} --as agent:${agentName}`;
  return [
    `You are in a design conversation with the owner of ${project.name}, inside Mondo (their design bible app). Each reply you give is shown in Mondo's chat, and they answer there.`,
    node
      ? `It's about the design node "${node.path}" (id ${node.id}). Read it first, from ${mondoPath}: \`${cli(`get '{"node":"${node.id}"}'`)}\`.`
      : `It's about ${project.name}'s design as a whole, possibly something new. Read the tree first, from ${mondoPath}: \`${cli("tree")}\`. A new idea becomes a new node under the right parent, at stage "idea".`,
    question
      ? `Specifically, one open design question on that node (question ${question.id}): "${question.text}". The owner's first message is their first thoughts on it, not a final answer.`
      : ``,
    `Also useful: \`${cli("tree")}\`, \`${cli("gaps")}\`. The design CLI is read-only for you.`,
    `${project.name}'s code is at ${toNativePath(project.path)}. Read it when it helps; never change any file. ${mergedCodeRule(project)}`,
    `Your job is to make sure what's decided fits the rest of the design: check the nodes it connects to, and ask about connecting systems and anywhere you'd otherwise be assuming. Don't silently fill gaps.`,
    `Be sensible and measured. Nothing will be perfect: only raise what changes how the thing works or how it fits with other parts. When the remaining points are small, or a matter of taste, say so, suggest a sensible default, and wrap up rather than digging further into detail.`,
    `Replies: plain English, no jargon or code names, and to the point. Ask at most one question per reply, with options and your recommendation.`,
    `The bible is the record; this chat is not kept anywhere else. Nothing said in the talk may be lost: every fact, figure, option, decision, constraint and open question that came up (from the owner or from you) must end up in the bible, in a node's Intent, a question or a to-do. Replies can be brief, but proposals must be thorough.`,
    `Break big topics down. Something large (e.g. "going live") is several distinct parts: propose a parent node and a few child nodes, one per distinct part, each with its own full Intent: what it is and what it's for, what's decided, the options and figures discussed (with caveats like "unverified"), what it depends on, and what's still open. Intent can be long and structured (short headings and bullets); thorough beats short. Concrete next steps become to-dos ("chase": {"node","text","due":"YYYY-MM-DD","waiting_on":"you"|"you_at_pc"|"agent"|"other"}); open choices become questions ("ask") on the node they belong to; links between nodes ("link") where one affects another.`,
    `You can't write to the bible yourself. To change it, add proposals. Each proposal is a one-line title, "detail" (one or two lines on why: the card shows the actions themselves, so don't repeat them there), and the actions to apply it (action + its design-CLI arguments as a JSON object string, e.g. {"node":"${node?.id ?? "<id>"}","text":"..."}). Allowed actions: ${PROPOSAL_ACTIONS.join(", ")}. A new node always gets its Intent in the same proposal: add_node, then write_intent with the new node's title path as "node" (e.g. "Parent/New node"). Use one proposal per node or distinct change, so the owner can approve them one by one. Mondo applies a proposal only when the owner taps Approve, and tells you at the start of their next message what they approved or skipped. Don't re-propose something they skipped unless they ask.`,
    `Anything you propose must be plain English that needs zero context, and must link other nodes it mentions with [[Title]] or [[Parent/Title|label]]. Intent is a draft until the owner signs it; never propose stages beyond "idea" or "proposed".`,
    question
      ? `When you agree on the answer, put it all in one proposal: the Intent change (write_intent) and closing the question (resolve_question with {"question":${question.id},"outcome":"answered","answer":"<one-line agreed answer>"}). Raise new questions the talk uncovered with "ask".`
      : ``,
    `Set "settled" to true once nothing important is left.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Parse a turn's structured result into reply + proposals. Pure. */
export function parseTalkResult(result: Record<string, unknown> | null): { reply: string | null; proposals: Omit<Proposal, "status" | "error">[]; settled: boolean } {
  if (!result) return { reply: null, proposals: [], settled: false };
  const proposals = (Array.isArray(result.proposals) ? result.proposals : []).flatMap((p) => {
    if (!p || typeof p !== "object") return [];
    const x = p as Record<string, unknown>;
    const actions: TalkAction[] = (Array.isArray(x.actions) ? x.actions : []).flatMap((a) => {
      if (!a || typeof a !== "object") return [];
      const y = a as Record<string, unknown>;
      let args: Record<string, unknown> = {};
      if (typeof y.args === "string") {
        try {
          const parsed = JSON.parse(y.args);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed;
        } catch {
          /* leave empty: applying will fail with a clear message */
        }
      } else if (y.args && typeof y.args === "object") args = y.args as Record<string, unknown>;
      return typeof y.action === "string" ? [{ action: y.action, args }] : [];
    });
    return [{ title: String(x.title ?? "Proposed change"), detail: String(x.detail ?? ""), actions }];
  });
  return { reply: typeof result.reply === "string" ? result.reply : null, proposals, settled: result.settled === true };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

function talkRow(db: DB, id: string): Row {
  const r = db.prepare("SELECT * FROM design_talks WHERE id = ?").get(id);
  if (!r) throw new DesignError("no such talk", 404);
  return r;
}

function talkContext(db: DB, project: ProjectConfig, talk: Row) {
  let node: { id: string; path: string } | null = null;
  if (talk.node_id) {
    const d = getNodeDetail(db, talk.node_id);
    node = { id: talk.node_id, path: d.path.map((p) => p.title).join(" › ") };
  }
  const q = talk.question_id ? getQuestion(db, talk.question_id) : null;
  const question = q ? { id: q.id, text: q.text, blocking: q.blocking } : null;
  return { node, question };
}

/** What the owner did with the last turn's proposals, told to the agent at the start of the next turn. */
function decisionsNote(db: DB, talkId: string): string {
  const last = db
    .prepare("SELECT job_id FROM design_talk_turns WHERE talk_id = ? AND job_id IS NOT NULL ORDER BY id DESC LIMIT 1")
    .get(talkId) as { job_id: string } | undefined;
  if (!last) return "";
  const job = getJobs().get(last.job_id);
  const { proposals } = parseTalkResult(job?.result ?? null);
  if (!proposals.length) return "";
  const decided = new Map(
    (db.prepare("SELECT idx, status, error FROM design_talk_decisions WHERE job_id = ?").all(last.job_id) as Row[]).map((d) => [d.idx, d]),
  );
  const lines = proposals.map((p, i) => {
    const d = decided.get(i);
    const what = !d ? "not decided yet" : d.status === "failed" ? `approved, but applying it failed: ${d.error}` : d.status;
    return `- "${p.title}": ${what}`;
  });
  return `[Mondo: your proposals from last time]\n${lines.join("\n")}\n\n`;
}

function runTurn(db: DB, project: ProjectConfig, talk: Row, text: string, first: boolean): Job {
  const { node, question } = talkContext(db, project, talk);
  const mondoPath = mondoFolder();
  const agentName = `talk-${talk.id}`;
  const prompt = first ? text : decisionsNote(db, talk.id) + text;
  const job = getJobs().start({
    kind: "talk",
    project: project.name,
    title: `Talk: ${talk.title}`,
    prompt,
    brief: talkBrief({ project, node, question, agentName, mondoPath }),
    schema: TALK_SCHEMA,
    cwd: mondoPath,
    input: { talkId: talk.id },
    ...(first ? { sessionId: talk.session_id } : { resume: talk.session_id }),
    disallowedTools: ["Edit", "Write", "NotebookEdit"],
    env: { MONDO_DESIGN_READONLY: "1" },
  });
  const now = Date.now();
  db.prepare("INSERT INTO design_talk_turns (talk_id, text, job_id, created_at) VALUES (?, ?, ?, ?)").run(talk.id, text, job.id, now);
  db.prepare("UPDATE design_talks SET updated_at = ?, closed_at = NULL WHERE id = ?").run(now, talk.id);
  return job;
}

/** Start a talk about a node, one of its questions, or the project as a whole. */
export function startTalk(
  db: DB,
  project: ProjectConfig,
  opts: { node?: string | null; question?: number; message?: string },
): Talk {
  let nodeId: string | null = null;
  let title = `${project.name} design`;
  let question: { id: number; text: string } | null = null;
  if (opts.question !== undefined) {
    const q = getQuestion(db, opts.question);
    if (!q) throw new DesignError("no such question", 404);
    if (q.status !== "open") throw new DesignError("that question is already closed");
    nodeId = q.nodeId;
    question = { id: q.id, text: q.text };
  } else if (opts.node) {
    const row = resolveNode(db, project.name, opts.node);
    if (!row) throw new DesignError("no such design node", 404);
    nodeId = row.id;
  }
  if (nodeId) {
    const d = getNodeDetail(db, nodeId);
    if (d.node.project !== project.name) throw new DesignError("that node is in another project", 400);
    title = question ? question.text : d.node.title;
  }

  const id = crypto.randomBytes(5).toString("hex");
  const now = Date.now();
  db.prepare(
    "INSERT INTO design_talks (id, project, node_id, question_id, session_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, project.name, nodeId, question?.id ?? null, crypto.randomUUID(), title.slice(0, 200), now, now);
  const talk = talkRow(db, id);

  const text = (opts.message ?? "").trim().slice(0, 20_000);
  const opener = question
    ? text
      ? `My first thoughts on "${question.text}":\n\n${text}`
      : `Let's talk through this question: "${question.text}". What do you think, and what are the options?`
    : text || (nodeId ? "Give me a short summary of where this stands and the most important open questions." : "Give me a short overview of the design as it stands, and ask what I'd like to explore.");
  runTurn(db, project, talk, opener, true);

  if (question) setQuestionDiscussion(db, question.id, id);
  if (nodeId) {
    const when = new Date(now).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    addSource(db, nodeId, { ref: `/design/talk/${id}`, title: `Design talk, ${when}: ${title.slice(0, 80)}` }, HUMAN);
  }
  return getTalk(db, id);
}

/** The owner's next message. Refused while the agent is still thinking. */
export function say(db: DB, project: ProjectConfig, talkId: string, text: string): Talk {
  const talk = talkRow(db, talkId);
  const body = text.trim().slice(0, 20_000);
  if (!body) throw new DesignError("say something first");
  const t = getTalk(db, talkId);
  if (t.turns.some((x) => x.status === "thinking")) throw new DesignError("the agent is still thinking", 409);
  runTurn(db, project, talk, body, false);
  return getTalk(db, talkId);
}

/** Stop the turn that's thinking. */
export function stopTalk(db: DB, talkId: string): Talk {
  for (const t of getTalk(db, talkId).turns) if (t.status === "thinking" && t.jobId) getJobs().stop(t.jobId);
  return getTalk(db, talkId);
}

/** Approve (apply) or skip one proposal. Applied as the owner, but only the allowed kinds of change. */
export function decide(db: DB, project: ProjectConfig, talkId: string, jobId: string, idx: number, approve: boolean): Talk {
  const talk = talkRow(db, talkId);
  const turn = db.prepare("SELECT 1 FROM design_talk_turns WHERE talk_id = ? AND job_id = ?").get(talkId, jobId);
  if (!turn) throw new DesignError("no such reply in this talk", 404);
  const p = parseTalkResult(getJobs().get(jobId)?.result ?? null).proposals[idx];
  if (!p) throw new DesignError("no such proposal", 404);
  if (db.prepare("SELECT 1 FROM design_talk_decisions WHERE job_id = ? AND idx = ?").get(jobId, idx)) {
    throw new DesignError("already decided");
  }
  let status: "approved" | "skipped" | "failed" = approve ? "approved" : "skipped";
  let error: string | null = null;
  if (approve) {
    try {
      applyProposal(db, project, talk, p.actions);
    } catch (e) {
      status = "failed";
      error = (e as Error).message;
    }
  }
  db.prepare("INSERT INTO design_talk_decisions (job_id, idx, talk_id, status, error, decided_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    jobId,
    idx,
    talkId,
    status,
    error,
    Date.now(),
  );
  db.prepare("UPDATE design_talks SET updated_at = ? WHERE id = ?").run(Date.now(), talkId);
  return getTalk(db, talkId);
}

/** Check every action first, then apply them all in one transaction (all or nothing). */
export function applyProposal(db: DB, project: ProjectConfig, talk: { node_id: string | null }, actions: TalkAction[]) {
  if (!actions.length) throw new DesignError("this proposal has nothing to apply");
  for (const a of actions) {
    if (!(PROPOSAL_ACTIONS as readonly string[]).includes(a.action)) throw new DesignError(`a talk can't "${a.action}"`, 403);
    const stage = a.args.stage;
    if (stage !== undefined && stage !== "idea" && stage !== "proposed") throw new DesignError(`a talk can't set stage "${stage}"`, 403);
  }
  tx(db, () => {
    for (const a of actions) {
      const args = { ...a.args };
      if (args.node === undefined && talk.node_id && a.action !== "resolve_question" && a.action !== "add_node" && a.action !== "ensure") {
        args.node = talk.node_id;
      }
      runAction(db, project.name, { ...args, action: a.action }, HUMAN);
    }
  });
}

function turnView(db: DB, r: Row): TalkTurn {
  const job = r.job_id ? getJobs().get(r.job_id) : null;
  const parsed = parseTalkResult(job?.result ?? null);
  const decided = new Map(
    (db.prepare("SELECT idx, status, error FROM design_talk_decisions WHERE job_id = ?").all(r.job_id ?? "") as Row[]).map((d) => [d.idx, d]),
  );
  const status: TalkTurn["status"] = !job ? "failed" : job.status === "running" ? "thinking" : job.status === "done" ? "done" : job.status;
  return {
    id: r.id,
    text: r.text,
    createdAt: r.created_at,
    jobId: r.job_id,
    status,
    progress: job?.status === "running" ? job.progress : null,
    reply: parsed.reply ?? (job?.status === "done" ? job.summary : null),
    proposals: parsed.proposals.map((p, i) => ({ ...p, status: decided.get(i)?.status ?? "pending", error: decided.get(i)?.error ?? null })),
    settled: parsed.settled,
    error: job?.error ?? (job ? null : "This reply's record is missing."),
    tokens: job && job.status !== "running" ? (job.inputTokens ?? 0) + (job.outputTokens ?? 0) + (job.cacheWriteTokens ?? 0) : null,
    durationMs: job?.durationMs ?? null,
  };
}

export function getTalk(db: DB, id: string): Talk {
  const t = talkRow(db, id);
  const node = t.node_id ? (db.prepare("SELECT title FROM design_nodes WHERE id = ?").get(t.node_id) as Row) : null;
  const q = t.question_id ? getQuestion(db, t.question_id) : null;
  return {
    id: t.id,
    project: t.project,
    nodeId: t.node_id,
    nodeTitle: node?.title ?? null,
    questionId: t.question_id,
    questionText: q?.text ?? null,
    sessionId: t.session_id,
    title: t.title,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    closedAt: t.closed_at,
    turns: (db.prepare("SELECT * FROM design_talk_turns WHERE talk_id = ? ORDER BY id").all(id) as Row[]).map((r) => turnView(db, r)),
  };
}

/** Recent talks (one project, or all), newest first, for the design pages. */
export function listTalks(db: DB, project?: string, limit = 20): { id: string; project: string; title: string; nodeId: string | null; updatedAt: number }[] {
  return (
    db
      .prepare(`SELECT id, project, title, node_id, updated_at FROM design_talks ${project ? "WHERE project = ?" : ""} ORDER BY updated_at DESC LIMIT ?`)
      .all(...(project ? [project, limit] : [limit])) as Row[]
  ).map((r) => ({ id: r.id, project: r.project, title: r.title, nodeId: r.node_id, updatedAt: r.updated_at }));
}

