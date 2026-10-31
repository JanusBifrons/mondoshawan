/**
 * Block cross-site requests: any web page can send requests to 127.0.0.1, so for
 * state-changing routes we reject requests whose Origin isn't this server.
 * The hook script (Node) sends no Origin header, so it passes.
 */
export function isCrossSite(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers.get("host");
  } catch {
    return true;
  }
}

export function forbidden() {
  return Response.json({ error: "cross-site request blocked" }, { status: 403 });
}
