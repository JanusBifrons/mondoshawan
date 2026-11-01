---
name: design-survey
description: Survey a project's code (e.g. EQX-Net) and write what the game actually does today into Mondo's design bible as Built nodes with evidence. Use when asked to "survey <system>", "document what's built", "update the design bible from the code", "re-survey flagged nodes", or /design-survey.
---

# Design survey

Mondo's design bible is a tree of design nodes per project. The **ground layer** ("Built") describes what the game does **today, as implemented, not as intended**. You write it from the code. It is factual and needs no sign-off, so accuracy is everything. The human designs on top of it (ideas, proposals, approved intent), and later passes compare that intent against your reality.

You act as an agent: you can create Built nodes, write reality, link nodes and raise questions. You can't sign intent, move nodes into canon or decide reviews, and you shouldn't try.

Run all commands from the Mondo repo root (the folder containing `mondo.config.json`). The CLI is:

```bash
npm run -s design -- <Project> <action> '<json>' --as agent:survey
npm run -s design -- help          # every action and its arguments
```

For long text, write the JSON to a file in your scratchpad and pass `--file <path>` instead of inline JSON.

## Scope

Survey **one system at a time** (e.g. "Weapons"), as asked. Don't survey the whole game in one go unless told to. If nothing is named, ask which system to survey, or check `gaps` for flagged nodes to redo.

## Steps

1. **See what's there:**
   ```bash
   npm run -s design -- EQX-Net tree
   npm run -s design -- EQX-Net gaps
   ```
   - Re-use existing nodes and match titles exactly.
   - Nodes with `realityFlag` set were flagged as wrong by the human. Read the flag (`get`) and fix exactly that.
   - Never touch nodes in other stages, except to write reality on them.

2. **Read the code, not the docs.** Find the project path in `mondo.config.json`.
   - Docs, plans and handoffs describe intent and are often stale. Use them only to know where to look.
   - Trace the real behaviour: server simulation, client feedback, config values and constants.
   - Get the commit you're describing: `git -C <project path> rev-parse --short HEAD`.

3. **Shape the tree.** Use `System › mechanic › detail`, about 2–4 levels deep. One node per thing a designer would talk about, like "Missiles" or "Missile homing", not one per file.
   ```bash
   npm run -s design -- EQX-Net ensure '{"path":"Weapons/Missiles/Homing","stage":"built","kind":"mechanic","summary":"How missiles pick and chase targets"}' --as agent:survey
   ```
   `ensure` creates missing nodes along the path (parents get `parentKind`, default `system`) and leaves existing ones alone. Kinds: `system`, `mechanic`, `feature`, `content`, `other`.

4. **Write reality** for each node: plain designer language, in maximum useful detail.
   - **Plain English that needs zero context.** Someone who has never seen the game or the code should understand it. Open with one or two sentences on what the thing *is* and what it's *for*, then the detail. No code names, file names or jargon in the prose. If a term is unavoidable, say what it means.
   - **Link everything you mention that has its own node:** `[[Sectors]]`, `[[Galaxy map/Sectors|sectors]]` (title path, with optional label). Links open that node in Mondo, so readers follow them for context and you don't repeat it. If something deserves its own node and doesn't have one, create it (Built) and link it. Example: "The galaxy map is an overview of all [[Sectors|sectors]]. It's dynamic and can hold any number of them."
   - Cover what happens, the numbers (speeds, ranges, timers, costs), edge cases, and what the player sees and feels.
   - Note anything half-built, stubbed, disabled or behind a flag. Say "not implemented" plainly where that's the truth.
   - Markdown is fine. Don't paste code.
   ```json
   {"node":"Weapons/Missiles/Homing","text":"…","evidence":["src/server/weapons/Missile.ts:42","src/shared/config/weapons.ts:10"],"commit":"d36931c"}
   ```
   ```bash
   npm run -s design -- EQX-Net write_reality --file <scratchpad>/homing.json --as agent:survey
   ```
   - `evidence`: the `path:line` refs that back the text.
   - `commit`: the short SHA from step 2.
   - Writing reality clears any flag on that node.

5. **Link the web.** Where systems touch, add links. Types: `depends_on`, `affects`, `conflicts_with`, `variant_of`, `replaces`.
   ```bash
   npm run -s design -- EQX-Net link '{"from":"Weapons/Missiles","to":"Shields","type":"affects","note":"Damage hits shields before hull"}' --as agent:survey
   ```

6. **Raise questions** for anything a designer should decide: oddities, contradictions, or behaviour that looks accidental. Don't use them for things you could check yourself.
   ```bash
   npm run -s design -- EQX-Net ask '{"node":"Weapons/Missiles/Homing","text":"Missiles also lock onto asteroids. Intended?","related":["Asteroids"]}' --as agent:survey
   ```

7. **If the node has signed intent** (`get` shows `canonIntent`), compare it with what you found. If the build differs, record it; this opens a review for the human:
   ```bash
   npm run -s design -- EQX-Net fidelity '{"node":"…","fidelity":"drifted","gap":"Intent says ships only; build also targets asteroids.","commit":"d36931c"}' --as agent:survey
   ```
   If it matches, set `"fidelity":"matches"`.

8. **Chase what needs a person.** If something needs a human decision or action by a date, add a chase, not just a question:
   ```bash
   npm run -s design -- EQX-Net chase '{"node":"…","text":"Decide whether guests can play","due":"2026-11-08","waiting_on":"you"}' --as agent:survey
   ```
   Also add links (`source` with `{"node","ref","title"}`) to the PRs, docs or pages behind a node.

9. **Report** back: nodes created and updated, links, questions raised, drift found, and anything you couldn't work out.

Mondo doesn't need to be running. The CLI writes straight to `data/mondo.db`, and open pages refresh on their own.
