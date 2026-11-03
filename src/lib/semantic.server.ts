// Server-only helpers for meaning-based (semantic) catalog search.
const GATEWAY = "https://ai.gateway.lovable.dev/v1";
export const EMBED_MODEL = "google/gemini-embedding-2";
const UNDERSTAND_MODEL = "openai/gpt-6-astra";

function key() {
  const k = process.env["LOVABLE_API_KEY"];
  if (!k) throw new Error("missing LOVABLE_API_KEY");
  return k;
}

async function post(path: string, body: unknown) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`${GATEWAY}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) return (await r.json()) as Record<string, unknown>;
    if (r.status !== 429 && r.status < 500) throw new Error(`gateway ${r.status}: ${(await r.text()).slice(0, 200)}`);
    await r.body?.cancel();
    await new Promise((res) => setTimeout(res, 800 * 2 ** attempt + Math.random() * 400));
  }
  throw new Error("gateway unavailable");
}

export async function embed(texts: string[]): Promise<number[][]> {
  const j = (await post("/embeddings", { model: EMBED_MODEL, input: texts })) as {
    data: { index: number; embedding: number[] }[];
  };
  return [...j.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export const toVector = (v: number[]) => `[${v.join(",")}]`;

export type Understanding = {
  catalog_ids: string[];
  search_query_en: string;
  search_query_ar: string;
  answer_language: "ar" | "en";
  needs_clarification: boolean;
};

const understandSchema = {
  type: "object",
  additionalProperties: false,
  required: ["catalog_ids", "search_query_en", "search_query_ar", "answer_language", "needs_clarification"],
  properties: {
    catalog_ids: { type: "array", items: { type: "string" } },
    search_query_en: { type: "string" },
    search_query_ar: { type: "string" },
    answer_language: { type: "string", enum: ["ar", "en"] },
    needs_clarification: { type: "boolean" },
  },
};

/** Reads the question (any dialect/language/typos) plus history and picks the catalogs the user means. */
export async function understandQuestion(
  history: { role: string; content: string }[],
  catalogs: { id: string; line: string }[],
): Promise<Understanding | null> {
  const convo = history
    .slice(-6)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 600)}`)
    .join("\n");
  const prompt = `You map a customer's question to product catalogs of a solar/energy company.
The user may write in any Arabic dialect (e.g. Yemeni), English, mixed, with typos, transliterations (فيدوس=FIDUS, داي=Deye, سوليس=Solis, بايلونتك=Pylontech), descriptions of function ("device that turns panel power into home power" = inverter), or specs ("battery that stores 10 kWh" -> batteries whose V x Ah is near 10 kWh).
Follow-ups ("its dimensions", "كم وزنها", "والأكبر؟") refer to the product discussed earlier in the conversation.
Return catalog_ids (up to 6, most relevant first, include every plausible candidate when ambiguous; only ids from the list), a precise English and Arabic search query that resolves pronouns and names models/specs, the language of the LAST user message, and needs_clarification only if it is truly impossible to guess.

Catalogs (id | title | keywords | type | models):
${catalogs.map((c) => `${c.id} | ${c.line}`).join("\n")}

Conversation:
${convo}`;
  try {
    const j = (await post("/chat/completions", {
      model: UNDERSTAND_MODEL,
      reasoning_effort: "low",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_schema", json_schema: { name: "understanding", strict: true, schema: understandSchema } },
    })) as { choices?: { message?: { content?: string } }[] };
    const raw = j.choices?.[0]?.message?.content;
    if (!raw) return null;
    const u = JSON.parse(raw) as Understanding;
    const valid = new Set(catalogs.map((c) => c.id));
    u.catalog_ids = u.catalog_ids.filter((id) => valid.has(id)).slice(0, 6);
    return u;
  } catch (e) {
    console.error("understandQuestion", e);
    return null;
  }
}
