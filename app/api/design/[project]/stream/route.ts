import { findProject } from "@/lib/config";
import { getDb } from "@/lib/db";
import { lastEventId } from "@/lib/design";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ project: string }> };

/**
 * Server-Sent Events: sends `{ lastEvent }` whenever the project's design changes.
 * Agents write through the CLI in another process, so this watches the event log in
 * the database (a cheap MAX(id) every 1.5s) rather than an in-memory emitter.
 */
export async function GET(req: Request, { params }: Ctx) {
  const project = findProject((await params).project);
  if (!project) return Response.json({ error: "unknown project" }, { status: 404 });
  const db = getDb();
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      let last = -1;
      const check = () => {
        const id = lastEventId(db, project.name);
        if (id !== last) {
          last = id;
          send(`data: ${JSON.stringify({ lastEvent: id })}\n\n`);
        }
      };
      check();
      const poll = setInterval(check, 1500);
      const heartbeat = setInterval(() => send(`: ping\n\n`), 15_000);
      cleanup = () => {
        clearInterval(poll);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
