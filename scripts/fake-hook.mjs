// Fires fake Claude Code hook events at Mondo through the real hook script.
//   npm run fake                 full lifecycle (default)
//   npm run fake -- <scenario>   see --list
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hook = path.join(root, "hooks", "mondo-hook.js");
const cfg = JSON.parse(fs.readFileSync(path.join(root, "mondo.config.json"), "utf8"));

const eqx = cfg.projects.find((p) => /eqx/i.test(p.name))?.path ?? cfg.projects[0]?.path ?? root;
const wtDir = path.join(eqx, ".claude", "worktrees");
const worktrees = fs.existsSync(wtDir) ? fs.readdirSync(wtDir).map((d) => path.join(wtDir, d)) : [];
const pick = (i) => worktrees[i] ?? eqx;
// Git Bash style path, to exercise path normalising (/c/Users/... instead of C:\Users\...)
const toBash = (p) => p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fire(session, event, extra = {}) {
  const payload = {
    session_id: session.id,
    transcript_path: `C:/fake/${session.id}.jsonl`,
    cwd: session.cwd,
    hook_event_name: event,
    ...extra,
  };
  return new Promise((resolve) => {
    const t = Date.now();
    const child = spawn(process.execPath, [hook], { stdio: ["pipe", "inherit", "inherit"] });
    child.on("exit", (code) => {
      console.log(`  ${event.padEnd(17)} ${extra.notification_type ?? extra.source ?? extra.reason ?? ""}`.padEnd(48) +
        `${session.id}  (exit ${code}, ${Date.now() - t}ms)`);
      resolve();
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

const sid = (name) => `fake-${name}-${Math.random().toString(36).slice(2, 8)}`;
const step = Number(process.env.FAKE_STEP_MS ?? 1500);

const scenarios = {
  async full() {
    const s = { id: sid("full"), cwd: pick(0) };
    await fire(s, "SessionStart", { source: "startup" }); await sleep(step);
    await fire(s, "UserPromptSubmit", { prompt: "fix the thing" }); await sleep(step);
    await fire(s, "Notification", { notification_type: "permission_prompt", message: "Claude needs your permission to use Bash" }); await sleep(step);
    await fire(s, "PostToolUse", { tool_name: "Bash" }); await sleep(step);
    await fire(s, "Stop"); await sleep(step);
    await fire(s, "SessionEnd", { reason: "prompt_input_exit" });
  },
  async permission() {
    const s = { id: sid("perm"), cwd: toBash(pick(1)) };
    await fire(s, "SessionStart", { source: "startup" }); await sleep(step);
    await fire(s, "UserPromptSubmit", { prompt: "run the tests" }); await sleep(step);
    await fire(s, "Notification", { notification_type: "permission_prompt", message: "Claude needs your permission to use Bash" });
  },
  async multi() {
    const sessions = [
      { id: sid("main"), cwd: eqx },
      { id: sid("wt1"), cwd: toBash(pick(0)) },
      { id: sid("wt2"), cwd: path.join(pick(2), "src") },
      { id: sid("mondo"), cwd: root },
      { id: sid("other"), cwd: "C:/Users/Public" },
    ];
    for (const s of sessions) await fire(s, "SessionStart", { source: "startup" });
    await sleep(step);
    await fire(sessions[0], "UserPromptSubmit");
    await fire(sessions[1], "UserPromptSubmit");
    await sleep(step);
    await fire(sessions[1], "Stop");
    await fire(sessions[2], "UserPromptSubmit");
    await fire(sessions[2], "Notification", { notification_type: "permission_prompt", message: "Claude needs your permission to use Edit" });
  },
  async down() {
    // Point at a closed port to show the hook exits fast and cleanly when Mondo is not running.
    process.env.MONDO_PORT = "1";
    await fire({ id: sid("down"), cwd: eqx }, "SessionStart", { source: "startup" });
  },
};

const name = process.argv[2] ?? "full";
if (name === "--list" || !scenarios[name]) {
  console.log(`Scenarios: ${Object.keys(scenarios).join(", ")}`);
  process.exit(name === "--list" ? 0 : 1);
}
console.log(`Scenario "${name}" (step ${step}ms)`);
await scenarios[name]();
