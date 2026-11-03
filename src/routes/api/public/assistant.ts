import { createFileRoute } from "@tanstack/react-router";
import { cleanMsgs, runAssistant } from "@/lib/catalog.functions";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

// Public endpoint so copies of the app hosted elsewhere can use the assistant.
// Only answers questions from public catalog content; returns no private data.
export const Route = createFileRoute("/api/public/assistant")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { headers: cors }),
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "bad request" }, { status: 400, headers: cors });
        }
        const data = cleanMsgs(body as { messages?: { role: "user" | "assistant"; content: string }[] });
        if (!data.messages.length) return Response.json({ error: "empty" }, { status: 400, headers: cors });
        const res = await runAssistant(data);
        return Response.json(res, { headers: cors });
      },
    },
  },
});
