import { findProject, projectSlug } from "@/lib/config";
import { MODELS, PERMISSION_MODES, getAgents, type PermissionMode } from "@/lib/agents";
import { agentViews } from "@/lib/agent-views";
import { folderTrust } from "@/lib/claude-trust";
import { listWorktrees } from "@/lib/git";
import { forbidden, isCrossSite } from "@/lib/guard";
import { normalizePath, toNativePath } from "@/lib/paths";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ agents: agentViews(), now: Date.now() });
}

const WORKTREE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

/** Generated worktree name, e.g. "eqx-net-1104-a3f". */
const autoName = (project: string) => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${projectSlug(project)}-${p(d.getHours())}${p(d.getMinutes())}-${Math.random().toString(36).slice(2, 5)}`;
};

/**
 * Start an agent. Body: { project (slug), cwd (the project path or one of its worktrees),
 * newWorktree? (true for an auto name, or a name), name?, model?, permissionMode?, prompt? }.
 * The folder must belong to a registered project and be one Claude already trusts.
 */
export async function POST(req: Request) {
  if (isCrossSite(req)) return forbidden();
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");

  const project = findProject(str("project"));
  if (!project) return Response.json({ error: "unknown project" }, { status: 400 });

  const places = [project.path, ...(await listWorktrees(toNativePath(project.path))).map((w) => w.path)];
  const wanted = normalizePath(str("cwd") || project.path);
  const cwd = places.find((p) => normalizePath(p) === wanted);
  if (!cwd) return Response.json({ error: "folder is not this project or one of its worktrees" }, { status: 400 });

  const trust = folderTrust(cwd);
  if (!trust.trusted) {
    return Response.json(
      {
        error: `Claude hasn't been told to trust ${toNativePath(cwd)} yet, so the agent would stop at that question in its window. At the PC, open Git Bash in that folder, run claude once and choose "Yes, I trust this folder".`,
        code: "untrusted",
      },
      { status: 409 },
    );
  }

  const wt = b.newWorktree === true ? autoName(project.name) : str("newWorktree");
  if (wt && !WORKTREE_NAME.test(wt)) {
    return Response.json({ error: "worktree name: letters, numbers, . _ - (max 40)" }, { status: 400 });
  }
  const model = str("model");
  if (!(MODELS as readonly string[]).includes(model)) return Response.json({ error: "unknown model" }, { status: 400 });
  const permissionMode = (str("permissionMode") || "auto") as PermissionMode;
  if (!PERMISSION_MODES.includes(permissionMode)) {
    return Response.json({ error: "unknown permission mode" }, { status: 400 });
  }
  const count = getAgents().list().filter((a) => a.project === project.name).length;
  const name = (str("name") || wt || `${projectSlug(project.name)}-${count + 1}`).slice(0, 60);

  const agent = getAgents().spawn({
    name,
    project: project.name,
    cwd: toNativePath(cwd),
    worktreeName: wt || null,
    model: model || null,
    permissionMode,
    prompt: str("prompt").slice(0, 20_000),
  });
  return Response.json(agent, { status: 201 });
}
