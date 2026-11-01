# Mondoshawan (Mondo)

A Windows desktop app that monitors local Claude Code sessions. See `design/brief.md` for purpose, principles and phases.

## Layout
- This folder (`Projects/mondoshawan/mondoshawan`) is the git repo. The outer `Projects/mondoshawan/` wrapper holds large material that stays out of the repo, the same pattern as `eqx-net/eqx-net`.
- `app/`: Next.js App Router (UI + API routes). `lib/`: server logic (config, paths, git, matching, store). `hooks/mondo-hook.js`: the Claude Code hook. `scripts/`: CLI helpers. `electron/`: desktop window.

## Working on this repo
- **Each agent works in its own branch and git worktree and opens a PR into `main`.** Never commit straight to `main` in the main checkout: several sessions often run at once. Commit and push freely on your branch.
- Remote: github.com/JanusBifrons/mondoshawan. Open PRs with `gh pr create`.

## Decisions (do not undo without discussion)
- **Next.js is the app; Electron is just a window.** Electron starts the Next server if nothing answers on the port, then loads it. The server must stay runnable alone (`npm run server`) for Phase 3 (phone over LAN).
- **Bind 127.0.0.1:4317 by default.** Host and port come from `MONDO_HOST`/`MONDO_PORT`, then from `mondo.config.json` `server`.
- **Phones reach Mondo through the LAN gateway, never directly, and only once approved on the PC** (`scripts/lan-gateway.mjs`, started by `scripts/serve.mjs` when `server.lan.enabled`; `MONDO_LAN=0` skips it). Next stays on loopback, so hooks and Electron need no auth.
  - Pairing: the Settings QR opens `/__mondo/pair?t=<token>` (token in `data/remote-token`). That only *requests* access: the gateway adds a pending row to the `devices` table with a 4-digit code and gives the phone a `mondo_device=<id>.<secret>` cookie (only a hash is stored). The PC's Mondo window shows "Allow this device?" (`components/pairing-prompt.tsx`, polling `/api/remote/devices`). Requests lapse after 10 minutes; at most 3 wait at once.
  - Approving, denying and revoking happen only on the PC: those routes refuse requests carrying `x-mondo-remote`. Settings lists approved devices with Revoke.
  - Every forwarded request needs an approved device. The gateway rejects cross-site Origins and forwards with Host/Origin rewritten plus `x-mondo-remote: 1`.
  - Gateway side: `scripts/lan-devices.mjs`. PC side: `lib/devices.ts`. They share the table SQL and timeout, and a test checks they match. **Never import a `.mjs` file into the Next app**: it puts the dev server into a reload loop.
- **Mondo starts and drives its own agents, but never touches sessions it didn't start.** Hand-started sessions are still watch-only (hooks). Agents (`lib/agents.ts`) are headless `claude -p --input-format stream-json --output-format stream-json --verbose --permission-prompts none` child processes:
  - messages and interrupts (`control_request` / `interrupt`) go in on stdin; events come out on stdout and are parsed by `lib/agent-events.ts` into `agent_entries`;
  - an agent can only start in a registered project or one of its existing worktrees, or make a new one with `--worktree <name>` (→ `.claude/worktrees/<name>`, branch `worktree-<name>`);
  - permission modes offered: auto (default), acceptEdits, plan, manual. Never bypassPermissions. Anything that would prompt is denied, because nobody is at a terminal;
  - agents die with the server; on startup any "running" agent is marked stopped, and Resume relaunches with `--resume <sessionId>` in its recorded cwd;
  - agents run with the user's hooks, so they also show on the Sessions page.
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
- **Mobile:** every page must work at 390px wide with no sideways scroll. Sessions switch to cards below `md`; the sidebar becomes a drawer that closes on navigation. Agents' chat view (`/agents/<id>`) is a full-height column with the composer pinned to the bottom.
- **Pages:** Sessions (`/`), Agents (`/agents`, `/agents/<id>`), Knowledge base (`/knowledge`, `/knowledge/<project>`), Settings (`/settings`), and "coming soon" placeholders (`/design`, `/roadmap`, `/prompts`).

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
- `npm test`: vitest.

## Notes
- Next.js 16: route handler `params` is a Promise.
- Server-side singletons (store, agent manager, resolver cache) live on `globalThis`, so they survive dev module reloads. The catch is that after editing `lib/store.ts` or anything it imports, you must restart the dev server, or the old store keeps running the old code.
- Claude Code on Windows may report a cwd as `C:\...` or `/c/...`. Use `normalizePath` when comparing paths and `toNativePath` before handing one to git or fs.
