export const dynamic = "force-dynamic";

/** Used by Electron and scripts to tell whether Mondo's server is already up. */
export function GET() {
  return Response.json({ ok: true, app: "mondoshawan" });
}
