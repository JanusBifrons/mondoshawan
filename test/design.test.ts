import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import {
  HUMAN,
  addLink,
  addNode,
  askQuestion,
  bandOf,
  decideReview,
  flagReality,
  gaps,
  getNodeDetail,
  lastEventId,
  listTree,
  resolveNode,
  resolveQuestion,
  setFidelity,
  setStage,
  signIntent,
  updateNode,
  writeRevision,
} from "@/lib/design";

const AGENT = "agent:survey";
const P = "EQX-Net";

function setup() {
  const db = openDb(":memory:");
  const weapons = addNode(db, { project: P, title: "Weapons", kind: "system", stage: "built" }, AGENT);
  const missiles = addNode(db, { project: P, parentId: weapons.id, title: "Missiles", stage: "built" }, AGENT);
  return { db, weapons, missiles };
}

describe("nodes", () => {
  it("builds a tree and resolves title paths", () => {
    const { db, weapons, missiles } = setup();
    const mines = addNode(db, { project: P, parentId: missiles.id, title: "Mines" }, HUMAN);
    expect(mines.stage).toBe("idea");
    expect(resolveNode(db, P, "weapons/MISSILES/mines")?.id).toBe(mines.id);
    expect(resolveNode(db, P, weapons.id)?.id).toBe(weapons.id);
    expect(resolveNode(db, P, "weapons/lasers")).toBeNull();
    expect(getNodeDetail(db, mines.id).path.map((p) => p.title)).toEqual(["Weapons", "Missiles", "Mines"]);
    expect(listTree(db, P)).toHaveLength(3);
  });

  it("refuses canon stages at creation and agent-only limits", () => {
    const { db } = setup();
    expect(() => addNode(db, { project: P, title: "X", stage: "approved" }, HUMAN)).toThrow(/outside canon/);
    expect(() => addNode(db, { project: P, title: "X", stage: "retired" }, HUMAN)).toThrow();
  });

  it("can't move a node under its own descendant", () => {
    const { db, weapons, missiles } = setup();
    expect(() => updateNode(db, weapons.id, { parentId: missiles.id }, HUMAN)).toThrow(/under itself/);
  });
});

describe("intent and reality", () => {
  it("reality is agent-only and clears a flag", () => {
    const { db, missiles } = setup();
    expect(() => writeRevision(db, missiles.id, "reality", { text: "x" }, HUMAN)).toThrow(/agents/);
    flagReality(db, missiles.id, "Missiles also home on asteroids", HUMAN);
    expect(getNodeDetail(db, missiles.id).node.realityFlag).toMatch(/asteroids/);
    writeRevision(db, missiles.id, "reality", { text: "Homing missiles.", evidence: ["src/x.ts:10"], commitSha: "abc" }, AGENT);
    const d = getNodeDetail(db, missiles.id);
    expect(d.node.realityFlag).toBeNull();
    expect(d.reality?.evidence).toEqual(["src/x.ts:10"]);
    expect(d.node.checkedSha).toBe("abc");
  });

  it("intent is a draft until the human signs; agents can't sign", () => {
    const { db, missiles } = setup();
    writeRevision(db, missiles.id, "intent", { text: "v1" }, HUMAN);
    expect(() => signIntent(db, missiles.id, AGENT)).toThrow(/human/);
    signIntent(db, missiles.id, HUMAN);
    writeRevision(db, missiles.id, "intent", { text: "v2 draft" }, AGENT);
    const d = getNodeDetail(db, missiles.id);
    expect(d.canonIntent?.text).toBe("v1");
    expect(d.intent?.text).toBe("v2 draft");
    const t = listTree(db, P).find((n) => n.id === missiles.id)!;
    expect(t.hasCanonIntent).toBe(true);
    expect(t.intentDraft).toBe(true);
  });
});

describe("stages", () => {
  it("canon needs signed intent and no blocking questions", () => {
    const { db } = setup();
    const mines = addNode(db, { project: P, title: "Mines" }, HUMAN);
    expect(() => setStage(db, mines.id, "approved", HUMAN)).toThrow(/sign off/);
    writeRevision(db, mines.id, "intent", { text: "Proximity mines" }, HUMAN);
    signIntent(db, mines.id, HUMAN);
    const q = askQuestion(db, mines.id, { text: "Shields?", blocking: true }, AGENT);
    expect(() => setStage(db, mines.id, "approved", HUMAN)).toThrow(/blocking/);
    expect(() => resolveQuestion(db, q.id, "answered", "yes", AGENT)).toThrow(/human/);
    resolveQuestion(db, q.id, "answered", "Shields absorb half", HUMAN);
    expect(setStage(db, mines.id, "approved", HUMAN).stage).toBe("approved");
  });

  it("agents can't move into or out of canon (except to built)", () => {
    const { db, missiles } = setup();
    expect(() => setStage(db, missiles.id, "approved", AGENT)).toThrow(/agents/);
    writeRevision(db, missiles.id, "intent", { text: "x" }, HUMAN);
    signIntent(db, missiles.id, HUMAN);
    setStage(db, missiles.id, "in_build", HUMAN);
    expect(() => setStage(db, missiles.id, "idea", AGENT)).toThrow(/out of canon/);
    expect(setStage(db, missiles.id, "built", AGENT).stage).toBe("built");
  });

  it("bands run from reality up to ideas", () => {
    expect(bandOf("built")).toBe("ground");
    expect(bandOf("in_build")).toBe("grey");
    expect(bandOf("approved")).toBe("grey");
    expect(bandOf("idea")).toBe("sky");
  });
});

describe("reviews", () => {
  it("drift opens one review; deciding fix_build moves to in_build", () => {
    const { db, missiles } = setup();
    writeRevision(db, missiles.id, "intent", { text: "Missiles home on ships only" }, HUMAN);
    signIntent(db, missiles.id, HUMAN);
    writeRevision(db, missiles.id, "reality", { text: "Missiles home on anything" }, AGENT);
    setFidelity(db, missiles.id, "drifted", "agent:verify", { gap: "Homes on asteroids too" });
    setFidelity(db, missiles.id, "drifted", "agent:verify");
    let d = getNodeDetail(db, missiles.id);
    expect(d.reviews).toHaveLength(1);
    expect(d.reviews[0]).toMatchObject({ status: "open", gap: "Homes on asteroids too" });
    expect(d.reviews[0].intentRev).toBe(d.canonIntent?.id);
    expect(gaps(listTree(db, P)).drifted.map((n) => n.id)).toEqual([missiles.id]);

    expect(() => decideReview(db, d.reviews[0].id, "accept", "", "agent:verify")).toThrow(/human/);
    decideReview(db, d.reviews[0].id, "fix_build", "Target filter missing", HUMAN);
    d = getNodeDetail(db, missiles.id);
    expect(d.node.stage).toBe("in_build");
    expect(d.reviews[0]).toMatchObject({ status: "closed", decision: "fix_build", reason: "Target filter missing" });
  });

  it("accept marks fidelity accepted", () => {
    const { db, missiles } = setup();
    setFidelity(db, missiles.id, "drifted", AGENT, { gap: "g" });
    const r = getNodeDetail(db, missiles.id).reviews[0];
    decideReview(db, r.id, "accept", null, HUMAN);
    expect(getNodeDetail(db, missiles.id).node.fidelity).toBe("accepted");
  });
});

describe("links and events", () => {
  it("links both ways and logs events", () => {
    const { db, weapons, missiles } = setup();
    const before = lastEventId(db, P);
    const shields = addNode(db, { project: P, title: "Shields", kind: "system", stage: "built" }, AGENT);
    addLink(db, { fromId: missiles.id, toId: shields.id, type: "affects" }, AGENT);
    addLink(db, { fromId: missiles.id, toId: shields.id, type: "affects", note: "dup ok" }, AGENT);
    expect(() => addLink(db, { fromId: missiles.id, toId: missiles.id, type: "affects" }, AGENT)).toThrow();
    expect(getNodeDetail(db, shields.id).links).toMatchObject([{ direction: "in", otherTitle: "Missiles", note: "dup ok" }]);
    expect(lastEventId(db, P)).toBeGreaterThan(before);
    expect(weapons).toBeTruthy();
  });
});
