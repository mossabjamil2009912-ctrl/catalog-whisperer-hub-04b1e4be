import { createFileRoute } from "@tanstack/react-router";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
const MAX = 8 * 1024 * 1024;

// Public: turns a short voice recording into text for the catalog assistant.
export const Route = createFileRoute("/api/public/transcribe")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { headers: cors }),
      POST: async ({ request }) => {
        const buf = await request.arrayBuffer();
        if (!buf.byteLength || buf.byteLength > MAX)
          return Response.json({ error: "bad audio" }, { status: 400, headers: cors });
        const type = request.headers.get("content-type") || "audio/webm";
        try {
          const { transcribeAudio } = await import("@lovable.dev/ai-gateway");
          const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : "webm";
          const file = new File([buf], `voice.${ext}`, { type });
          const res = await transcribeAudio({ model: "openai/gpt-transcribe", file, language: "ar", response_format: "json" });
          const text = typeof res === "string" ? res : (res as { text?: string }).text ?? "";
          return Response.json({ text: text.trim() }, { headers: cors });
        } catch (e) {
          console.error("transcribe", e);
          return Response.json({ error: "failed" }, { status: 500, headers: cors });
        }
      },
    },
  },
});
