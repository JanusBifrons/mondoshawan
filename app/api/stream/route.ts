import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Server-Sent Events: pushes the full session list on every change. */
export function GET(req: Request) {
  const store = getStore();
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
      const snapshot = () =>
        send(`data: ${JSON.stringify({ sessions: store.list(), now: Date.now() })}\n\n`);

      snapshot();
      store.on("change", snapshot);
      const heartbeat = setInterval(() => send(`: ping\n\n`), 15_000);

      cleanup = () => {
        clearInterval(heartbeat);
        store.off("change", snapshot);
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
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
