import type { DB } from "./db";
import {
  DesignError,
  addLink,
  addNode,
  addSource,
  askQuestion,
  decideReview,
  flagReality,
  gaps,
  getNodeDetail,
  listTree,
  openReview,
  removeLink,
  resolveNode,
  resolveQuestion,
  setFidelity,
  setStage,
  signIntent,
  updateNode,
  writeRevision,
  type Actor,
  type Kind,
  type Stage,
} from "./design";

/**
 * One entry point for every design-bible action, shared by the web API (actor is
 * always "human") and the agent CLI (actor is always "agent:<name>"), so the rules in
 * lib/design.ts apply the same way to both.
 *
 * Node references can be ids or title paths ("Weapons/Missiles").
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type ActionInput = { action: string } & Record<string, any>;

export const ACTIONS = [
  "tree",
  "get",
  "gaps",
  "ensure",
  "add_node",
  "update_node",
  "write_intent",
  "write_reality",
  "sign",
  "stage",
  "fidelity",
  "flag",
  "ask",
  "resolve_question",
  "open_review",
  "decide_review",
  "link",
  "unlink",
  "source",
] as const;

function nodeId(db: DB, project: string, ref: unknown, what = "node"): string {
  if (typeof ref !== "string" || !ref.trim()) throw new DesignError(`${what} is required`);
  const n = resolveNode(db, project, ref);
  if (!n) throw new DesignError(`${what} "${ref}" not found`, 404);
  return n.id;
}

function optNodeId(db: DB, project: string, ref: unknown, what: string): string | null {
  return ref === undefined || ref === null || ref === "" ? null : nodeId(db, project, ref, what);
}

function num(v: unknown, what: string): number {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n)) throw new DesignError(`${what} must be an id number`);
  return n;
}

export function runAction(db: DB, project: string, input: ActionInput, actor: Actor): unknown {
  const a = input ?? ({} as ActionInput);
  switch (a.action) {
    case "tree":
      return listTree(db, project);
    case "get":
      return getNodeDetail(db, nodeId(db, project, a.node));
    case "gaps": {
      const g = gaps(listTree(db, project));
      const brief = (list: { id: string; title: string; stage: Stage }[]) => list.map(({ id, title, stage }) => ({ id, title, stage }));
      return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, brief(v)]));
    }

    case "ensure": {
      // Create any missing nodes along a title path, e.g. "Weapons/Missiles/Homing".
      // Existing nodes are left as they are; new ones get `stage`/`kind` (the last
      // segment also gets `summary`).
      if (typeof a.path !== "string" || !a.path.trim()) throw new DesignError("path is required");
      const parts = a.path.split("/").map((s: string) => s.trim()).filter(Boolean);
      let parent: string | null = null;
      let created = 0;
      for (let i = 0; i < parts.length; i++) {
        const sub = parts.slice(0, i + 1).join("/");
        const found = resolveNode(db, project, sub);
        if (found) {
          parent = found.id;
          continue;
        }
        const last = i === parts.length - 1;
        parent = addNode(
          db,
          {
            project,
            parentId: parent,
            title: parts[i],
            stage: a.stage as Stage | undefined,
            kind: (last ? a.kind : (a.parentKind ?? "system")) as Kind | undefined,
            summary: last ? a.summary : undefined,
          },
          actor,
        ).id;
        created++;
      }
      return { id: parent, created };
    }

    case "add_node":
      return addNode(
        db,
        {
          project,
          parentId: optNodeId(db, project, a.parent, "parent"),
          title: a.title,
          summary: a.summary,
          kind: a.kind,
          stage: a.stage,
        },
        actor,
      );

    case "update_node":
      return updateNode(
        db,
        nodeId(db, project, a.node),
        {
          title: a.title,
          summary: a.summary,
          kind: a.kind,
          sort: a.sort,
          parentId: a.parent === undefined ? undefined : optNodeId(db, project, a.parent, "parent"),
        },
        actor,
      );

    case "write_intent":
      return writeRevision(db, nodeId(db, project, a.node), "intent", { text: a.text, note: a.note }, actor);

    case "write_reality":
      return writeRevision(
        db,
        nodeId(db, project, a.node),
        "reality",
        { text: a.text, evidence: a.evidence, commitSha: a.commit, note: a.note },
        actor,
      );

    case "sign":
      return signIntent(db, nodeId(db, project, a.node), actor, a.revision === undefined ? undefined : num(a.revision, "revision"));

    case "stage":
      return setStage(db, nodeId(db, project, a.node), a.stage, actor, a.note);

    case "fidelity":
      return setFidelity(db, nodeId(db, project, a.node), a.fidelity, actor, { gap: a.gap, commitSha: a.commit });

    case "flag":
      return flagReality(db, nodeId(db, project, a.node), a.note, actor);

    case "ask":
      return askQuestion(
        db,
        nodeId(db, project, a.node),
        {
          text: a.text,
          blocking: !!a.blocking,
          related: (Array.isArray(a.related) ? a.related : []).map((r: unknown) => nodeId(db, project, r, "related node")),
        },
        actor,
      );

    case "resolve_question":
      return resolveQuestion(db, num(a.question, "question"), a.outcome, a.answer, actor);

    case "open_review":
      return openReview(db, nodeId(db, project, a.node), a.gap, actor);

    case "decide_review":
      return decideReview(db, num(a.review, "review"), a.decision, a.reason, actor);

    case "link":
      return addLink(
        db,
        { fromId: nodeId(db, project, a.from, "from"), toId: nodeId(db, project, a.to, "to"), type: a.type, note: a.note },
        actor,
      );

    case "unlink":
      removeLink(db, num(a.link, "link"), actor);
      return { ok: true };

    case "source":
      return addSource(db, nodeId(db, project, a.node), { ref: a.ref, title: a.title }, actor);

    default:
      throw new DesignError(`unknown action "${a.action}". Actions: ${ACTIONS.join(", ")}`);
  }
}
