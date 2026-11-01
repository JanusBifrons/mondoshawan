import { findProject, projectSlug } from "@/lib/config";
import { MODELS, PERMISSION_MODES, getAgents, type PermissionMode } from "@/lib/agents";
import { listWorktrees } from "@/lib/git";
import { forbidden, isCrossSite } from "@/lib/guard";
import { normalizePath, toNativePath } from "@/lib/paths";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ agents: getAgents().list(), now: Date.now() });
}

const WORKTREE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

/**
 * Start an agent. Body: { project (slug), cwd (the project path or one of its worktrees),
 * newWorktree?, name?, model?, permissionMode?, prompt? }.
 * The folder must belong to a registered project, so nobody can start Claude anywhere else.
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

  const newWorktree = str("newWorktree");
  if (newWorktree && !WORKTREE_NAME.test(newWorktree)) {
    return Response.json({ error: "worktree name: letters, numbers, . _ - (max 40)" }, { status: 400 });
  }
  const model = str("model");
  if (!(MODELS as readonly string[]).includes(model)) return Response.json({ error: "unknown model" }, { status: 400 });
  const permissionMode = (str("permissionMode") || "auto") as PermissionMode;
  if (!PERMISSION_MODES.includes(permissionMode)) {
    return Response.json({ error: "unknown permission mode" }, { status: 400 });
  }
  const prompt = str("prompt").slice(0, 20_000);
  const count = getAgents().list().filter((a) => a.project === project.name).length;
  const name = (str("name") || newWorktree || `${projectSlug(project.name)}-${count + 1}`).slice(0, 60);

  const agent = getAgents().spawn({
    name,
    project: project.name,
    cwd: toNativePath(cwd),
    worktreeName: newWorktree || null,
    model: model || null,
    permissionMode,
    prompt,
  });
  return Response.json(agent, { status: 201 });
}
