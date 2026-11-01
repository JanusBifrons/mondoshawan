import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { HUMAN, addNode, askQuestion, listOpenQuestions, resolveQuestion, setStage } from "@/lib/design";
import { applyProposal, parseTalkResult, splitByNode, talkBrief } from "@/lib/design-talk";


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
    expect(b).toContain("leave pure taste");
    expect(b).toContain("can't write to the bible yourself");
    expect(b).toContain("only when the owner approves it");
    expect(b).toContain("Approve as idea");
    expect(b).toContain("carry on with the next aspect without waiting to be asked");
    expect(b).toContain("1. Discovery.");
    expect(b).toContain("Propose nothing in this phase");
    expect(b).toContain("Lock-down, one aspect at a time");
    expect(b).toContain("This is requirements gathering");
    expect(b).toContain("At most one proposal per reply");
    expect(b).toContain("a developed design, not notes");
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
    expect(parseTalkResult(null)).toEqual({ reply: null, proposals: [], held: 0, settled: false, choices: [] });
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

  it("gives a link with no type the default 'affects' instead of failing the card", () => {
    const db = openDb(":memory:");
    const project = { name: "Game", path: "/x" };
    addNode(db, { project: "Game", title: "Ships" }, HUMAN);
    const names = addNode(db, { project: "Game", title: "Ship names" }, HUMAN);
    applyProposal(db, project, { node_id: names.id }, [{ action: "link", args: { from: "Ship names", to: "Ships" } }]);
    expect(db.prepare("SELECT type FROM design_links").get()).toEqual({ type: "affects" });
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

describe("one proposal per node", () => {
  it("splits a bundled proposal by node, keeping order and grouping each node's actions", () => {
    const parts = splitByNode({
      title: "Going live plan",
      detail: "why",
      actions: [
        { action: "write_intent", args: { node: "Game/Going live", text: "overview" } },
        { action: "add_node", args: { title: "Costs", parent: "Game/Going live" } },
        { action: "write_intent", args: { node: "Game/Going live/Costs", text: "costs" } },
        { action: "add_node", args: { title: "Deploys", parent: "Game/Going live" } },
        { action: "chase", args: { node: "Game/Going live/Costs", text: "check prices", due: "2026-11-08" } },
        { action: "write_intent", args: { node: "Game/Going live/Deploys", text: "deploys" } },
        { action: "link", args: { from: "Game/Going live/Deploys", to: "Game/Going live/Costs", type: "affects" } },
      ],
    });
    expect(parts.map((p) => p.title)).toEqual(["Going live", "New: Costs", "New: Deploys"]);
    expect(parts[1].actions.map((a) => a.action)).toEqual(["add_node", "write_intent", "chase"]);
    expect(parts[2].actions.map((a) => a.action)).toEqual(["add_node", "write_intent", "link"]);
    expect(parts[0].detail).toBe("why");
  });

  it("names a split-off link by what it links", () => {
    const parts = splitByNode({
      title: "New: Performance bar",
      detail: "",
      actions: [
        { action: "add_node", args: { title: "Performance bar", parent: "Going live" } },
        { action: "link", args: { from: "Going live/Deploy path", to: "Going live/Test servers", type: "depends_on" } },
      ],
    });
    expect(parts.map((p) => p.title)).toEqual(["New: Performance bar", "Link: Deploy path → Test servers"]);
  });

  it("leaves a one-node proposal alone", () => {
    const p = { title: "Mines", detail: "", actions: [{ action: "write_intent", args: { node: "Mines", text: "x" } }, { action: "resolve_question", args: { question: 1, outcome: "answered" } }] };
    expect(splitByNode(p)).toEqual([p]);
  });

  it("links the talk from every node a proposal creates or rewrites", () => {
    const db = openDb(":memory:");
    const project = { name: "Game", path: "/x" };
    const live = addNode(db, { project: "Game", title: "Going live" }, HUMAN);
    applyProposal(db, project, { id: "t1", node_id: null }, [
      { action: "add_node", args: { title: "Costs", parent: live.id, stage: "idea" } },
      { action: "write_intent", args: { node: "Going live/Costs", text: "A budget." } },
    ]);
    const rows = db.prepare("SELECT n.title, s.ref FROM design_sources s JOIN design_nodes n ON n.id = s.node_id").all() as { title: string; ref: string }[];
    expect(rows).toEqual([{ title: "Costs", ref: "/design/talk/t1" }]);
  });
});

describe("one card at a time, locked in as a draft or approved", () => {
  it("shows only the first proposal and counts the rest as held", () => {
    const r = parseTalkResult({
      reply: "x",
      settled: false,
      proposals: [
        { title: "A", detail: "", actions: [{ action: "write_intent", args: '{"node":"A","text":"a"}' }] },
        { title: "B", detail: "", actions: [{ action: "write_intent", args: '{"node":"B","text":"b"}' }] },
      ],
    });
    expect(r.proposals.map((p) => p.title)).toEqual(["A"]);
    expect(r.held).toBe(1);
  });

  it("approve signs the Intent and moves the node to approved; draft leaves it unsigned", () => {
    const db = openDb(":memory:");
    const project = { name: "Game", path: "/x" };
    const a = addNode(db, { project: "Game", title: "Hosting" }, HUMAN);
    const b = addNode(db, { project: "Game", title: "Costs" }, HUMAN);
    applyProposal(db, project, { node_id: null }, [{ action: "write_intent", args: { node: "Hosting", text: "One server." } }], { approve: true });
    applyProposal(db, project, { node_id: null }, [{ action: "write_intent", args: { node: "Costs", text: "Cheap." } }]);
    const row = (id: string) =>
      db.prepare("SELECT n.stage, r.signed_at FROM design_nodes n JOIN design_revisions r ON r.node_id = n.id WHERE n.id = ? ORDER BY r.id DESC").get(id) as { stage: string; signed_at: number | null };
    expect(row(a.id).stage).toBe("approved");
    expect(row(a.id).signed_at).not.toBeNull();
    expect(row(b.id).stage).not.toBe("approved");
    expect(row(b.id).signed_at).toBeNull();
    expect(() => applyProposal(db, project, { node_id: a.id }, [{ action: "ask", args: { text: "Why?" } }], { approve: true })).toThrow(/no Intent/);

    // Approved as an idea: saved, unsigned, and kept at stage idea even if proposed as "proposed".
    applyProposal(
      db,
      project,
      { node_id: null },
      [
        { action: "add_node", args: { title: "Mines", stage: "proposed" } },
        { action: "write_intent", args: { node: "Mines", text: "Mines float in space." } },
      ],
      { idea: true },
    );
    const mines = db.prepare("SELECT id FROM design_nodes WHERE title = 'Mines'").get() as { id: string };
    expect(row(mines.id).stage).toBe("idea");
    expect(row(mines.id).signed_at).toBeNull();
  });
});

describe("checking against the truth", () => {
  it("spots the owner saying something already exists", async () => {
    const { soundsAlreadyDone } = await import("@/lib/design-talk");
    for (const t of ["Wait, we've done that already", "that's built", "We have designed this", "this is out of date", "isn't that in the game already?"]) {
      expect(soundsAlreadyDone(t), t).toBe(true);
    }
    for (const t of ["Option 1.", "I'd like ships to have names", "Make it 24 characters", "it is in the menu"]) {
      expect(soundsAlreadyDone(t), t).toBe(false);
    }
  });

  it("tells the agent the code is the truth, which nodes are stale, and how to verify", () => {
    const project = { name: "EQX-Net", path: "C:/Users/a/eqx-net/eqx-net" };
    const b = talkBrief({ project, node: null, question: null, agentName: "talk-x", mondoPath: "C:\mondo", stale: { against: "origin/main @ abc1234", titles: ["Regions", "Galaxy Map"] } });
    expect(b).toContain("the merged code and its history are the truth");
    expect(b).toContain("Regions, Galaxy Map");
    expect(b).toContain("origin/main @ abc1234");
    expect(b).toContain("When the owner says something already exists");
    expect(b).toContain("gh pr list --state merged");
    expect(b).toContain(`"regenerate"`);
  });

  it("refuses a re-check of a node that doesn't exist, before writing anything", () => {
    const db = openDb(":memory:");
    const project = { name: "Game", path: "/x" };
    const n = addNode(db, { project: "Game", title: "Regions" }, HUMAN);
    expect(() =>
      applyProposal(db, project, { node_id: n.id }, [
        { action: "write_intent", args: { text: "x" } },
        { action: "regenerate", args: { nodes: ["Nope"] } },
      ]),
    ).toThrow(/no such node to re-check/);
    expect(db.prepare("SELECT COUNT(*) n FROM design_revisions").get()).toEqual({ n: 0 });
  });
});

describe("finding nodes the way agents name them", () => {
  it("accepts a unique title or path ending, and keeps creating exact", async () => {
    const { resolveNode } = await import("@/lib/design");
    const { runAction } = await import("@/lib/design-actions");
    const db = openDb(":memory:");
    const game = addNode(db, { project: "Game", title: "The Game" }, HUMAN);
    const fac = addNode(db, { project: "Game", parentId: game.id, title: "Factions & living world" }, HUMAN);
    addNode(db, { project: "Game", parentId: fac.id, title: "Robot territory" }, HUMAN);
    const w1 = addNode(db, { project: "Game", parentId: game.id, title: "Weapons" }, HUMAN);
    addNode(db, { project: "Game", parentId: fac.id, title: "Weapons" }, HUMAN);

    // The two cards that failed: a parent by bare title, then a new node by bare title.
    expect(resolveNode(db, "Game", "Factions & living world")?.id).toBe(fac.id);
    expect(resolveNode(db, "Game", "factions & living world/robot territory")?.title).toBe("Robot territory");
    applyProposal(db, { name: "Game", path: "/x" }, { node_id: null }, [
      { action: "add_node", args: { parent: "Factions & living world", title: "Sovereignty structures" } },
      { action: "write_intent", args: { node: "Sovereignty structures", text: "Only in claimed sectors." } },
    ]);
    expect(resolveNode(db, "Game", "Sovereignty structures")).not.toBeNull();

    // Ambiguous: two "Weapons" nodes, so a bare title isn't enough, but a full path is.
    expect(resolveNode(db, "Game", "Weapons")).toBeNull();
    expect(resolveNode(db, "Game", "The Game/Weapons")?.id).toBe(w1.id);

    // ensure creates a new top-level "Robot territory" rather than reusing the nested one.
    runAction(db, "Game", { action: "ensure", path: "Robot territory" }, AGENT);
    expect(db.prepare("SELECT COUNT(*) n FROM design_nodes WHERE title = 'Robot territory'").get()).toEqual({ n: 2 });
  });
});

describe("multiple-choice answers", () => {
  it("reads the options as tappable answers", () => {
    const r = parseTalkResult({ reply: "Who sets it?", proposals: [], settled: false, choices: ["Option 2: owners, capped (recommended)", " ", 7, "Option 1: fixed"] });
    expect(r.choices).toEqual(["Option 2: owners, capped (recommended)", "Option 1: fixed"]);
    expect(parseTalkResult({ reply: "x", proposals: [], settled: false }).choices).toEqual([]);
  });
});

describe("searching what's already decided", () => {
  it("finds the owner's words in talks, questions with answers, and Intent", async () => {
    const { searchDesign } = await import("@/lib/design-search");
    const { resolveQuestion } = await import("@/lib/design");
    const db = openDb(":memory:");
    const warp = addNode(db, { project: "Game", title: "Warp Travel" }, HUMAN);
    const q = askQuestion(db, warp.id, { text: "Is hull-switching fast travel?" }, AGENT);
    resolveQuestion(db, q.id, "answered", "No: parking a ship and respawning in it later is intended.", HUMAN);
    db.prepare("INSERT INTO design_talks (id, project, node_id, session_id, title, created_at, updated_at) VALUES ('t1','Game',?,'s','x',1,1)").run(warp.id);
    db.prepare("INSERT INTO design_talk_turns (talk_id, text, created_at, auto) VALUES ('t1', ?, 2, 0)").run(
      "Most respawns are at a friendly NPC capital. If you've no money you're given a free ship.",
    );
    db.prepare("INSERT INTO design_talk_turns (talk_id, text, created_at, auto) VALUES ('t1', 'Approved \"Respawn\" (money)', 3, 1)").run();

    const hits = searchDesign(db, "Game", "no money respawn");
    expect(hits[0]).toMatchObject({ kind: "owner said", node: "Warp Travel" });
    expect(hits[0].snippet).toContain("free ship");
    expect(hits.some((h) => h.detail === null && h.kind === "owner said")).toBe(false); // talk id is given
    expect(searchDesign(db, "Game", "respawning parking").map((h) => h.kind)).toContain("question");
    expect(searchDesign(db, "Game", "xx")).toEqual([]); // too short to search
    expect(searchDesign(db, "Other", "respawn")).toEqual([]); // other projects stay out
  });

  it("tells talk agents to search first, ask only real decisions, and keep off-topic design", () => {
    const b = talkBrief({ project: { name: "EQX-Net", path: "C:/x" }, node: null, question: null, agentName: "talk-x", mondoPath: "C:\mondo" });
    expect(b).toContain(`npm run -s design -- EQX-Net search '{"text":"<key words>"}' --as agent:talk-x`);
    expect(b).toContain("Never ask about micro detail");
    expect(b).toContain("Nothing the owner says is dropped, even if it's off the current topic");
  });
});

describe("checking the open questions", () => {
  it("briefs the job with the owner's rule and reads its drop list safely", async () => {
    const { triageInstruction } = await import("@/lib/design-triage");
    const { triageDrops } = await import("@/lib/triage-drops");
    const b = triageInstruction({ name: "EQX-Net", path: "C:/x" }, [{ id: 32, node: "Hulls", text: "Which hulls does each station sell?" }], "question-check");
    expect(b).toContain("Question 32 (on \"Hulls\")");
    expect(b).toContain("Already answered");
    expect(b).toContain("Micro detail");
    expect(b).toContain("When genuinely unsure, keep it");
    expect(b).toContain("Out of date");
    expect(b).toContain("A bug, not a design decision");
    expect(b).toContain("one by one");
    expect(b).toContain("npm run -s design -- EQX-Net search");
    expect(triageDrops({ drop: [{ question: 32, reason: "micro", answer: "later" }, { question: "x" }, null, { question: "7", reason: "dup" }] })).toEqual([
      { question: 32, reason: "micro", answer: "later" },
      { question: 7, reason: "dup", answer: "" },
    ]);
    expect(triageDrops(null)).toEqual([]);
  });
});
