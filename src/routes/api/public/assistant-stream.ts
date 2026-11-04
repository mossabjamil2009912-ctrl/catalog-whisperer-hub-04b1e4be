import { createFileRoute } from "@tanstack/react-router";
import { cleanMsgs, streamAssistant } from "@/lib/catalog.functions";

// Public streaming endpoint: answers only from public catalog content; returns no private data.
export const Route = createFileRoute("/api/public/assistant-stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "bad request" }, { status: 400 });
        }
        const data = cleanMsgs(body as { messages?: { role: "user" | "assistant"; content: string }[] });
        if (!data.messages.length) return Response.json({ error: "empty" }, { status: 400 });
        const stream = await streamAssistant(data);
        return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" } });
      },
    },
  },
});
