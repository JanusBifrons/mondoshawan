import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { HUMAN, addNode, askQuestion, listOpenQuestions, resolveQuestion, setStage } from "@/lib/design";
import { applyProposal, parseTalkResult, talkBrief } from "@/lib/design-talk";

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

describe("design talk brief", () => {
  const project = { name: "EQX-Net", path: "C:/Users/a/eqx-net/eqx-net" };
  const node = { id: "n1", path: "Weapons › Mines" };
  const brief = (question: { id: number; text: string; blocking: boolean } | null, n: typeof node | null = node) =>
    talkBrief({ project, node: n, question, agentName: "talk-abc", mondoPath: "C:\mondo" });

  it("reads the node, keeps it measured, and can only propose changes", () => {
    const b = brief(null);
    expect(b).toContain(`"Weapons › Mines" (id n1)`);
    expect(b).toContain(`npm run -s design -- EQX-Net get '{"node":"n1"}' --as agent:talk-abc`);
    expect(b).toContain("never change any file");
    expect(b).toContain("matter of taste");
    expect(b).toContain("can't write to the bible yourself");
    expect(b).toContain("only when the owner taps Approve");
    expect(b).toContain("Nothing said in the talk may be lost");
    expect(b).toContain("Break big topics down");
    expect(b).toContain("A new node always gets its Intent in the same proposal");
  });

  it("starts an open talk from the tree", () => {
    expect(brief(null, null)).toContain(`stage "idea"`);
  });

  it("on a question, bundles the Intent change and closing it into one proposal", () => {
    const b = brief({ id: 7, text: "Can mines be shot down?", blocking: true });
    expect(b).toContain(`(question 7): "Can mines be shot down?"`);
    expect(b).toContain(`resolve_question with {"question":7`);
  });
});

describe("talk replies and proposals", () => {
  it("parses the structured reply, including JSON-string args", () => {
    const r = parseTalkResult({
      reply: "Agreed.",
      settled: true,
      proposals: [{ title: "Update Intent", detail: "New text", actions: [{ action: "write_intent", args: '{"node":"n1","text":"x"}' }, { action: "ask", args: "not json" }] }],
    });
    expect(r.reply).toBe("Agreed.");
    expect(r.settled).toBe(true);
    expect(r.proposals[0].actions).toEqual([
      { action: "write_intent", args: { node: "n1", text: "x" } },
      { action: "ask", args: {} },
    ]);
    expect(parseTalkResult(null)).toEqual({ reply: null, proposals: [], settled: false });
  });

  it("applies an approved proposal as the owner, all or nothing", () => {
    const db = openDb(":memory:");
    const project = { name: "Game", path: "/x" };
    const mines = addNode(db, { project: "Game", title: "Mines" }, HUMAN);
    const q = askQuestion(db, mines.id, { text: "Can mines be shot down?", blocking: true }, AGENT);

    // Defaults the node to the talk's node; closes even a blocking question (the owner approved it).
    applyProposal(db, project, { node_id: mines.id }, [
      { action: "write_intent", args: { text: "Mines can be shot down." } },
      { action: "resolve_question", args: { question: q.id, outcome: "answered", answer: "Yes" } },
    ]);
    expect(listOpenQuestions(db, "Game")).toHaveLength(0);

    // A failing step rolls back the earlier ones.
    expect(() =>
      applyProposal(db, project, { node_id: mines.id }, [
        { action: "ask", args: { text: "Rolled back?" } },
        { action: "write_intent", args: { node: "Nope", text: "x" } },
      ]),
    ).toThrow();
    expect(listOpenQuestions(db, "Game")).toHaveLength(0);
  });

  it("refuses changes a talk may not make", () => {
    const db = openDb(":memory:");
    const project = { name: "Game", path: "/x" };
    const n = addNode(db, { project: "Game", title: "Mines" }, HUMAN);
    expect(() => applyProposal(db, project, { node_id: n.id }, [{ action: "sign", args: {} }])).toThrow(/can't "sign"/);
    expect(() => applyProposal(db, project, { node_id: n.id }, [{ action: "add_node", args: { title: "X", stage: "approved" } }])).toThrow(/stage/);
    expect(() => applyProposal(db, project, { node_id: n.id }, [])).toThrow(/nothing to apply/);
  });
});
