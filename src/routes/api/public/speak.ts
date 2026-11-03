import { createFileRoute } from "@tanstack/react-router";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
const REMOTE = "https://catalog-whisperer-hub.lovable.app/api/public/speak";

// Public: reads an assistant reply aloud (Arabic voice).
export const Route = createFileRoute("/api/public/speak")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { headers: cors }),
      POST: async ({ request }) => {
        let text = "";
        try {
          text = String(((await request.json()) as { text?: unknown }).text ?? "").trim().slice(0, 1500);
        } catch {
          /* ignore */
        }
        if (!text) return Response.json({ error: "empty" }, { status: 400, headers: cors });
        if (!process.env["LOVABLE_API_KEY"]) {
          const r = await fetch(REMOTE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
          return new Response(r.body, { status: r.status, headers: { ...cors, "content-type": r.headers.get("content-type") || "audio/wav" } });
        }
        try {
          const { generateSpeech } = await import("@lovable.dev/ai-gateway");
          const audio = await generateSpeech({
            model: "google/gemini-3.1-flash-tts-preview",
            contents: [{ role: "user", parts: [{ text: `اقرأ النص التالي بصوت رجل يمني، بلهجة يمنية صنعانية طبيعية ونبرة واضحة وسريعة، وليس بلهجة مصرية: ${text}` }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } } },
            },
          });
          return audio.toResponse({ headers: cors });
        } catch (e) {
          console.error("speak", e);
          return Response.json({ error: "failed" }, { status: 500, headers: cors });
        }
      },
    },
  },
});
