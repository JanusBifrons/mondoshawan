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
- **Pages:** Sessions (`/`), Knowledge base (`/knowledge`, `/knowledge/<project>`), Settings (`/settings`), and "coming soon" placeholders (`/design`, `/roadmap`, `/prompts`).

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

## Commands
- `npm run dev`: Electron window plus the Next dev server.
- `npm run server` / `npm run server:dev`: server only.
- `npm run check:projects`: verify registered projects, branches and worktrees.
- `npm run fake -- <scenario>`: fire fake hook events.
- `npm run hooks:install` (dry run), then `npm run hooks:install -- --apply`; `npm run hooks:uninstall`.
- `npm run drive:status` / `npm run drive:import -- <payload.json>`: Drive mirror (used by the drive-sync skill).
- `npm test`: vitest.

## Notes
- Next.js 16: route handler `params` is a Promise.
- Server-side singletons (store, resolver cache) live on `globalThis`, so they survive dev module reloads. The catch is that after editing `lib/store.ts` or anything it imports, you must restart the dev server, or the old store keeps running the old code.
- Claude Code on Windows may report a cwd as `C:\...` or `/c/...`. Use `normalizePath` when comparing paths and `toNativePath` before handing one to git or fs.
