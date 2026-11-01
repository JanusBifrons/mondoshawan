# Mondoshawan (Mondo)

A Windows desktop app that monitors local Claude Code sessions. See `design/brief.md` for purpose, principles and phases.

## Layout
- This folder (`Projects/mondoshawan/mondoshawan`) is the git repo. The outer `Projects/mondoshawan/` wrapper holds large material that stays out of the repo, the same pattern as `eqx-net/eqx-net`.
- `app/`: Next.js App Router (UI + API routes). `lib/`: server logic (config, paths, git, matching, store). `hooks/mondo-hook.js`: the Claude Code hook. `scripts/`: CLI helpers. `electron/`: desktop window.

## Working on this repo
- **Each agent works in its own branch and git worktree and opens a PR into `main`.** Never commit straight to `main` in the main checkout: several sessions often run at once. Commit and push freely on your branch.
- Remote: github.com/JanusBifrons/mondoshawan. Open PRs with `gh pr create`.
- **PRs into main auto-merge as soon as the CI `verify` check passes** (`.github/workflows/auto-merge.yml`), and merged branches are deleted hourly. So once a PR is open, never push more work to its branch: it may already be merged, and later commits get stranded. Start a new branch and PR instead. Open a PR only when the work is finished and tested (or as a draft to keep it open).
- CI runs on Linux: keep tests OS-independent (no `path.resolve` on Windows-style paths).
- **CI and auto-merge:**
  - **CI** (`.github/workflows/ci.yml`, job `verify`) runs typecheck, tests and `next build` on every PR and on pushes to `main`. `main` is protected: a PR can only merge once `verify` passes.
  - **Every PR merges itself once it's green.** `.github/workflows/auto-merge.yml` turns on auto-merge (merge commit) when a PR opens. `branch-cleanup.yml` deletes merged branches hourly, because GitHub doesn't trigger workflows or delete-on-merge for merges made by the Actions bot. For the same reason, CI on `main` doesn't re-run after those merges; the PR run is the check. To be safe, also run `gh pr merge <n> --auto --merge` right after `gh pr create`.
  - To hold a PR back, open it as a draft, or run `gh pr merge <n> --disable-auto`.
  - Run `npm run typecheck && npm test` before pushing, so CI isn't the first to find a failure.
  - If `main` moves while your PR is open, merge it in (`git fetch origin && git merge origin/main`), re-run the checks and push. Don't rebase a pushed branch.
- **Durable rules go in this file, not in Claude's per-machine memory.** Memory doesn't follow the user between machines.
- **One Claude session works on Mondo at a time** (the owner's choice, 2026-11-01). Don't start a parallel session on this repo without being asked.

## Working with the owner
- **Every stop ends with one status sentence that starts with an emoji:** "✅ Done: …", "⏳ Waiting for: …", "❓ I'm asking you: …", "🛑 Blocked: …". Lead with the outcome, then a done / not-done checklist.
- **Ask every question through the AskUserQuestion box,** never as prose. Give enough context that it reads on its own: what, why, the risk, and the recommended option first.
- **Verify before handing over.** Rebuild and relaunch the real Mondo yourself, check the port, the URL and the result, and only then say it works. Do every step you can do yourself.
- **One step at a time** when the owner has to act. Never end with a long numbered list of things for them to do.
- **Batch anything that needs the owner at the PC** (folder trust, firewall prompts, approvals, `!` commands) and do it all in one sitting, ideally with one click (e.g. Settings → Folder trust).
- **Restarting Mondo** (the desktop window): stop the Electron process tree whose command line is `electron.exe "<repo>"` (it ends with a trailing space, so match loosely), plus its `serve.mjs` / `next start` children, start the same command again, and wait for 4317 and 4318 to listen. It rebuilds itself if the code changed.

## Decisions (do not undo without discussion)
- **Next.js is the app; Electron is just a window.** Electron starts the Next server if nothing answers on the port, then loads it. The server must stay runnable alone (`npm run server`) for Phase 3 (phone over LAN).
- **Bind 127.0.0.1:4317 by default.** Host and port come from `MONDO_HOST`/`MONDO_PORT`, then from `mondo.config.json` `server`.
- **Phones reach Mondo through the LAN gateway, never directly, and only once approved on the PC** (`scripts/lan-gateway.mjs`, started by `scripts/serve.mjs` when `server.lan.enabled`; `MONDO_LAN=0` skips it). Next stays on loopback, so hooks and Electron need no auth.
  - Pairing: open `http://<pc-ip>:4318` on the phone (Settings shows the address and a QR) and tap Request access (`POST /__mondo/pair`, no token: approval on the PC is the gate). The gateway adds a pending row to the `devices` table with a 4-digit code and gives the phone a `mondo_device=<id>.<secret>` cookie (only a hash is stored). The PC's Mondo window shows "Allow this device?" (`components/pairing-prompt.tsx`, polling `/api/remote/devices`). Requests lapse after 10 minutes; at most 3 wait at once.
  - Approving, denying and revoking happen only on the PC: those routes refuse requests carrying `x-mondo-remote`. Settings lists approved devices with Revoke.
  - Every forwarded request needs an approved device, used from the IP address it paired from. A different address shows "moved" and needs approving again, so a copied cookie is useless elsewhere. It's plain HTTP on the LAN by choice: no certificates for now. The gateway rejects cross-site Origins and forwards with Host/Origin rewritten plus `x-mondo-remote: 1`.
  - Gateway side: `scripts/lan-devices.mjs`. PC side: `lib/devices.ts`. They share the table SQL and timeout, and a test checks they match. **Never import a `.mjs` file into the Next app**: it puts the dev server into a reload loop.
- **Mondo starts agents; you chat with them in the Claude app.** The Agents page also lists every other live Claude session on the PC (`lib/live-sessions.ts`: Claude's registry `~/.claude/sessions/<pid>.json`, live PIDs only, read-only), tagged "You · terminal/desktop app/script". Those can be opened in Claude (if Remote Control is on) and stopped, behind a confirm (stop only targets a session the registry lists as running, with the PID from there). Mondo never starts, types into or restarts sessions you started. An agent (`lib/agents.ts`) is an interactive `claude --remote-control "<Project>: <name>"` in its own Git Bash (mintty) window on the PC:
  - launched via a script in `data/agents/<id>.sh` (`exec claude …`, so closing the window ends it), with Claude's own `CLAUDE*` env vars removed. Inherited ones mark it a child session and turn off transcript saving, which breaks Resume;
  - `--session-id` is chosen by Mondo, so hook rows match the agent (`lib/fleet.ts` joins them). Mondo finds the claude.exe PID by that id to stop it (`taskkill /T`) and to notice when the window closes. In both cases it marks the session ended, since a killed process sends no SessionEnd;
  - the "Open in Claude" link comes from `~/.claude/sessions/<pid>.json` (`bridgeSessionId`), read-only;
  - agents are detached and survive Mondo restarts. Resume relaunches with `--resume <sessionId>` in the same folder;
  - **new worktree is the default**: Claude starts in the project's main folder and is told (`--append-system-prompt`) to call EnterWorktree first, then commit, push and open a PR into main. Don't use `claude --worktree`: it exits immediately in this mode;
  - **folder trust**: Claude only trusts a folder with its own exact "yes" in `~/.claude.json` (key `C:/forward/slashes`). A trusted parent doesn't count, and worktrees never have entries. `lib/claude-trust.ts` checks this read-only, and Mondo refuses to start in an untrusted folder, because the window would sit at the trust question. Mondo never writes that file;
  - permission modes offered: auto (default), acceptEdits, plan, manual. Prompts are answered in the Claude app. Never bypassPermissions.
- **Hook script has no dependencies, a 1s timeout, swallows all errors, always exits 0, and prints nothing.** It is registered globally in `~/.claude/settings.json` by `scripts/install-hooks.mjs`, which does a dry run by default, backs up the file before changing it, merges, and can be undone with `scripts/uninstall-hooks.mjs`. Mondo's entries are identified by `mondo-hook.js` in the command.
- **Hooks are `async: true`** (non-blocking), except SessionEnd, which is sync so it gets sent before the process exits.
- **Events:** SessionStart, UserPromptSubmit, PostToolUse, Stop, Notification, SessionEnd. PostToolUse is there because no hook fires when a permission prompt is answered.
- **Storage is SQLite at `data/mondo.db`** (gitignored), via Node's built-in `node:sqlite`, the same as eqx-net. It needs no native module, so Electron packaging stays simple.
  - `lib/db.ts` opens it (WAL mode, `busy_timeout`). `lib/schema.ts` holds append-only migrations tracked by `PRAGMA user_version`.
  - Load `node:sqlite` only through `process.getBuiltinModule`. A static import or `createRequire` breaks `next build`.
  - The old `data/state.json` is imported once and renamed to `.imported`.
- **Paths are normalised before comparing:** `/c/x` → `c:/x`, backslashes become forward slashes, everything lowercase, no trailing slash.
- **A session matches the project** whose path or worktree path is the longest prefix of its cwd.
- **Live updates use Server-Sent Events** (`/api/stream`), with polling as a fallback.

## UI
- **Stack:** shadcn/ui (Radix, `radix-nova` style) and Tailwind v4. Components live in `components/ui/` (add more with `npx shadcn@latest add <name>`). Light/dark mode comes from `next-themes` (class-based, follows the system by default).
- **Hooks location:** shadcn's React hooks go to `lib/hooks/` (set in `components.json`), because `hooks/` is reserved for the Claude Code hook script.
- **Layout:** `app/layout.tsx` wraps every page in the sidebar (`components/app-sidebar.tsx`). Each page renders its own `<PageHeader>`.
- **Mobile:** every page must work at 390px wide with no sideways scroll. The sidebar becomes a drawer that closes on navigation, and a bottom tab bar (`components/mobile-nav.tsx`) shows Agents · Design · Knowledge · Settings.
- **Pages:** Agents (`/agents`, the home page; `/` redirects there), with a drill-down per session (`/agents/<sessionId>`); Design bible (`/design`, `/design/<project>`); Knowledge base (`/knowledge`, `/knowledge/<project>`); Settings (`/settings`); and "coming soon" placeholders (`/roadmap`, `/prompts`). The old Sessions page was merged into Agents.

## Agents page (the fleet)
- **One list of every Claude session on the PC** (`lib/fleet.ts`). It merges Mondo's agents, Claude's live-session registry (what's running now) and hook rows (status detail, last message, System tag, and sessions that ended in the last 7 days). Items are keyed by Claude session id.
- **Order:** "Needs you" (waiting, needs permission, needs attention) first, with an inline Open in Claude; then Running; then a collapsed Ended list. Status tiles sit on top.
- **Drill-down** (`/agents/<sessionId>`, `GET/POST /api/agents/item/<sessionId>`): what needs you; where it's working; high-level actions (Open in Claude, Stop, Resume a Mondo agent, Remove from list, System tag); and recent activity read from the session's transcript (`~/.claude/projects/<folder>/<id>.jsonl`, the tail only, read-only).
- **No chat with agents in Mondo, on purpose.** Talking to a building agent (one that writes and commits code) happens in the Claude app; Mondo is the control panel. The one exception is design talks (below).
- **Live updates:** `/api/agents/stream` (event `fleet`) pushes on agent and hook changes and re-reads the registry every 5s.

## Background jobs and usage
- **Two kinds of agent work** (the owner's rule): building work (writing and committing code) runs as a visible Remote Control agent; small, scoped work with a clear end (Regenerate) runs as an invisible **job**. Design talks are a chat inside Mondo where each turn is a job (kind `talk`).
- **Jobs** (`lib/jobs.ts`, table `jobs`): `claude -p --output-format stream-json --verbose` with a fixed instruction on stdin, a background brief (`--append-system-prompt`: nobody is watching, don't ask), a JSON result schema (`--json-schema`, including `confidence` 0–1 and `concerns`), `--permission-mode auto --permission-prompts none`, and `--model`/`--effort` from `mondo.config.json` `jobs` (defaults: sonnet, medium). They're detached and hidden, with output in `data/jobs/<id>.jsonl`. The 3s check parses that log (`lib/job-events.ts`) for progress and the final result, so jobs survive Mondo restarts. Job sessions are left out of the Agents list; they have their own section and drill-down (`/agents/job/<id>`).
- **Usage is measured in tokens, not money** (the owner's choice; Claude Code's API-equivalent dollar figure is stored in `jobs.cost_usd` but not shown). Per run: model(s), effort, input/output/thinking/cache-write/cache-read tokens, turns, tool calls, wall time and thinking time, plus confidence for jobs. "Total (new)" = input + output + cache written; cache reads are shown apart.
- **Visible agents' usage** comes from their transcripts (`transcriptUsage`: one count per message id, per model; cached until the file changes). The usage log is `/agents/usage` (`GET /api/usage`, `lib/usage.ts`): totals for 7 days and all time, an average per kind of run, and every run.

## Look and feel (Fifth Element theme)
- **The rule:** Mondo is styled after The Fifth Element (1997). Use original styling only: no film logos, stills or quotes.
- **Themes:** dark "2263" is the default (deep-space navy, starfield). Light "Temple" is sandstone.
- **Palette tokens** in `app/globals.css`: `leeloo` (orange, primary), `taxi` (yellow, alerts), `diva` (blue), `brass` (borders/labels), and element colours `fire` / `water` / `air` / `earth` / `fifth`.
- **Fonts:** Syncopate (`.display` headings), Chakra Petch (UI), Share Tech Mono (`.readout` labels, numbers, branches).
- **Motifs:**
  - `.frame` brass corner brackets (on every Card);
  - `.hazard` taxi stripes for anything that needs the user;
  - `.beam` orange rule under page titles;
  - `.glow` / `.glow-box`.
- **Statuses map to elements** (`components/elements.tsx`): idle = earth, working = fire, waiting = air, needs permission = the fifth, ended = water. `MondoMark` is the logo; `assets/mondo.ico` matches it.
- **Custom classes and variants:** Tailwind variants (`hover:` etc.) don't apply to the custom classes above. Use utilities for hover states.

## Knowledge base
- **What `lib/knowledge.ts` indexes for each project:**
  - git-tracked markdown in the repo (minus `knowledge.exclude` prefixes), dated by last commit;
  - markdown in `knowledge.folders` (e.g. the wrapper `Design/` folder), dated by file time;
  - hand-listed `knowledge.links` (Google Drive docs etc.).
- **Indexing details:** categories come from path rules in `categorize()`. Titles, summaries and status flags come from `describeMarkdown()`. The index is cached for 30s.
- **Doc previews:** `/api/knowledge/<project>/doc?id=` returns a doc only if its id is in the index, so paths can't be forged.
- **Google Drive:** each project can mirror one Drive folder (`knowledge.drive.folder`, plus an optional pinned `folderId`).
  - Mondo can't reach Drive itself. A Claude session runs the `drive-sync` skill (`.claude/skills/drive-sync/SKILL.md`): it lists the folder with the Google Drive connector, reads new/changed docs, and runs `npm run drive:import`, which writes straight to SQLite.
  - `npm run drive:status` shows what's already stored.
  - Drive docs are origin `drive` in the knowledge base; their text opens in the reading pane.
  - The sync is read-only toward Drive.

## Design bible
Mondo **is** the design bible: a living tree (and web) of design nodes per project, stored in SQLite. Exported documents are only snapshots of it. The rules live in `lib/design.ts`; the vocabulary, which is client-safe, is in `lib/design-meta.ts`.
- **Stages run from reality up to ideas:**
  - Ground: `built`.
  - Grey zone: `in_build`, `approved`.
  - Sky: `proposed`, `idea`.
  - Plus `retired`.
- **Two texts per node, both versioned** (`design_revisions`, append-only):
  - **Intent** is what it should be. Only the human signs it, and the latest signed revision is canon; newer ones are drafts.
  - **Reality** is what the game does today. It is written **only by agents** from the code, with evidence and a commit, and needs no sign-off. The human can flag it as wrong, which asks for a re-survey.
- **Canon stages** (`approved`, `in_build`) need signed intent and no open blocking questions. Agents may only move nodes to `idea` / `proposed` / `built`, and can't take nodes out of canon.
- **Fidelity:** `drifted` opens a review. The human decides it: fix the build (→ `in_build`), change the intent, or accept the gap.
- **Actor:**
  - Every write goes through `runAction` (`lib/design-actions.ts`) with an actor.
  - The web API (`POST /api/design/<project>`) always acts as `human`.
  - The CLI (`npm run design`, `scripts/design.ts`) always acts as `agent:<name>`.
  - Node refs are ids or title paths ("Weapons/Missiles").
- **Writing:** every intent and reality text is plain English that needs zero context: say what the thing is and what it's for first, with no code names or jargon. Link other nodes it mentions with `[[Title]]` or `[[Parent/Title|label]]` (or `[label](node:<id>)`). Links open that node; a link to a missing node shows dotted. Helpers: `lib/design-links.ts`.
- **Node drill-down:** opens on Reality when the thing is built, otherwise on Intent. Every node has "Talk it through with an agent".
- **Design pages lead with discussion and questions:** "Start a design discussion" (pick an area or "something new"), then open design questions as cards, then the tree to explore. Chases sit in a collapsed "Follow-ups" section and on each node.
- **Design talks** (`lib/design-talk.ts`, page `/design/talk/<id>`, `POST /api/design/<project>/discuss` to start, `GET/POST /api/design/talk/<id>` to read, reply, approve or stop): the owner's choice is to talk design through **inside Mondo**, not in a window or the Claude app. "Start a design discussion", "Talk it through" and a question's "Discuss" all open one. Each owner message is one turn: a background job (`claude -p`, kind `talk`) that carries on the same Claude session (`--resume`), in Mondo's folder, with Edit/Write disallowed and `MONDO_DESIGN_READONLY=1`, which makes the design CLI refuse writes. It replies in a JSON shape (`TALK_SCHEMA`): reply, proposals, settled.
  - **Two phases, at the owner's pace** (the owner's rule, after a one-line idea came back as a dozen cards to review). **Discovery** first: back-and-forth to understand what's wanted, the scope and what it touches, one question per reply, with **no proposals**. Then **lock-down**: the agent sets out a plan of aspects in logical order and gets an OK, then takes them one at a time. It discusses the aspect until it's solid, proposes that one node, and waits for the owner before the next ("Aspect 2 of 5: ...").
  - **One card at a time.** `parseTalkResult` shows only the first proposal of a turn and tells the agent next turn how many it held back. `splitByNode` still splits a bundled proposal by node first, so the card is one node.
  - **Locking a card in:** **Approve** saves it as the owner, signs the Intent just written and moves the node to `approved` (all in one transaction; it fails if there's no Intent or a blocking question is open). **Save as draft** saves it unsigned. **Change this** starts a reply "About <node>: ...". **Skip** drops it. Decisions are stored as `locked` / `approved` (draft) / `skipped` / `failed`, and the agent is told which.
  - **What a node holds:** a developed design, not notes: what it is and what it's for, then headed sections (How it works, Rules, Numbers, Connections, Not in scope, Why), with everything said about that aspect folded in and unverified figures marked as estimates. The agent asks about the decisions that matter and fills in minor details as stated defaults; taste is a default, not a discussion. It checks fit with connected nodes, and a change to another node becomes its own aspect.
  - **The talk is the notes:** every node a card creates or rewrites gets a link to the talk ("the notes behind this").
  - Proposals use actions from `PROPOSAL_ACTIONS` (no sign, canon stages, reviews or reality; approving is the owner's button). The card shows the actions themselves, so what's saved is exactly what's shown.
  - **Questions:** a talk on a question bundles the Intent change and closing the question into one proposal. The talk id is kept on the question (`design_questions.discussion`), shown as "being talked through" with a link; "Close with this answer" still closes a question by hand.
  - Talk turns are left out of the Agents page's job list but count in Usage (linked to the talk).
- **Live refresh:** every change logs a `design_events` row. `/api/design/<project>/stream` polls `MAX(id)`, so CLI writes from other processes show up too.
- **Priority, chases and links (so nothing goes stale):**
  - Every node has a **priority**: low, normal (default), high or urgent.
  - A **chase** (`design_chases`) is a dated follow-up on a node: what needs to happen, who it waits on (you, you at the PC, an agent, someone else), and when. It can be marked done, snoozed (tomorrow or next week) or dropped. Humans and agents can both add chases. This is how to-dos are recorded today.
  - **External links** (`design_sources`) hold PRs, docs and settings pages, and show on the Links tab.
  - **Surfacing:**
    - Chases due today or overdue show as a badge on Design in the sidebar and the phone tab bar.
    - `/design` lists open chases across projects, collapsed under Follow-ups.
    - Each project page has a chase list, plus "Overdue chases", "High priority" and "Stale ideas" chips in its "needs you" strip. Stale means idea or proposed, untouched for 30 days, with no open chase.
- **Adding to design tables:** new tables go in `DESIGN_SCHEMA` (`CREATE … IF NOT EXISTS`); new columns go in `DESIGN_COLUMNS` (added if missing on open). Neither takes a numbered migration, so they can't clash with other branches.
- **Seeding:** the `design-survey` skill (`.claude/skills/design-survey/SKILL.md`) has a Claude session survey one system at a time from the code.
- **Code changed since checked** (`lib/design-freshness.ts`, `GET /api/design/<project>/changes`): for each Built node, Mondo diffs the files its Reality cites as evidence between the commit it was written at and the game's merged code (`origin/main`, fetched read-only at most every 10 minutes; the project folder's checked-out branch is ignored). Changed nodes are marked on their Reality tab and listed on the project page.
- **Regenerate** (`lib/design-regenerate.ts`, `POST /api/design/<project>/regenerate`): a background **job** with one fixed instruction to re-check nodes against the merged code and rewrite their Reality in the standard style, returning a summary, the nodes rewritten and created, confidence and concerns. A button on every built node's Reality tab, plus "Update all" for changed nodes (one job, up to 40). It never runs on its own (the owner's choice).
- **Later:** harden and impact jobs; "Produce design document" exports.

## Launching
- **Shortcuts:** `npm run shortcut` creates Desktop and Start menu shortcuts that run `node_modules/electron/dist/electron.exe "<repo>"`, so no terminal is needed. Flags: `-Startup`, `-Remove`.
- **Auto-rebuild:** in production mode `electron/main.cjs` runs `next build` first when there's no build, or when git HEAD plus uncommitted changes differ from `.next/mondo-build-stamp`.
- **Icon:** `assets/mondo.ico`, drawn by `scripts/make-icon.ps1`.

## Commands
- `npm run dev`: Electron window plus the Next dev server.
- `npm run server` / `npm run server:dev`: server only.
- `npm run check:projects`: verify registered projects, branches and worktrees.
- `npm run fake -- <scenario>`: fire fake hook events.
- `npm run hooks:install` (dry run), then `npm run hooks:install -- --apply`; `npm run hooks:uninstall`.
- `npm run drive:status` / `npm run drive:import -- <payload.json>`: Drive mirror (used by the drive-sync skill).
- `npm run -s design -- <project> <action> [json] --as agent:<name>`: the design bible's agent CLI (`help` lists actions).
- `npm test`: vitest.

## Notes
- Next.js 16: route handler `params` is a Promise.
- Server-side singletons (store, agent manager, resolver cache) live on `globalThis`, so they survive dev module reloads. The catch is that after editing `lib/store.ts` or anything it imports, you must restart the dev server, or the old store keeps running the old code.
- Claude Code on Windows may report a cwd as `C:\...` or `/c/...`. Use `normalizePath` when comparing paths and `toNativePath` before handing one to git or fs.
- **Design CLI from a worktree:** set `MONDO_DATA_DIR=C:/Users/alecv/Documents/Projects/mondoshawan/mondoshawan/data`. Otherwise it writes to the worktree's own `data/mondo.db`, not the real one.
- **Worktree packages:** link the main checkout's `node_modules` with a junction (`New-Item -ItemType Junction`) instead of installing. **Always unlink it first** with `cmd /c rmdir <worktree>\node_modules` before `git worktree remove`: git follows the junction and deletes the main checkout's packages. (It happened once; `npm install` in the main folder, with Mondo stopped, repairs it.) From Git Bash, `mklink` doesn't work; use PowerShell.
- **`findProject` takes a slug** (`projectSlug(name)`), not a project's display name.
- **Don't run `npm ci` in a worktree while a server runs from it:** it fails on file locks and leaves `node_modules` half-deleted.
- **A stale `.next/dev/types` breaks `next build`** after a route is deleted (it still references the old route). It's generated, so delete it.
- **Git Bash quoting:** heredocs and `node -e` scripts containing apostrophes break, and `\\d` inside a `node -e` template string loses its backslashes. Write scripts to a file with the editor instead.
- **Phone screenshots:** emulate a 390px phone through Edge's DevTools protocol, or use eqx-net's Playwright (`require("C:/Users/alecv/Documents/Projects/eqx-net/eqx-net/node_modules/playwright")`). Headless Edge's `--window-size` can't go below ~500px wide.
- **Design-tree freshness:** shown per node ("code changed since checked"); fix it with Regenerate. Agents writing Reality must read `origin/main`, because the project folder may be on an old branch (EQX-Net's main folder sat on `docs/auto-merge-pr-ritual` at `d36931c`).
