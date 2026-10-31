# Mondoshawan

Mondo is a desktop dashboard for the Claude Code sessions running on this machine. For each session it shows the project, worktree, branch, status and how long ago it was last active, plus a "System" tag you type yourself.

## Quick start
```bash
npm install
npm run dev            # opens the Mondo window (starts the server for you)
```

Server only, viewable in a browser at http://127.0.0.1:4317:
```bash
npm run server:dev     # or: npm run build && npm run server
```

## Connecting Claude Code
```bash
npm run hooks:install              # shows what would change in ~/.claude/settings.json
npm run hooks:install -- --apply   # backs up the file, then merges Mondo's hooks
npm run hooks:uninstall            # removes only Mondo's hooks (with backup)
```
Hooks only apply to Claude Code sessions started after they're installed. If Mondo isn't running, the hook gives up silently within about 1 second and Claude Code carries on as normal.

## Testing without real sessions
```bash
npm run fake                 # full lifecycle in an EQX-Net worktree
npm run fake -- permission   # stops at "needs permission"
npm run fake -- --list       # list scenarios
```

## Other commands
- `npm run check:projects`: confirms each registered project exists, and shows its branch and worktrees.
- `npm test`: unit tests.

## Pages
- **Sessions:** live Claude Code sessions.
- **Knowledge base:** docs from every project in one list, searchable and filterable, with a reading pane. It draws on repo markdown, folders outside the repo, and linked Google Drive docs.
- **Settings:** hook install status, server address, and registered projects.

## Configuration
`mondo.config.json` holds the project registry and the server host and port. The `MONDO_HOST` and `MONDO_PORT` environment variables override the config.

Each project can add knowledge sources:
```json
"knowledge": {
  "folders": [{ "path": "C:/.../eqx-net/Design", "label": "Design folder" }],
  "exclude": ["diag/", "src/"],
  "drive": { "folder": "EQX-Net" },
  "links": [{ "title": "Some page", "url": "https://...", "source": "Web" }]
}
```

## Google Drive sync
Each project can mirror one Google Drive folder into Mondo's local database. Mondo can't reach Drive on its own, so a Claude session does the sync through the Google Drive connector. In a Claude session opened in this folder, say **"sync Drive"** (or `/drive-sync`). Mondo doesn't need to be running. Last-sync status is on the Settings page.

Data lives in `data/mondo.db` (SQLite).

See `design/brief.md` for the bigger picture and `CLAUDE.md` for design decisions.
