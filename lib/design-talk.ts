import crypto from "node:crypto";
import type { ProjectConfig } from "./config";
import { tx, type DB } from "./db";
import { DesignError, HUMAN, addSource, getNodeDetail, getQuestion, resolveNode, setQuestionDiscussion, setStage, signIntent } from "./design";
import { runAction } from "./design-actions";
import { LINK_TYPES } from "./design-meta";
import { mergedCodeRule, mondoFolder } from "./design-discuss";
import { cachedChanges } from "./design-freshness";
import { startRegenerate } from "./design-regenerate";
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
  /**
   * locked = approved (Intent signed, stage approved: to be added to the game);
   * idea = approved as an idea (saved, stays an idea, not for development without review);
   * revise = the owner asked for a tweak (a corrected card follows); approved = saved as a draft (older talks).
   */
  status: "pending" | "locked" | "idea" | "revise" | "approved" | "skipped" | "failed";
  /** The owner's tweak, when they asked for a revision. */
  note: string | null;
  error: string | null;
}

export interface TalkTurn {
  id: number;
  /** What the owner said (or the opening request). */
  text: string;
  /** Sent by Mondo after the owner decided a card ("Approved X"), so the talk carries on by itself. */
  auto: boolean;
  createdAt: number;
  jobId: string | null;
  status: "thinking" | "done" | "failed" | "stopped";
  /** While thinking: the latest step (e.g. "Read the Regions node"). */
  progress: string | null;
  reply: string | null;
  proposals: Proposal[];
  /** Further proposals the agent made this turn that Mondo held back (one card at a time). */
  held: number;
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
  // Not a bible write: re-check nodes' Reality against the merged code (starts a Regenerate job).
  "regenerate",
] as const;

/** The structured reply every talk turn returns. */
export const TALK_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "What you say to the owner, in plain English. Markdown allowed. Short." },
    proposals: {
      type: "array",
      description: "At most ONE: the node for the aspect that's now solid. Empty during discovery and while an aspect is still being discussed.",
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
    settled: { type: "boolean", description: "True when every aspect in the plan is locked down or dropped." },
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
  /** Which nodes' Reality is out of date against the merged code (from lib/design-freshness). */
  stale?: { against: string | null; titles: string[] } | null;
}): string {
  const { project, node, question, agentName, mondoPath, stale } = opts;
  const cli = (args: string) => `npm run -s design -- ${project.name} ${args} --as agent:${agentName}`;
  const p = toNativePath(project.path);
  return [
    `You are in a design conversation with the owner of ${project.name}, inside Mondo (their design bible app). Each reply you give is shown in Mondo's chat, and they answer there.`,
    node
      ? `It's about the design node "${node.path}" (id ${node.id}). Read it first, from ${mondoPath}: \`${cli(`get '{"node":"${node.id}"}'`)}\`.`
      : `It's about ${project.name}'s design as a whole, possibly something new. Read the tree first, from ${mondoPath}: \`${cli("tree")}\`. A new idea becomes a new node under the right parent, at stage "idea".`,
    question
      ? `Specifically, one open design question on that node (question ${question.id}): "${question.text}". The owner's first message is their first thoughts on it, not a final answer.`
      : ``,
    `Also useful: \`${cli("tree")}\`, \`${cli("gaps")}\`. The design CLI is read-only for you.`,
    `${project.name}'s code is at ${p}. Read it when it helps; never change any file. ${mergedCodeRule(project)}`,
    `**The bible can be out of date; the merged code and its history are the truth.** Before you tell the owner what exists or how something works today, check it against the merged code, not just the bible.`,
    stale && stale.titles.length
      ? `Mondo has checked: these nodes' code has changed since their Reality was written (merged code: ${stale.against ?? "origin/main"}), so treat their Reality as possibly wrong: ${stale.titles.join(", ")}. Nodes with no Reality were never checked against the code at all.`
      : `Nodes with no Reality were never checked against the code, so don't take their Intent as a description of what's built.`,
    `**When the owner says something already exists** ("we've done that", "that's built", "we designed that already"), or contradicts the bible, stop: don't argue from the bible. Verify first and look for the objective truth: search the merged code (\`git -C "${p}" grep -n -i "<term>" origin/main\`), its history (\`git -C "${p}" log origin/main --oneline -40\`, \`git -C "${p}" log origin/main -i --oneline -G "<term>"\`), merged pull requests (run \`gh pr list --state merged --limit 30 --search "<term>"\` from ${p}), and the bible's other nodes. Then reply with what's actually true, citing the evidence (file paths, commit ids, PR numbers), and say plainly where the bible was wrong. Never guess: if you can't find it, say so and what you searched.`,
    `When the bible turns out to be wrong, fix it through a proposal: a stale Reality gets re-checked ("regenerate": {"nodes":["<node>", ...]}, which runs a background job that rewrites Reality from the merged code), and an Intent that no longer matches what was decided gets a corrected write_intent. Then carry on from the truth.`,
    `**Work in two phases, at the owner's pace. Never rush to proposals.**`,
    `**1. Discovery.** First understand the idea through back-and-forth: what the owner wants and why, how big it is, what's in and out of scope, what already exists (read the bible and the code), and what it touches. Ask one question per reply, with options and your recommendation, and play back your understanding as it firms up. Propose nothing in this phase. Keep it proportionate: a small idea may need one or two exchanges, a large one several.`,
    `**2. Lock-down, one aspect at a time.** This is requirements gathering. When the scope is clear, set out the plan in your reply: the aspects to settle, in logical order (foundations first), each a likely node; small ideas may be a single aspect. That plan is the requirements list. Get the owner's OK on it. Then take the aspects in order. Where the requirement is already clear, go straight to proposing that one node, filling in minor details yourself as stated defaults. Discuss only when the requirement is unclear, or when something really needs rethinking (rare): one question at a time, then propose. Wait for the owner to lock each node in before starting the next. Start each reply in this phase with where you are, e.g. "Aspect 2 of 5: Deploy path".`,
    `**At most one proposal per reply,** and only for an aspect that has been discussed and is solid enough to build from. Mondo shows only one card at a time. The owner decides each card: **Approve** (to be added to the game: saved, Intent signed, stage approved), **Approve as idea** (a good idea, saved but kept as an idea: not for development without further review), a **tweak** to one part (nothing saved; make exactly that change, keep the rest, and propose the corrected card), or **Skip**. That's their call, not yours. After each decision Mondo sends you a turn straight away: carry on with the next aspect without waiting to be asked.`,
    `**What a proposed node holds:** a developed design, not notes: concrete statements of how it works (rules, flows, states, numbers, limits, edge cases, connections), so the owner can point at one part and say "that's wrong". Write the Intent as one or two sentences on what it is and what it's for, then short headed sections such as "How it works", "Rules", "Numbers", "Connections" ([[links]] to other nodes), "Not in scope" and "Why". Fold in everything the owner said about this aspect, so nothing is lost; mark figures you couldn't verify as estimates. The talk itself is kept and linked from every node it shapes, as the raw notes.`,
    `Check fit as you go: make each aspect consistent with the nodes it connects to; if it changes another node, say so and make that its own aspect. Be measured: settle what matters to how it works and fits, and leave pure taste (colours, wording, tuning numbers) as a stated default. Know when to stop: once the remaining points are small, say so and wrap up.`,
    `A proposal holds one node: its add_node (if new; list a parent before its children, across turns), its write_intent, and only the to-dos ("chase": {"node","text","due":"YYYY-MM-DD","waiting_on":"you"|"you_at_pc"|"agent"|"other"}), questions ("ask") and links ("link": {"from","to","type"}, type one of ${LINK_TYPES.join(", ")}) that belong to it. Give it a one-line title (the node's name), "detail" (one line on why: the card shows the actions themselves) and the actions (action + its design-CLI arguments as a JSON object string, e.g. {"node":"${node?.id ?? "<id>"}","text":"..."}). Allowed actions: ${PROPOSAL_ACTIONS.join(", ")}. A new node's write_intent uses its title path as "node" (e.g. "Parent/New node"). You can't write to the bible yourself: Mondo applies a proposal only when the owner approves it (either way), and tells you at the start of the next turn what they did with it. Don't re-propose something they skipped unless they ask; when they ask for a change, propose the corrected node.`,
    `Replies: plain English, no jargon or code names, short and conversational. The design goes in the proposal, not the reply.`,
    `Anything you propose must be plain English that needs zero context, and must link other nodes it mentions with [[Title]] or [[Parent/Title|label]]. Never propose stages beyond "idea" or "proposed"; approving is the owner's.`,
    question
      ? `This talk is about one question, so it is usually a single aspect: discuss it, then propose the Intent change together with closing the question (resolve_question with {"question":${question.id},"outcome":"answered","answer":"<one-line agreed answer>"}) in one proposal.`
      : ``,
    `Set "settled" to true once nothing important is left.`,
  ]
    .filter(Boolean)
    .join("\n");
}

type RawProposal = Omit<Proposal, "status" | "error" | "note">;

/** Which node an action is about: the last part of its title path (or its id). Null when it isn't about one node. */
function actionNode(a: TalkAction): string | null {
  const str = (k: string) => (typeof a.args[k] === "string" ? (a.args[k] as string).trim() : "");
  let ref = "";
  if (a.action === "add_node") ref = str("title");
  else if (a.action === "ensure") ref = str("path");
  else if (a.action === "link") ref = str("from");
  else if (a.action !== "resolve_question") ref = str("node");
  const last = ref.split("/").map((s) => s.trim()).filter(Boolean).at(-1);
  return last ? last.toLowerCase() : null;
}

/**
 * One proposal per node (the owner's rule: each part can be approved or skipped on its own).
 * An agent that bundles several nodes into one proposal gets it split here, keeping order, so
 * parents still come before children. Actions about no particular node stay with the first. Pure.
 */
export function splitByNode(p: RawProposal): RawProposal[] {
  const groups: { key: string | null; actions: TalkAction[]; name: string | null }[] = [];
  for (const a of p.actions) {
    const key = actionNode(a);
    let g = key === null ? groups[0] : groups.find((x) => x.key === key);
    if (!g) {
      g = { key, actions: [], name: null };
      groups.push(g);
    }
    g.actions.push(a);
    if (a.action === "add_node" && typeof a.args.title === "string") g.name = a.args.title;
    else if (!g.name && a.action === "write_intent" && typeof a.args.node === "string" && a.args.node.includes("/")) {
      g.name = a.args.node.split("/").at(-1)!.trim();
    }
  }
  if (groups.length <= 1) return [p];
  const lastPart = (v: unknown) => (typeof v === "string" ? v.split("/").at(-1)!.trim() : "");
  const fallback = (g: (typeof groups)[number]) => {
    const a = g.actions[0];
    if (g.actions.every((x) => x.action === "link")) return `Link: ${lastPart(a.args.from)} → ${lastPart(a.args.to)}`;
    const node = lastPart(a.args.node);
    return node ? `Changes to ${node}` : null;
  };
  return groups.map((g, i) => ({
    title: g.name
      ? `${g.actions.some((a) => a.action === "add_node") ? "New: " : ""}${g.name}`
      : i === 0
        ? p.title
        : (fallback(g) ?? `${p.title} (part ${i + 1})`),
    detail: i === 0 ? p.detail : "",
    actions: g.actions,
  }));
}

/** Parse a turn's structured result into reply + proposals. Pure. */
export function parseTalkResult(result: Record<string, unknown> | null): {
  reply: string | null;
  proposals: RawProposal[];
  held: number;
  settled: boolean;
} {
  if (!result) return { reply: null, proposals: [], held: 0, settled: false };
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
    return splitByNode({ title: String(x.title ?? "Proposed change"), detail: String(x.detail ?? ""), actions });
  });
  // One card at a time (the owner's rule): anything beyond the first is held back, and the agent is told.
  return {
    reply: typeof result.reply === "string" ? result.reply : null,
    proposals: proposals.slice(0, 1),
    held: Math.max(0, proposals.length - 1),
    settled: result.settled === true,
  };
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
  const { proposals, held } = parseTalkResult(job?.result ?? null);
  const heldNote = held
    ? `[Mondo: you proposed ${held + 1} nodes at once; only the first was shown. Take the rest one aspect at a time, after discussing each.]\n`
    : "";
  if (!proposals.length) return heldNote ? heldNote + "\n" : "";
  const decided = new Map(
    (db.prepare("SELECT idx, status, error, note FROM design_talk_decisions WHERE job_id = ?").all(last.job_id) as Row[]).map((d) => [d.idx, d]),
  );
  const lines = proposals.map((p, i) => {
    const d = decided.get(i);
    const what = !d
      ? "not decided yet (the owner replied instead: take their reply into account)"
      : d.status === "failed"
        ? `the owner tried to save it, but it failed: ${d.error}`
        : d.status === "locked"
          ? "APPROVED by the owner: saved, Intent signed, to be added to the game"
          : d.status === "idea"
            ? "approved AS AN IDEA by the owner: saved and kept at stage idea (a good idea, but not for development without further review)"
            : d.status === "revise"
              ? `NOT saved: the owner wants a tweak: "${d.note}"`
              : d.status === "approved"
                ? "saved as a draft by the owner"
                : "skipped by the owner";
    return `- "${p.title}": ${what}`;
  });
  return `${heldNote}[Mondo: your proposal from last time]\n${lines.join("\n")}\n\n`;
}

/** Does the owner seem to be saying "we've already done / built / designed that"? Pure. */
export function soundsAlreadyDone(text: string): boolean {
  return /\b(already|we('ve| have) (done|built|made|designed|got|added|merged|shipped)|(is|was|it's|that's|thats) (built|done|merged|live|shipped|in the game)|exists?|out of date|stale|outdated)\b/i.test(text);
}

/** The last reply stopped (e.g. Mondo restarted mid-reply): ask again, without the owner retyping it. */
export function retryTalk(db: DB, project: ProjectConfig, talkId: string): Talk {
  const talk = talkRow(db, talkId);
  const last = getTalk(db, talkId).turns.at(-1);
  if (!last || (last.status !== "failed" && last.status !== "stopped")) throw new DesignError("the last reply didn't fail, so there's nothing to retry");
  runTurn(db, project, talk, "Try again", false, {
    auto: true,
    prompt: `Your last reply was interrupted before it finished. What I'd said was:

${last.text}

Please answer it now.`,
  });
  return getTalk(db, talkId);
}

/** "Check against the code": the owner asks the agent to stop and verify against the objective truth. */
export function verifyTalk(db: DB, project: ProjectConfig, talkId: string): Talk {
  const talk = talkRow(db, talkId);
  if (getTalk(db, talkId).turns.some((t) => t.status === "thinking")) throw new DesignError("the agent is still thinking", 409);
  runTurn(db, project, talk, "Check this against the code", false, {
    auto: true,
    prompt:
      "Stop and check what we've been discussing against the objective truth: the merged code, its history and merged pull requests (not just the bible). Reply with what's actually true and the evidence (file paths, commit ids, PR numbers), say plainly where the bible or what you told me earlier was wrong, and propose the fixes (regenerate stale Reality, or correct the Intent).",
  });
  return getTalk(db, talkId);
}

/**
 * Run one turn. `text` is what the chat shows; `opts.prompt` replaces it as the instruction
 * (for turns Mondo sends after a decision), and `opts.auto` marks such a turn.
 */
function runTurn(db: DB, project: ProjectConfig, talk: Row, text: string, first: boolean, opts: { prompt?: string; auto?: boolean } = {}): Job {
  const { node, question } = talkContext(db, project, talk);
  const mondoPath = mondoFolder();
  const agentName = `talk-${talk.id}`;
  const body = opts.prompt ?? text;
  const hint = !opts.auto && soundsAlreadyDone(text)
    ? "[Mondo: the owner may be saying this already exists or was already decided. Verify against the merged code, its history and merged PRs before answering, and cite what you find.]\n\n"
    : "";
  const prompt = first ? hint + text : decisionsNote(db, talk.id) + hint + body;
  const fresh = cachedChanges(project);
  const stale = fresh ? { against: fresh.against, titles: fresh.changed.map((c) => c.title) } : null;
  const job = getJobs().start({
    kind: "talk",
    project: project.name,
    title: `Talk: ${talk.title}`,
    prompt,
    brief: talkBrief({ project, node, question, agentName, mondoPath, stale }),
    schema: TALK_SCHEMA,
    cwd: mondoPath,
    input: { talkId: talk.id },
    ...(first ? { sessionId: talk.session_id } : { resume: talk.session_id }),
    disallowedTools: ["Edit", "Write", "NotebookEdit"],
    env: { MONDO_DESIGN_READONLY: "1" },
  });
  const now = Date.now();
  db.prepare("INSERT INTO design_talk_turns (talk_id, text, job_id, created_at, auto) VALUES (?, ?, ?, ?, ?)").run(
    talk.id,
    text,
    job.id,
    now,
    opts.auto ? 1 : 0,
  );
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
/**
 * The owner's decision on a card:
 *  - approve: to be added to the game (Intent signed, stage approved);
 *  - idea: a good idea, saved but kept at stage idea (not for development without review);
 *  - revise: not saved; the agent makes the owner's tweak and proposes the card again;
 *  - skip: dropped. ("draft" is kept for older pages.)
 * Every decision except a failed save starts the agent's next turn straight away.
 */
export type Decision = "approve" | "idea" | "revise" | "skip" | "draft";

export function decide(
  db: DB,
  project: ProjectConfig,
  talkId: string,
  jobId: string,
  idx: number,
  decision: Decision,
  note?: string,
): Talk {
  const talk = talkRow(db, talkId);
  const tweak = (note ?? "").trim().slice(0, 5000);
  if (decision === "revise" && !tweak) throw new DesignError("say what to change first");
  if (getTalk(db, talkId).turns.some((t) => t.status === "thinking")) throw new DesignError("the agent is still thinking", 409);
  const turn = db.prepare("SELECT 1 FROM design_talk_turns WHERE talk_id = ? AND job_id = ?").get(talkId, jobId);
  if (!turn) throw new DesignError("no such reply in this talk", 404);
  const p = parseTalkResult(getJobs().get(jobId)?.result ?? null).proposals[idx];
  if (!p) throw new DesignError("no such proposal", 404);
  const prior = db.prepare("SELECT status FROM design_talk_decisions WHERE job_id = ? AND idx = ?").get(jobId, idx) as { status: string } | undefined;
  if (prior && prior.status !== "failed") throw new DesignError("already decided");
  // A failed save can be decided again (retry, tweak or skip).
  if (prior) db.prepare("DELETE FROM design_talk_decisions WHERE job_id = ? AND idx = ?").run(jobId, idx);
  let status: Proposal["status"] =
    decision === "skip"
      ? "skipped"
      : decision === "approve"
        ? "locked"
        : decision === "idea"
          ? "idea"
          : decision === "revise"
            ? "revise"
            : "approved";
  let error: string | null = null;
  if (decision === "approve" || decision === "idea" || decision === "draft") {
    try {
      applyProposal(db, project, talk, p.actions, { approve: decision === "approve", idea: decision === "idea" });
    } catch (e) {
      status = "failed";
      error = (e as Error).message;
    }
  }
  db.prepare(
    "INSERT INTO design_talk_decisions (job_id, idx, talk_id, status, error, decided_at, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(jobId, idx, talkId, status, error, Date.now(), decision === "revise" ? tweak : null);
  db.prepare("UPDATE design_talks SET updated_at = ? WHERE id = ?").run(Date.now(), talkId);

  // Carry on without the owner having to say "next".
  if (status !== "failed") {
    if (status === "revise") {
      runTurn(db, project, talk, `Tweak to "${p.title}": ${tweak}`, false, {
        prompt: "Make that tweak to the card, keep everything else as it was, and propose the corrected card.",
      });
    } else {
      const label = status === "locked" ? `Approved "${p.title}"` : status === "idea" ? `Approved "${p.title}" as an idea` : status === "skipped" ? `Skipped "${p.title}"` : `Saved "${p.title}" as a draft`;
      runTurn(db, project, talk, label, false, {
        auto: true,
        prompt: "Carry on: move to the next aspect in the plan, or wrap up briefly if that was the last one.",
      });
    }
  }
  return getTalk(db, talkId);
}

/** Check every action first, then apply them all in one transaction (all or nothing). */
export function applyProposal(
  db: DB,
  project: ProjectConfig,
  talk: { id?: string; node_id: string | null },
  actions: TalkAction[],
  opts: { approve?: boolean; idea?: boolean } = {},
) {
  if (!actions.length) throw new DesignError("this proposal has nothing to apply");
  if (opts.approve && !actions.some((a) => a.action === "write_intent" || a.action === "regenerate")) {
    throw new DesignError("there's no Intent in this card to approve; approve it as an idea instead");
  }
  for (const a of actions) {
    if (!(PROPOSAL_ACTIONS as readonly string[]).includes(a.action)) throw new DesignError(`a talk can't "${a.action}"`, 403);
    const stage = a.args.stage;
    if (stage !== undefined && stage !== "idea" && stage !== "proposed") throw new DesignError(`a talk can't set stage "${stage}"`, 403);
  }
  // Check re-check targets up front, so a bad node name fails the card before anything is written.
  const creates = actions.some((a) => a.action === "add_node" || a.action === "ensure");
  for (const a of actions) {
    if (a.action !== "regenerate" || creates) continue;
    const refs = Array.isArray(a.args.nodes) ? a.args.nodes : typeof a.args.node === "string" ? [a.args.node] : [];
    if (!refs.length) throw new DesignError("re-check needs the nodes to check");
    for (const ref of refs) if (typeof ref !== "string" || !resolveNode(db, project.name, ref)) throw new DesignError(`no such node to re-check: ${String(ref)}`, 404);
  }
  tx(db, () => {
    for (const a of actions) {
      if (a.action === "regenerate") continue; // started after the bible writes (below)
      const args = { ...a.args };
      // Agents sometimes leave a link's type out; "affects" is the safe default rather than failing the card.
      if (a.action === "link" && (typeof args.type !== "string" || !(LINK_TYPES as readonly string[]).includes(args.type))) args.type = "affects";
      if (args.node === undefined && talk.node_id && a.action !== "resolve_question" && a.action !== "add_node" && a.action !== "ensure") {
        args.node = talk.node_id;
      }
      runAction(db, project.name, { ...args, action: a.action }, HUMAN);
    }
    const touched = touchedNodes(db, project, talk, actions);
    // The talk is the notes behind every node it shaped.
    if (talk.id) {
      const ref = "/design/talk/" + talk.id;
      for (const id of touched) {
        if (db.prepare("SELECT 1 FROM design_sources WHERE node_id = ? AND ref = ?").get(id, ref)) continue;
        addSource(db, id, { ref, title: "Design talk (the notes behind this)" }, HUMAN);
      }
    }
    for (const id of touched) {
      const stage = getNodeDetail(db, id).node.stage;
      if (opts.approve) {
        // Approved: to be added to the game. The owner signs the Intent and the node moves to "approved".
        if (!actions.some((a) => a.action === "write_intent" && nodeRef(a, talk) && resolveNode(db, project.name, nodeRef(a, talk)!)?.id === id)) continue;
        signIntent(db, id, HUMAN);
        if (!["approved", "in_build", "built"].includes(stage)) setStage(db, id, "approved", HUMAN);
      } else if (opts.idea && stage === "proposed") {
        // Approved as an idea: kept as an idea, not for development without further review.
        setStage(db, id, "idea", HUMAN);
      }
    }
  });
  // Re-check stale Reality: a background Regenerate job for the named nodes (after the writes succeeded).
  const toCheck = actions
    .filter((a) => a.action === "regenerate")
    .flatMap((a) => (Array.isArray(a.args.nodes) ? a.args.nodes : typeof a.args.node === "string" ? [a.args.node] : []))
    .filter((n): n is string => typeof n === "string" && !!n.trim());
  if (toCheck.length) startRegenerate(db, project, [...new Set(toCheck)]);
}

const nodeRef = (a: TalkAction, talk: { node_id: string | null }) => (typeof a.args.node === "string" ? a.args.node : talk.node_id);

/** The nodes a proposal created or rewrote (its new nodes and Intents), by id. */
function touchedNodes(db: DB, project: ProjectConfig, talk: { node_id: string | null }, actions: TalkAction[]): string[] {
  const str = (a: TalkAction, k: string) => (typeof a.args[k] === "string" ? (a.args[k] as string) : "");
  const refs = actions.flatMap((a) => {
    if (a.action === "write_intent") return [nodeRef(a, talk) ?? ""];
    if (a.action === "ensure") return [str(a, "path")];
    if (a.action === "add_node") {
      const parent = str(a, "parent");
      const parentNode = parent ? resolveNode(db, project.name, parent) : null;
      if (!parentNode) return [str(a, "title")];
      const path = getNodeDetail(db, parentNode.id).path.map((p) => p.title);
      return [[...path, str(a, "title")].join("/")];
    }
    return [];
  });
  const ids = new Set<string>();
  for (const r of refs) {
    const n = r ? resolveNode(db, project.name, r) : null;
    if (n) ids.add(n.id);
  }
  return [...ids];
}

function turnView(db: DB, r: Row): TalkTurn {
  const job = r.job_id ? getJobs().get(r.job_id) : null;
  const parsed = parseTalkResult(job?.result ?? null);
  const decided = new Map(
    (db.prepare("SELECT idx, status, error, note FROM design_talk_decisions WHERE job_id = ?").all(r.job_id ?? "") as Row[]).map((d) => [d.idx, d]),
  );
  const status: TalkTurn["status"] = !job ? "failed" : job.status === "running" ? "thinking" : job.status === "done" ? "done" : job.status;
  return {
    id: r.id,
    text: r.text,
    auto: !!r.auto,
    createdAt: r.created_at,
    jobId: r.job_id,
    status,
    progress: job?.status === "running" ? job.progress : null,
    reply: parsed.reply ?? (job?.status === "done" ? job.summary : null),
    held: parsed.held,
    proposals: parsed.proposals.map((p, i) => ({ ...p, status: decided.get(i)?.status ?? "pending", error: decided.get(i)?.error ?? null, note: decided.get(i)?.note ?? null })),
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

