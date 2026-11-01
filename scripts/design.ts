// The design bible's agent interface. Writes straight to data/mondo.db, so Mondo
// doesn't need to be running; open pages refresh on their own.
//
//   npm run -s design -- <project> <action> [json-args] [--as agent:<name>]
//   npm run -s design -- <project> <action> --file args.json
//   npm run -s design -- help
//
// Examples:
//   npm run -s design -- EQX-Net tree
//   npm run -s design -- EQX-Net get '{"node":"Weapons/Missiles"}'
//   npm run -s design -- EQX-Net ensure '{"path":"Weapons/Missiles","stage":"built"}' --as agent:survey
//   npm run -s design -- EQX-Net write_reality --file reality.json --as agent:survey
//
// Everything here acts as an agent: agents can write reality, propose intent, raise
// questions and links, but never sign off intent, move nodes into canon or decide reviews.
import fs from "node:fs";
import { loadConfig, projectSlug } from "../lib/config";
import { openDb } from "../lib/db";
import { DesignError, WAITING_ON, FIDELITIES, KINDS, LINK_TYPES, QUESTION_OUTCOMES, STAGES } from "../lib/design";
import { ACTIONS, runAction } from "../lib/design-actions";

const HELP = `Usage: npm run -s design -- <project> <action> ['{json args}' | --file args.json] [--as agent:<name>]

Node refs: an id, or a title path like "Weapons/Missiles".
Actions:
  tree                                   all nodes with flags
  get            {node}                  one node: intent, reality, reviews, questions, links, history
  gaps                                   approved-but-unbuilt, drifted, unchecked, flagged, blocked, open reviews
  ensure         {path, stage?, kind?, summary?, parentKind?}   create missing nodes along a path
  add_node       {title, parent?, summary?, kind?, stage?}
  update_node    {node, title?, summary?, kind?, parent?, sort?}
  write_reality  {node, text, evidence?: ["path:line"...], commit?, note?}
  write_intent   {node, text, note?}       (a proposal; only the human signs)
  stage          {node, stage, note?}      agents: idea | proposed | built
  fidelity       {node, fidelity, gap?, commit?}   "drifted" opens a review
  flag           {node, note}
  ask            {node, text, blocking?, related?: [refs]}
  resolve_question {question, outcome, answer?}   (non-blocking only)
  open_review    {node, gap}
  link           {from, to, type, note?}
  unlink         {link}
  source         {node, ref, title?}
  priority       {node, priority}          low | normal | high | urgent
  chase          {node, text, due, waiting_on?}   due: 2026-11-02 (09:00 local) or ISO; waiting_on: ${WAITING_ON.join(" | ")}
  snooze_chase   {chase, due}
  close_chase    {chase, outcome?, note?}  outcome: done (default) | dropped
  chases                                 open chases, soonest first
  search         {text}                  everything recorded: nodes, Intent, Reality, questions + answers,
                                         and what the owner said in design talks (check before asking)
  batch          [{action, ...args}, ...]  run several actions in order (use --file)

stage:    ${STAGES.join(" | ")}
kind:     ${KINDS.join(" | ")}
fidelity: ${FIDELITIES.join(" | ")}
link:     ${LINK_TYPES.join(" | ")}
outcome:  ${QUESTION_OUTCOMES.join(" | ")}`;

const READ_ONLY_ACTIONS = ["tree", "get", "gaps", "chases", "search"];

function main() {
  const argv = process.argv.slice(2);
  let actor = "agent:cli";
  let file: string | null = null;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--as") actor = argv[++i] ?? actor;
    else if (argv[i] === "--file") file = argv[++i] ?? null;
    else rest.push(argv[i]);
  }
  if (!rest.length || rest[0] === "help" || rest[0] === "--help") {
    console.log(HELP);
    return;
  }
  if (!actor.startsWith("agent:") || actor.length < 7) {
    console.error('--as must look like "agent:<name>" (the CLI never acts as the human)');
    process.exit(2);
  }

  const [projectArg, actionArg, jsonArg] = rest;
  // `batch`: the JSON is an array of { action, ...args }, run in order (stops at the first error).
  const isBatch = actionArg === "batch";
  const action = isBatch ? "tree" : actionArg;
  const json = jsonArg;
  const project = loadConfig().projects.find((p) => p.name === projectArg || projectSlug(p.name) === projectSlug(projectArg ?? ""));
  if (!project) {
    console.error(`Unknown project "${projectArg}". Known: ${loadConfig().projects.map((p) => p.name).join(", ")}`);
    process.exit(2);
  }
  if (!actionArg || (!isBatch && !(ACTIONS as readonly string[]).includes(action))) {
    console.error(`Unknown action "${action ?? ""}".\n\n${HELP}`);
    process.exit(2);
  }

  // In a design talk (run by Mondo) the agent may only read: it proposes changes and the owner approves them in Mondo.
  if (process.env.MONDO_DESIGN_READONLY === "1" && (isBatch || !READ_ONLY_ACTIONS.includes(action))) {
    console.error(
      `Error: "${actionArg}" changes the design bible, and in a design talk you can't write. Put it in your proposals instead; the owner approves it in Mondo.`,
    );
    process.exit(3);
  }

  let args: unknown = {};
  try {
    const raw = file ? fs.readFileSync(file, "utf8") : json;
    if (raw) args = JSON.parse(raw);
  } catch (err) {
    console.error(`Could not read JSON args: ${(err as Error).message}`);
    process.exit(2);
  }
  if (isBatch && !Array.isArray(args)) {
    console.error("batch needs a JSON array of { action, ...args }");
    process.exit(2);
  }

  const db = openDb();
  try {
    if (isBatch) {
      const steps = args as { action: string }[];
      steps.forEach((step, i) => {
        try {
          runAction(db, project.name, step, actor);
        } catch (err) {
          if (err instanceof DesignError) throw new DesignError(`step ${i + 1} (${step.action}): ${err.message}`, err.status);
          throw err;
        }
      });
      console.log(JSON.stringify({ ok: true, steps: steps.length }));
      return;
    }
    const out = runAction(db, project.name, { ...(args as object), action }, actor);
    console.log(JSON.stringify(out, null, 2));
  } catch (err) {
    if (err instanceof DesignError) {
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
    } else throw err;
  } finally {
    db.close();
  }
}

main();
