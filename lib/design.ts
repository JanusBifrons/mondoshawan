import crypto from "node:crypto";
import { tx, type DB } from "./db";

/**
 * The design bible: a tree (and web) of design nodes per project.
 *
 * Each node has two versioned texts:
 * - intent: what it should be. Written by the human (or proposed by agents); only a
 *   human can sign a revision, and the latest signed revision is canon.
 * - reality: what the game does today. Factual and written only by agents from the
 *   code, each revision tied to the commit it describes. No sign-off.
 *
 * Stages run from reality up to ideas: built → in_build → approved → proposed → idea,
 * plus retired. When a verify pass finds intent and reality differ ("drifted"), a
 * review opens to decide: fix the build, change the intent, or accept the gap.
 */

import {
  CANON_STAGES,
  FIDELITIES,
  KINDS,
  LINK_TYPES,
  QUESTION_OUTCOMES,
  REVIEW_DECISIONS,
  STAGES,
  type Fidelity,
  type Kind,
  type LinkType,
  type QuestionOutcome,
  type ReviewDecision,
  type Stage,
} from "./design-meta";

export * from "./design-meta";

export type Field = "intent" | "reality";

/** "human", or "agent:<name>" for anything automated. */
export type Actor = string;
export const HUMAN: Actor = "human";
export const isAgent = (a: Actor) => a !== HUMAN;

/** Stages an agent may move a node to. */
const AGENT_STAGES: readonly Stage[] = ["idea", "proposed", "built"];

export class DesignError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const now = () => Date.now();
const newId = () => crypto.randomBytes(6).toString("base64url");

function oneOf<T extends string>(list: readonly T[], v: unknown, what: string): T {
  if (typeof v === "string" && (list as readonly string[]).includes(v)) return v as T;
  throw new DesignError(`${what} must be one of: ${list.join(", ")}`);
}

function text(v: unknown, what: string, max = 50_000): string {
  if (typeof v !== "string" || !v.trim()) throw new DesignError(`${what} is required`);
  if (v.length > max) throw new DesignError(`${what} is too long (max ${max})`);
  return v.trim();
}

// ---------- row types ----------

export interface NodeRow {
  id: string;
  project: string;
  parentId: string | null;
  title: string;
  summary: string;
  kind: Kind;
  stage: Stage;
  fidelity: Fidelity;
  checkedSha: string | null;
  realityFlag: string | null;
  sort: number;
  createdBy: Actor;
  createdAt: number;
  updatedAt: number;
}

export interface TreeNode extends NodeRow {
  hasIntent: boolean;
  /** A signed intent revision exists. */
  hasCanonIntent: boolean;
  /** The latest intent revision isn't signed (a draft sits on top of canon, or no canon yet). */
  intentDraft: boolean;
  hasReality: boolean;
  openQuestions: number;
  blockingQuestions: number;
  openReviews: number;
}

export interface Revision {
  id: number;
  nodeId: string;
  field: Field;
  text: string;
  evidence: string[];
  commitSha: string | null;
  note: string | null;
  author: Actor;
  createdAt: number;
  signedAt: number | null;
  signedBy: Actor | null;
}

export interface Review {
  id: number;
  nodeId: string;
  intentRev: number | null;
  realityRev: number | null;
  gap: string;
  reason: string | null;
  decision: ReviewDecision | null;
  status: "open" | "closed";
  openedBy: Actor;
  openedAt: number;
  closedBy: Actor | null;
  closedAt: number | null;
}

export interface Question {
  id: number;
  nodeId: string;
  text: string;
  blocking: boolean;
  related: string[];
  status: "open" | QuestionOutcome;
  answer: string | null;
  raisedBy: Actor;
  createdAt: number;
  resolvedBy: Actor | null;
  resolvedAt: number | null;
}

export interface Link {
  id: number;
  fromId: string;
  toId: string;
  type: LinkType;
  note: string | null;
  createdBy: Actor;
  createdAt: number;
  /** Title of the node on the other end (relative to the node being viewed). */
  otherTitle?: string;
  direction?: "out" | "in";
}

export interface Source {
  id: number;
  nodeId: string;
  ref: string;
  title: string | null;
  createdBy: Actor;
  createdAt: number;
}

export interface DesignEvent {
  id: number;
  project: string;
  nodeId: string | null;
  at: number;
  actor: Actor;
  type: string;
  detail: Record<string, unknown>;
}

export interface NodeDetail {
  node: NodeRow;
  path: { id: string; title: string }[];
  children: { id: string; title: string; stage: Stage }[];
  /** Latest intent revision (may be an unsigned draft). */
  intent: Revision | null;
  /** Latest signed intent revision. */
  canonIntent: Revision | null;
  reality: Revision | null;
  revisions: Revision[];
  reviews: Review[];
  questions: Question[];
  links: Link[];
  sources: Source[];
  events: DesignEvent[];
}

// ---------- mappers ----------

/* eslint-disable @typescript-eslint/no-explicit-any */
const toNode = (r: any): NodeRow => ({
  id: r.id,
  project: r.project,
  parentId: r.parent_id,
  title: r.title,
  summary: r.summary,
  kind: r.kind,
  stage: r.stage,
  fidelity: r.fidelity,
  checkedSha: r.checked_sha,
  realityFlag: r.reality_flag,
  sort: r.sort,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const parseJson = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

const toRevision = (r: any): Revision => ({
  id: r.id,
  nodeId: r.node_id,
  field: r.field,
  text: r.text,
  evidence: parseJson<string[]>(r.evidence, []),
  commitSha: r.commit_sha,
  note: r.note,
  author: r.author,
  createdAt: r.created_at,
  signedAt: r.signed_at,
  signedBy: r.signed_by,
});

const toReview = (r: any): Review => ({
  id: r.id,
  nodeId: r.node_id,
  intentRev: r.intent_rev,
  realityRev: r.reality_rev,
  gap: r.gap,
  reason: r.reason,
  decision: r.decision,
  status: r.status,
  openedBy: r.opened_by,
  openedAt: r.opened_at,
  closedBy: r.closed_by,
  closedAt: r.closed_at,
});

const toQuestion = (r: any): Question => ({
  id: r.id,
  nodeId: r.node_id,
  text: r.text,
  blocking: !!r.blocking,
  related: parseJson<string[]>(r.related, []),
  status: r.status,
  answer: r.answer,
  raisedBy: r.raised_by,
  createdAt: r.created_at,
  resolvedBy: r.resolved_by,
  resolvedAt: r.resolved_at,
});

const toLink = (r: any): Link => ({
  id: r.id,
  fromId: r.from_id,
  toId: r.to_id,
  type: r.type,
  note: r.note,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

const toEvent = (r: any): DesignEvent => ({
  id: r.id,
  project: r.project,
  nodeId: r.node_id,
  at: r.at,
  actor: r.actor,
  type: r.type,
  detail: parseJson<Record<string, unknown>>(r.detail, {}),
});
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------- reads ----------

export function getNodeRow(db: DB, id: string): NodeRow | null {
  const r = db.prepare("SELECT * FROM design_nodes WHERE id = ?").get(id);
  return r ? toNode(r) : null;
}

function mustNode(db: DB, id: string): NodeRow {
  const n = getNodeRow(db, id);
  if (!n) throw new DesignError(`node ${id} not found`, 404);
  return n;
}

/** Every node in a project, with the flags the tree view needs. */
export function listTree(db: DB, project: string): TreeNode[] {
  const rows = db
    .prepare(
      `SELECT n.*,
        EXISTS (SELECT 1 FROM design_revisions r WHERE r.node_id = n.id AND r.field = 'intent') AS has_intent,
        EXISTS (SELECT 1 FROM design_revisions r WHERE r.node_id = n.id AND r.field = 'intent' AND r.signed_at IS NOT NULL) AS has_canon,
        (SELECT r.signed_at IS NULL FROM design_revisions r WHERE r.node_id = n.id AND r.field = 'intent' ORDER BY r.id DESC LIMIT 1) AS intent_draft,
        EXISTS (SELECT 1 FROM design_revisions r WHERE r.node_id = n.id AND r.field = 'reality') AS has_reality,
        (SELECT COUNT(*) FROM design_questions q WHERE q.node_id = n.id AND q.status = 'open') AS open_q,
        (SELECT COUNT(*) FROM design_questions q WHERE q.node_id = n.id AND q.status = 'open' AND q.blocking = 1) AS blocking_q,
        (SELECT COUNT(*) FROM design_reviews v WHERE v.node_id = n.id AND v.status = 'open') AS open_v
      FROM design_nodes n WHERE n.project = ?
      ORDER BY n.sort, n.created_at`,
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .all(project) as any[];
  return rows.map((r) => ({
    ...toNode(r),
    hasIntent: !!r.has_intent,
    hasCanonIntent: !!r.has_canon,
    intentDraft: !!r.intent_draft,
    hasReality: !!r.has_reality,
    openQuestions: r.open_q,
    blockingQuestions: r.blocking_q,
    openReviews: r.open_v,
  }));
}

function latestRevision(db: DB, nodeId: string, field: Field, signedOnly = false): Revision | null {
  const r = db
    .prepare(
      `SELECT * FROM design_revisions WHERE node_id = ? AND field = ? ${signedOnly ? "AND signed_at IS NOT NULL" : ""}
       ORDER BY id DESC LIMIT 1`,
    )
    .get(nodeId, field);
  return r ? toRevision(r) : null;
}

function pathTo(db: DB, node: NodeRow): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = [];
  const seen = new Set<string>();
  let cur: NodeRow | null = node;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift({ id: cur.id, title: cur.title });
    cur = cur.parentId ? getNodeRow(db, cur.parentId) : null;
  }
  return out;
}

export function getNodeDetail(db: DB, id: string): NodeDetail {
  const node = mustNode(db, id);
  const titleOf = db.prepare("SELECT title FROM design_nodes WHERE id = ?");
  const links = [
    ...db
      .prepare("SELECT * FROM design_links WHERE from_id = ?")
      .all(id)
      .map((r) => {
        const l = toLink(r);
        return { ...l, direction: "out" as const, otherTitle: (titleOf.get(l.toId) as { title: string })?.title };
      }),
    ...db
      .prepare("SELECT * FROM design_links WHERE to_id = ?")
      .all(id)
      .map((r) => {
        const l = toLink(r);
        return { ...l, direction: "in" as const, otherTitle: (titleOf.get(l.fromId) as { title: string })?.title };
      }),
  ];
  return {
    node,
    path: pathTo(db, node),
    children: db
      .prepare("SELECT id, title, stage FROM design_nodes WHERE parent_id = ? ORDER BY sort, created_at")
      .all(id) as NodeDetail["children"],
    intent: latestRevision(db, id, "intent"),
    canonIntent: latestRevision(db, id, "intent", true),
    reality: latestRevision(db, id, "reality"),
    revisions: db.prepare("SELECT * FROM design_revisions WHERE node_id = ? ORDER BY id DESC").all(id).map(toRevision),
    reviews: db.prepare("SELECT * FROM design_reviews WHERE node_id = ? ORDER BY id DESC").all(id).map(toReview),
    questions: db
      .prepare("SELECT * FROM design_questions WHERE node_id = ? ORDER BY status = 'open' DESC, id DESC")
      .all(id)
      .map(toQuestion),
    links,
    sources: db.prepare("SELECT * FROM design_sources WHERE node_id = ? ORDER BY id").all(id) as unknown as Source[],
    events: db.prepare("SELECT * FROM design_events WHERE node_id = ? ORDER BY id DESC LIMIT 100").all(id).map(toEvent),
  };
}

/** Find a node by id, or by a title path like "Weapons/Missiles" (case-insensitive). */
export function resolveNode(db: DB, project: string, ref: string): NodeRow | null {
  const byId = getNodeRow(db, ref);
  if (byId && byId.project === project) return byId;
  const parts = ref.split("/").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!parts.length) return null;
  let parent: string | null = null;
  let found: NodeRow | null = null;
  for (const part of parts) {
    const r = db
      .prepare(
        `SELECT * FROM design_nodes WHERE project = ? AND lower(title) = ? AND ${parent ? "parent_id = ?" : "parent_id IS NULL"}
         ORDER BY created_at LIMIT 1`,
      )
      .get(...([project, part, parent].filter((x) => x !== null) as string[]));
    if (!r) return null;
    found = toNode(r);
    parent = found.id;
  }
  return found;
}

/** Highest event id for a project, used to tell clients something changed. */
export function lastEventId(db: DB, project?: string): number {
  const r = (
    project
      ? db.prepare("SELECT MAX(id) AS m FROM design_events WHERE project = ?").get(project)
      : db.prepare("SELECT MAX(id) AS m FROM design_events").get()
  ) as { m: number | null };
  return r.m ?? 0;
}

export function recentEvents(db: DB, project: string, limit = 50): DesignEvent[] {
  return db
    .prepare("SELECT * FROM design_events WHERE project = ? ORDER BY id DESC LIMIT ?")
    .all(project, limit)
    .map(toEvent);
}

// ---------- writes ----------

function log(db: DB, project: string, nodeId: string | null, actor: Actor, type: string, detail: object = {}) {
  db.prepare("INSERT INTO design_events (project, node_id, at, actor, type, detail) VALUES (?, ?, ?, ?, ?, ?)").run(
    project,
    nodeId,
    now(),
    actor,
    type,
    JSON.stringify(detail),
  );
}

function touch(db: DB, id: string) {
  db.prepare("UPDATE design_nodes SET updated_at = ? WHERE id = ?").run(now(), id);
}

export interface NewNode {
  project: string;
  parentId?: string | null;
  title: string;
  summary?: string;
  kind?: Kind;
  stage?: Stage;
}

export function addNode(db: DB, input: NewNode, actor: Actor): NodeRow {
  const title = text(input.title, "title", 200);
  const kind = input.kind === undefined ? "mechanic" : oneOf(KINDS, input.kind, "kind");
  const stage = input.stage === undefined ? "idea" : oneOf(STAGES, input.stage, "stage");
  if (CANON_STAGES.includes(stage)) throw new DesignError("new nodes start outside canon; approve them after signing intent");
  if (stage === "retired") throw new DesignError("can't create a retired node");
  if (isAgent(actor) && !AGENT_STAGES.includes(stage)) throw new DesignError(`agents can't create ${stage} nodes`, 403);
  if (input.parentId) {
    const parent = mustNode(db, input.parentId);
    if (parent.project !== input.project) throw new DesignError("parent is in another project");
  }
  const id = newId();
  const t = now();
  return tx(db, () => {
    const sort = (
      db
        .prepare(`SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM design_nodes WHERE project = ? AND parent_id IS ?`)
        .get(input.project, input.parentId ?? null) as { s: number }
    ).s;
    db.prepare(
      `INSERT INTO design_nodes (id, project, parent_id, title, summary, kind, stage, sort, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.project, input.parentId ?? null, title, input.summary?.trim() ?? "", kind, stage, sort, actor, t, t);
    log(db, input.project, id, actor, "created", { title, stage, parentId: input.parentId ?? null });
    return mustNode(db, id);
  });
}

export interface NodePatch {
  title?: string;
  summary?: string;
  kind?: Kind;
  parentId?: string | null;
  sort?: number;
}

export function updateNode(db: DB, id: string, patch: NodePatch, actor: Actor): NodeRow {
  const node = mustNode(db, id);
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  const changed: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    sets.push("title = ?");
    vals.push((changed.title = text(patch.title, "title", 200)));
  }
  if (patch.summary !== undefined) {
    if (typeof patch.summary !== "string") throw new DesignError("summary must be a string");
    sets.push("summary = ?");
    vals.push((changed.summary = patch.summary.trim()));
  }
  if (patch.kind !== undefined) {
    sets.push("kind = ?");
    vals.push((changed.kind = oneOf(KINDS, patch.kind, "kind")));
  }
  if (patch.sort !== undefined) {
    if (typeof patch.sort !== "number" || !Number.isFinite(patch.sort)) throw new DesignError("sort must be a number");
    sets.push("sort = ?");
    vals.push(patch.sort);
  }
  if (patch.parentId !== undefined) {
    if (patch.parentId !== null) {
      const parent = mustNode(db, patch.parentId);
      if (parent.project !== node.project) throw new DesignError("parent is in another project");
      // No cycles: the new parent can't be this node or one of its descendants.
      for (const p of pathTo(db, parent)) if (p.id === id) throw new DesignError("can't move a node under itself");
    }
    sets.push("parent_id = ?");
    vals.push((changed.parentId = patch.parentId));
  }
  if (!sets.length) return node;
  return tx(db, () => {
    db.prepare(`UPDATE design_nodes SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...vals, now(), id);
    log(db, node.project, id, actor, "edited", changed);
    return mustNode(db, id);
  });
}

export interface RevisionInput {
  text: string;
  evidence?: string[];
  commitSha?: string | null;
  note?: string | null;
}

/**
 * Add an intent or reality revision.
 * Reality is factual and agent-written only; a new reality clears any "this is wrong"
 * flag and makes fidelity unchecked again (until a verify pass). New intent is a draft
 * until the human signs it.
 */
export function writeRevision(db: DB, nodeId: string, field: Field, input: RevisionInput, actor: Actor): Revision {
  const node = mustNode(db, nodeId);
  if (field !== "intent" && field !== "reality") throw new DesignError("field must be intent or reality");
  if (field === "reality" && !isAgent(actor)) {
    throw new DesignError("reality is written by agents from the code; flag it as wrong instead", 403);
  }
  const body = text(input.text, "text");
  const evidence = Array.isArray(input.evidence) ? input.evidence.filter((e) => typeof e === "string").slice(0, 200) : [];
  return tx(db, () => {
    const r = db
      .prepare(
        `INSERT INTO design_revisions (node_id, field, text, evidence, commit_sha, note, author, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(nodeId, field, body, JSON.stringify(evidence), input.commitSha ?? null, input.note ?? null, actor, now());
    if (field === "reality") {
      db.prepare(
        "UPDATE design_nodes SET reality_flag = NULL, fidelity = 'unchecked', checked_sha = COALESCE(?, checked_sha) WHERE id = ?",
      ).run(input.commitSha ?? null, nodeId);
    }
    touch(db, nodeId);
    log(db, node.project, nodeId, actor, `${field}_written`, { revision: Number(r.lastInsertRowid), commitSha: input.commitSha ?? null });
    return toRevision(db.prepare("SELECT * FROM design_revisions WHERE id = ?").get(r.lastInsertRowid));
  });
}

/** Human sign-off: makes an intent revision (default: the latest) canon. */
export function signIntent(db: DB, nodeId: string, actor: Actor, revisionId?: number): Revision {
  if (isAgent(actor)) throw new DesignError("only the human can sign off intent", 403);
  const node = mustNode(db, nodeId);
  const rev = revisionId
    ? (db.prepare("SELECT * FROM design_revisions WHERE id = ? AND node_id = ? AND field = 'intent'").get(revisionId, nodeId) ?? null)
    : (db.prepare("SELECT * FROM design_revisions WHERE node_id = ? AND field = 'intent' ORDER BY id DESC LIMIT 1").get(nodeId) ?? null);
  if (!rev) throw new DesignError("no intent to sign", 404);
  const r = toRevision(rev);
  if (r.signedAt) return r;
  return tx(db, () => {
    db.prepare("UPDATE design_revisions SET signed_at = ?, signed_by = ? WHERE id = ?").run(now(), actor, r.id);
    // Intent changed: whether the build matches it is unknown until re-verified.
    db.prepare("UPDATE design_nodes SET fidelity = 'unchecked' WHERE id = ?").run(nodeId);
    touch(db, nodeId);
    log(db, node.project, nodeId, actor, "intent_signed", { revision: r.id });
    return toRevision(db.prepare("SELECT * FROM design_revisions WHERE id = ?").get(r.id));
  });
}

/**
 * Move a node between stages.
 * - Agents may only move nodes to idea / proposed / built.
 * - Approved and In build are canon intent: they need signed intent, and no open
 *   blocking questions.
 */
export function setStage(db: DB, nodeId: string, stageIn: unknown, actor: Actor, note?: string): NodeRow {
  const stage = oneOf(STAGES, stageIn, "stage");
  const node = mustNode(db, nodeId);
  if (node.stage === stage) return node;
  if (isAgent(actor) && !AGENT_STAGES.includes(stage)) throw new DesignError(`agents can't move nodes to ${stage}`, 403);
  if (isAgent(actor) && CANON_STAGES.includes(node.stage) && stage !== "built") {
    throw new DesignError("agents can't take a node out of canon", 403);
  }
  if (CANON_STAGES.includes(stage)) {
    if (!latestRevision(db, nodeId, "intent", true)) throw new DesignError("sign off the intent before moving it into canon");
    const blocking = (
      db.prepare("SELECT COUNT(*) AS c FROM design_questions WHERE node_id = ? AND status = 'open' AND blocking = 1").get(nodeId) as {
        c: number;
      }
    ).c;
    if (blocking) throw new DesignError(`${blocking} blocking question${blocking === 1 ? "" : "s"} still open`);
  }
  return tx(db, () => {
    db.prepare("UPDATE design_nodes SET stage = ?, updated_at = ? WHERE id = ?").run(stage, now(), nodeId);
    log(db, node.project, nodeId, actor, "stage", { from: node.stage, to: stage, note: note ?? null });
    return mustNode(db, nodeId);
  });
}

/**
 * Record whether the build matches the intent (normally from a verify agent).
 * "drifted" opens a review if none is open.
 */
export function setFidelity(
  db: DB,
  nodeId: string,
  fidelityIn: unknown,
  actor: Actor,
  opts: { gap?: string; commitSha?: string | null } = {},
): NodeRow {
  const fidelity = oneOf(FIDELITIES, fidelityIn, "fidelity");
  if (fidelity === "accepted") throw new DesignError("a gap is accepted by deciding its review");
  const node = mustNode(db, nodeId);
  return tx(db, () => {
    db.prepare("UPDATE design_nodes SET fidelity = ?, checked_sha = COALESCE(?, checked_sha), updated_at = ? WHERE id = ?").run(
      fidelity,
      opts.commitSha ?? null,
      now(),
      nodeId,
    );
    log(db, node.project, nodeId, actor, "fidelity", { from: node.fidelity, to: fidelity, commitSha: opts.commitSha ?? null });
    if (fidelity === "drifted") {
      const open = db.prepare("SELECT id FROM design_reviews WHERE node_id = ? AND status = 'open'").get(nodeId);
      if (!open) openReviewTx(db, node, opts.gap?.trim() || "Intent and reality differ.", actor);
    }
    return mustNode(db, nodeId);
  });
}

function openReviewTx(db: DB, node: NodeRow, gap: string, actor: Actor): Review {
  const intent = latestRevision(db, node.id, "intent", true) ?? latestRevision(db, node.id, "intent");
  const reality = latestRevision(db, node.id, "reality");
  const r = db
    .prepare(
      `INSERT INTO design_reviews (node_id, intent_rev, reality_rev, gap, opened_by, opened_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(node.id, intent?.id ?? null, reality?.id ?? null, gap, actor, now());
  log(db, node.project, node.id, actor, "review_opened", { review: Number(r.lastInsertRowid), gap });
  return toReview(db.prepare("SELECT * FROM design_reviews WHERE id = ?").get(r.lastInsertRowid));
}

/** Open a review by hand (the human noticed a gap). */
export function openReview(db: DB, nodeId: string, gap: unknown, actor: Actor): Review {
  const node = mustNode(db, nodeId);
  const g = text(gap, "gap", 5000);
  return tx(db, () => openReviewTx(db, node, g, actor));
}

/**
 * The human decides a review:
 * - fix_build: the build should change → node goes (back) to In build.
 * - change_intent: the intent should change → write and sign new intent next.
 * - accept: the gap is fine as it is → fidelity "accepted".
 */
export function decideReview(db: DB, reviewId: number, decisionIn: unknown, reason: unknown, actor: Actor): Review {
  if (isAgent(actor)) throw new DesignError("only the human decides reviews", 403);
  const decision = oneOf(REVIEW_DECISIONS, decisionIn, "decision");
  const row = db.prepare("SELECT * FROM design_reviews WHERE id = ?").get(reviewId);
  if (!row) throw new DesignError(`review ${reviewId} not found`, 404);
  const review = toReview(row);
  if (review.status !== "open") throw new DesignError("review is already closed");
  const node = mustNode(db, review.nodeId);
  const why = typeof reason === "string" && reason.trim() ? reason.trim() : null;
  return tx(db, () => {
    db.prepare("UPDATE design_reviews SET status = 'closed', decision = ?, reason = ?, closed_by = ?, closed_at = ? WHERE id = ?").run(
      decision,
      why,
      actor,
      now(),
      reviewId,
    );
    if (decision === "fix_build" && node.stage !== "in_build" && latestRevision(db, node.id, "intent", true)) {
      db.prepare("UPDATE design_nodes SET stage = 'in_build' WHERE id = ?").run(node.id);
      log(db, node.project, node.id, actor, "stage", { from: node.stage, to: "in_build", note: "review: fix the build" });
    }
    if (decision === "accept") db.prepare("UPDATE design_nodes SET fidelity = 'accepted' WHERE id = ?").run(node.id);
    touch(db, node.id);
    log(db, node.project, node.id, actor, "review_decided", { review: reviewId, decision, reason: why });
    return toReview(db.prepare("SELECT * FROM design_reviews WHERE id = ?").get(reviewId));
  });
}

/** The human says the reality text is wrong; an agent should re-survey it. */
export function flagReality(db: DB, nodeId: string, note: unknown, actor: Actor): NodeRow {
  const node = mustNode(db, nodeId);
  const n = text(note, "note", 5000);
  return tx(db, () => {
    db.prepare("UPDATE design_nodes SET reality_flag = ?, updated_at = ? WHERE id = ?").run(n, now(), nodeId);
    log(db, node.project, nodeId, actor, "reality_flagged", { note: n });
    return mustNode(db, nodeId);
  });
}

export function askQuestion(
  db: DB,
  nodeId: string,
  input: { text: string; blocking?: boolean; related?: string[] },
  actor: Actor,
): Question {
  const node = mustNode(db, nodeId);
  const q = text(input.text, "question", 5000);
  const related = (Array.isArray(input.related) ? input.related : []).filter((id) => {
    const n = typeof id === "string" ? getNodeRow(db, id) : null;
    return n?.project === node.project && n.id !== nodeId;
  });
  return tx(db, () => {
    const r = db
      .prepare(`INSERT INTO design_questions (node_id, text, blocking, related, raised_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(nodeId, q, input.blocking ? 1 : 0, JSON.stringify(related), actor, now());
    touch(db, nodeId);
    log(db, node.project, nodeId, actor, "question_raised", { question: Number(r.lastInsertRowid), blocking: !!input.blocking });
    return toQuestion(db.prepare("SELECT * FROM design_questions WHERE id = ?").get(r.lastInsertRowid));
  });
}

export function resolveQuestion(db: DB, questionId: number, outcomeIn: unknown, answer: unknown, actor: Actor): Question {
  const outcome = oneOf(QUESTION_OUTCOMES, outcomeIn, "outcome");
  const row = db.prepare("SELECT * FROM design_questions WHERE id = ?").get(questionId);
  if (!row) throw new DesignError(`question ${questionId} not found`, 404);
  const q = toQuestion(row);
  if (q.status !== "open") throw new DesignError("question is already resolved");
  // Agents can suggest answers by raising follow-ups, but closing a blocking question is the human's call.
  if (isAgent(actor) && q.blocking) throw new DesignError("only the human can resolve a blocking question", 403);
  const node = mustNode(db, q.nodeId);
  const a = typeof answer === "string" && answer.trim() ? answer.trim() : null;
  if (outcome === "answered" && !a) throw new DesignError("an answer is required");
  return tx(db, () => {
    db.prepare("UPDATE design_questions SET status = ?, answer = ?, resolved_by = ?, resolved_at = ? WHERE id = ?").run(
      outcome,
      a,
      actor,
      now(),
      questionId,
    );
    touch(db, node.id);
    log(db, node.project, node.id, actor, "question_resolved", { question: questionId, outcome });
    return toQuestion(db.prepare("SELECT * FROM design_questions WHERE id = ?").get(questionId));
  });
}

export function addLink(
  db: DB,
  input: { fromId: string; toId: string; type: unknown; note?: string | null },
  actor: Actor,
): Link {
  const type = oneOf(LINK_TYPES, input.type, "link type");
  const from = mustNode(db, input.fromId);
  const to = mustNode(db, input.toId);
  if (from.project !== to.project) throw new DesignError("links stay within a project");
  if (from.id === to.id) throw new DesignError("a node can't link to itself");
  return tx(db, () => {
    db.prepare(
      `INSERT INTO design_links (from_id, to_id, type, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (from_id, to_id, type) DO UPDATE SET note = COALESCE(excluded.note, note)`,
    ).run(from.id, to.id, type, input.note?.trim() || null, actor, now());
    log(db, from.project, from.id, actor, "linked", { to: to.id, type });
    return toLink(db.prepare("SELECT * FROM design_links WHERE from_id = ? AND to_id = ? AND type = ?").get(from.id, to.id, type));
  });
}

export function removeLink(db: DB, linkId: number, actor: Actor): void {
  const row = db.prepare("SELECT * FROM design_links WHERE id = ?").get(linkId);
  if (!row) throw new DesignError(`link ${linkId} not found`, 404);
  const l = toLink(row);
  const from = mustNode(db, l.fromId);
  tx(db, () => {
    db.prepare("DELETE FROM design_links WHERE id = ?").run(linkId);
    log(db, from.project, from.id, actor, "unlinked", { to: l.toId, type: l.type });
  });
}

export function addSource(db: DB, nodeId: string, input: { ref: string; title?: string | null }, actor: Actor): Source {
  const node = mustNode(db, nodeId);
  const ref = text(input.ref, "ref", 2000);
  return tx(db, () => {
    const r = db
      .prepare("INSERT INTO design_sources (node_id, ref, title, created_by, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(nodeId, ref, input.title?.trim() || null, actor, now());
    log(db, node.project, nodeId, actor, "source_added", { ref });
    return db.prepare("SELECT * FROM design_sources WHERE id = ?").get(r.lastInsertRowid) as unknown as Source;
  });
}

// ---------- views ----------

export interface Gaps {
  approvedUnbuilt: TreeNode[];
  drifted: TreeNode[];
  unchecked: TreeNode[];
  flagged: TreeNode[];
  blocking: TreeNode[];
  openReviews: TreeNode[];
}

/** What needs attention: the work list that falls out of the bible. */
export function gaps(tree: TreeNode[]): Gaps {
  const live = tree.filter((n) => n.stage !== "retired");
  return {
    approvedUnbuilt: live.filter((n) => n.stage === "approved"),
    drifted: live.filter((n) => n.fidelity === "drifted"),
    unchecked: live.filter((n) => n.hasCanonIntent && n.hasReality && n.fidelity === "unchecked"),
    flagged: live.filter((n) => n.realityFlag),
    blocking: live.filter((n) => n.blockingQuestions > 0),
    openReviews: live.filter((n) => n.openReviews > 0),
  };
}
