# Refinement: how designs get attacked, decided and promoted

Status: **idea being refined** (talked through with the owner on 2026-11-01). Nothing here is built yet.

## Why
Starting an agent to build something is the easy, last step. The real work is deciding *what* to build:
- reviewing an idea or plan;
- finding where it overlaps with other systems and gameplay loops;
- finding its edge cases;
- deciding how far up the design tree to go.

Mondo should run that process, not just store its results.

## The process
It mirrors how a good working session with an agent already goes:
1. **Read:** the agent reads the context.
2. **Propose and ask:** it proposes a shape and asks sharp questions, each with options, a recommendation and enough context to answer on its own.
3. **Answer or redirect:** the human answers or redirects.
4. **Record:** answers become decisions, the design changes, and new questions fall out.
5. **Repeat** until nothing blocking is left.

In Mondo:
- **What starts it:** a refinement is started on a design node or branch. The reason can be:
  - ambiguity in it;
  - a new idea ("What if we added mines?");
  - a proposal that needs hardening.
- **Whole-system awareness.** The agent reviews the target against everything that matters, not just the target:
  - **canon:** approved and in-build intent;
  - **reality:** built nodes, written from the code;
  - **other open proposals:** the sky layer;
  - **gameplay loops:** see below.
- **Lenses** drive the questions:
  - systems and overlaps;
  - gameplay loops (what the player does minute to minute);
  - edge cases and abuse;
  - cost and risk to build.
- **Questions live on the node, in Mondo.** They're structured: the question, its context, options, a recommended option, and whether it's blocking. They can be answered on the phone or the PC, and stay attached to the design for good.
- **Decisions are kept.** Each answer is recorded on the node: what was asked, what was chosen, and why. The design keeps its reasoning.
- **The agent decides the outcome**, as a wrap-up step once nothing blocking is left. The outcome varies:
  - a refined node: updated intent drafts;
  - new nodes split out;
  - nodes suggested for abandoning, including things that are already built;
  - a design write-up summarising what was decided.
- **Results stay open.** They can be refined again, or raised to canon by the human: only the human signs, as the bible already enforces.

## Canon changes ripple
When something enters or leaves canon, every unapproved node that touches it must be re-checked: does its plan still make sense against the new canon? This is the "consider the impact of adding or removing this mechanic" check from the original brief.

## Gameplay loops as nodes
Loops (e.g. fight → loot → upgrade → fight) cut across systems. They become their own node kind, linked to the systems they run through. Then reviews can ask "what does this change do to the core loop?"

## Who does what (unchanged rules)
- Agents raise questions, write suggestions and drafts, and propose outcomes.
- The human answers, signs intent and moves things into or out of canon.
- Agents write reality only from code, as today.

## Open questions
- **Abandoning something already built:** how does a "retire this built node" outcome turn into removal work, and who signs it?
- **The agent's outcome:** is it applied straight away as drafts, or shown as a proposal the human accepts first?
- **Canon ripple:** does the re-check run automatically on every canon change (cost), or is it queued and flagged "needs re-check" for the human to start?
- **Lenses:** one agent with several lenses, or one agent per lens, run in parallel?
- **Scope:** how does a refinement mark "build up to here now, the rest stays an idea"?
