# Mondoshawan (Mondo)

A Windows desktop app that monitors local Claude Code sessions. See `design/brief.md` for purpose, principles and phases.

## Layout
- This folder (`Projects/mondoshawan/mondoshawan`) is the git repo. The outer `Projects/mondoshawan/` wrapper holds large material that stays out of the repo, the same pattern as `eqx-net/eqx-net`.
- `app/`: Next.js App Router (UI + API routes). `lib/`: server logic (config, paths, git, matching, store). `hooks/mondo-hook.js`: the Claude Code hook. `scripts/`: CLI helpers. `electron/`: desktop window.

## Decisions (do not undo without discussion)
- **Next.js is the app; Electron is just a window.** Electron starts the Next server if nothing answers on the port, then loads it. The server must stay runnable alone (`npm run server`) for Phase 3 (phone over LAN).
- **Bind 127.0.0.1:4317 by default.** Host and port come from `MONDO_HOST`/`MONDO_PORT`, then from `mondo.config.json` `server`. LAN access needs auth first (Phase 3).
- **Mondo never starts, stops or controls Claude Code sessions** in the MVP.
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
- **Pages:** Sessions (`/`), Knowledge base (`/knowledge`, `/knowledge/<project>`), Settings (`/settings`), Design bible (`/design`, `/design/<project>`), and "coming soon" placeholders (`/roadmap`, `/prompts`).

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
- **Live refresh:** every change logs a `design_events` row. `/api/design/<project>/stream` polls `MAX(id)`, so CLI writes from other processes show up too.
- **Seeding:** the `design-survey` skill (`.claude/skills/design-survey/SKILL.md`) has a Claude session survey one system at a time from the code.
- **Later:** harden, impact and verify jobs run through Mondo's agent spawner; "Produce design document" exports.

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
- Server-side singletons (store, resolver cache) live on `globalThis`, so they survive dev module reloads. The catch is that after editing `lib/store.ts` or anything it imports, you must restart the dev server, or the old store keeps running the old code.
- Claude Code on Windows may report a cwd as `C:\...` or `/c/...`. Use `normalizePath` when comparing paths and `toNativePath` before handing one to git or fs.
