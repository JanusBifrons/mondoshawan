import { openTrustPrompt } from "@/lib/agents";
import { folderTrusted } from "@/lib/claude-trust";
import { loadConfig } from "@/lib/config";
import { isRemote } from "@/lib/devices";
import { forbidden, isCrossSite } from "@/lib/guard";
import { toNativePath } from "@/lib/paths";

export const dynamic = "force-dynamic";

/** Each registered project's main folder and whether Claude trusts it. */
export function GET() {
  return Response.json({
    projects: loadConfig().projects.map((p) => ({ name: p.name, path: p.path, trusted: folderTrusted(p.path) })),
  });
}

/**
 * Open a trust window for every project Claude doesn't trust yet, all at once, so the
 * user answers them in one sitting. PC only: the windows open on the PC.
 */
export function POST(req: Request) {
  if (isCrossSite(req)) return forbidden();
  if (isRemote(req)) return Response.json({ error: "do this at the PC" }, { status: 403 });
  const opened: string[] = [];
  const errors: string[] = [];
  for (const p of loadConfig().projects) {
    if (folderTrusted(p.path)) continue;
    const err = openTrustPrompt(p.name, toNativePath(p.path));
    if (err) errors.push(`${p.name}: ${err}`);
    else opened.push(p.name);
  }
  return Response.json({ opened, errors });
}
