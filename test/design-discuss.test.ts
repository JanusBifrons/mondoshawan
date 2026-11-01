import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { HUMAN, addNode, askQuestion, listOpenQuestions, resolveQuestion, setStage } from "@/lib/design";
import { discussBrief } from "@/lib/design-discuss";

const AGENT = "agent:test";

describe("open design questions", () => {
  it("lists open questions across nodes, blocking first, skipping closed and retired", () => {
    const db = openDb(":memory:");
    const weapons = addNode(db, { project: "Game", title: "Weapons", kind: "system" }, HUMAN);
    const mines = addNode(db, { project: "Game", parentId: weapons.id, title: "Mines" }, HUMAN);
    const old = addNode(db, { project: "Game", title: "Old idea" }, HUMAN);
    const other = addNode(db, { project: "Other", title: "Elsewhere" }, HUMAN);

    askQuestion(db, weapons.id, { text: "How many slots?" }, AGENT);
    askQuestion(db, mines.id, { text: "Can mines be shot down?", blocking: true }, AGENT);
    const done = askQuestion(db, weapons.id, { text: "Answered already" }, AGENT);
    resolveQuestion(db, done.id, "answered", "Yes", HUMAN);
    askQuestion(db, old.id, { text: "On a retired node" }, AGENT);
    setStage(db, old.id, "retired", HUMAN);
    askQuestion(db, other.id, { text: "Other project" }, AGENT);

    const game = listOpenQuestions(db, "Game");
    expect(game.map((q) => q.text)).toEqual(["Can mines be shot down?", "How many slots?"]);
    expect(game[0]).toMatchObject({ project: "Game", nodeTitle: "Mines", blocking: true });
    expect(listOpenQuestions(db)).toHaveLength(3);
  });
});

describe("design discussion brief", () => {
  const project = { name: "EQX-Net", path: "C:/Users/a/eqx-net/eqx-net" };

  it("briefs on one node: how to read it, read-only code, ask before writing", () => {
    const b = discussBrief({ project, node: { id: "n1", path: "Weapons › Mines" }, agentName: "design-mines", mondoPath: "C:\\mondo" });
    expect(b).toContain(`"Weapons › Mines" (id n1)`);
    expect(b).toContain(`npm run -s design -- EQX-Net get '{"node":"n1"}' --as agent:design-mines`);
    expect(b).toContain("don't change any code");
    expect(b).toContain("wait for the owner's OK");
    expect(b).toContain("only the owner does that");
  });

  it("briefs an open discussion to start from the tree and add ideas", () => {
    const b = discussBrief({ project, node: null, agentName: "design-explore", mondoPath: "C:\\mondo" });
    expect(b).toContain("possibly something new");
    expect(b).toContain(`stage "idea"`);
  });
});
