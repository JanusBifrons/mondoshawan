# Mondoshawan — design brief

## Purpose
Mondoshawan ("Mondo") is a Windows desktop app that monitors the Claude Code sessions running on this machine. It is also the living **design bible** for each project (EQX-Net first): a versioned tree of design nodes running from what the game does today (written by agents from the code), through approved work in progress, up to ideas. It shows what is designed, what is built, and where the two differ. See the "Design bible" section in `CLAUDE.md`.

## How the owner works
- Windows with Git Bash. Each agent is started by hand: `cd` into a project folder (often a git worktree), then `claude`.
- 3+ Claude Code sessions run at once, each in its own git worktree.

## Principles
- **Mondo watches the sessions you start, and drives the agents it starts.** Hand-started sessions are watch-only; agents started from Mondo (desktop or phone) can be messaged, interrupted, stopped and resumed.
- **Never get in the way.** The hook fails silently and fast. If Mondo is closed, Claude Code behaves exactly as normal.
- **The server is the app.** Next.js serves both the UI and the API, and Electron is only a window. This means the same UI can later be served to a phone.
- **Keep it simple.** Storage is a JSON file with no native modules, which keeps Electron packaging painless. SQLite comes later.

## Phases
1. **Foundations.** Repo, docs, and a project registry (`mondo.config.json`). Mondo can read other repos' branches and worktrees.
2. **Basic app and terminal monitor.** Claude Code hooks POST events to Mondo, and a live dashboard shows each session's project, worktree, branch, status, last activity and a hand-typed "System" tag.
3. **Mobile access.** Serve the UI over the local network, with auth. *(Built: LAN gateway; phones pair by QR code and must be approved on the PC; phone layouts.)*
4. **Open terminals remotely.** *(Built as "Agents": headless Claude Code processes Mondo spawns, chats with and stops.)*

Later: prompt preparation, handoff files, knowledge base, design docs, AI features, packaging/installers.

## Session status model
| Hook event | Status |
|---|---|
| SessionStart | idle |
| UserPromptSubmit | working |
| PostToolUse | working (clears "needs permission" once a prompt is answered) |
| Stop | waiting for me |
| Notification (`permission_prompt`) | needs permission |
| Notification (`idle_prompt`) | waiting for me |
| SessionEnd | ended |
