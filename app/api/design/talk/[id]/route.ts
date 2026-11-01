import { findProject, projectSlug } from "@/lib/config";
import { getDb } from "@/lib/db";
import { DesignError } from "@/lib/design";
import { decide, getTalk, say, stopTalk, verifyTalk } from "@/lib/design-talk";
import { codeChanges } from "@/lib/design-freshness";
import { forbidden, isCrossSite } from "@/lib/guard";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const fail = (err: unknown) => {
  if (err instanceof DesignError) return Response.json({ error: err.message }, { status: err.status });
  throw err;
};

/** A design talk: every turn, the agent's replies and proposals. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const talk = getTalk(getDb(), (await params).id);
    const project = findProject(projectSlug(talk.project));
    return Response.json({ talk, slug: project ? projectSlug(project.name) : null });
  } catch (err) {
    return fail(err);
  }
}

/**
 * { action: "say", text } | { action: "decide", jobId, index, decision: "approve" | "idea" | "revise" | "skip", note? } | { action: "verify" } (check against the code) | { action: "stop" }.
 * Approve saves it as the owner, signs its Intent and moves the node to approved; idea saves it and keeps
 * it an idea; revise sends the owner's tweak (note) back to the agent. Each starts the agent's next turn.
 */
export async function POST(req: Request, { params }: Ctx) {
  if (isCrossSite(req)) return forbidden();
  const id = (await params).id;
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    const db = getDb();
    const project = findProject(projectSlug(getTalk(db, id).project));
    if (!project) return Response.json({ error: "this talk's project is no longer set up" }, { status: 404 });
    // Refresh which nodes are stale (cached; fetches at most every 10 minutes), so the agent's brief is current.
    if (b.action !== "stop") await codeChanges(db, project).catch(() => null);
    switch (b.action) {
      case "verify":
        return Response.json({ talk: verifyTalk(db, project, id) });
      case "say":
        return Response.json({ talk: say(db, project, id, typeof b.text === "string" ? b.text : "") });
      case "decide":
        if (typeof b.jobId !== "string" || typeof b.index !== "number") return Response.json({ error: "jobId and index required" }, { status: 400 });
        {
          // decision: "draft" | "approve" | "skip" (older pages send approve: true/false).
          const known = ["approve", "idea", "revise", "skip", "draft"] as const;
          const d = known.find((k) => k === b.decision) ?? (b.approve === true ? "draft" : "skip");
          return Response.json({ talk: decide(db, project, id, b.jobId, b.index, d, typeof b.note === "string" ? b.note : undefined) });
        }
      case "stop":
        return Response.json({ talk: stopTalk(db, id) });
      default:
        return Response.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (err) {
    return fail(err);
  }
}
