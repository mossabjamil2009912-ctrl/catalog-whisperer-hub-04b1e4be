import { createServerFn } from "@tanstack/react-start";

const BUCKET = "catalogs";

// Falls back to the public client on external hosts that lack the service key (reads only).
async function admin() {
  if (!process.env["SUPABASE_SERVICE_ROLE_KEY"]) {
    const { supabase } = await import("@/integrations/supabase/client");
    return supabase as unknown as Awaited<
      typeof import("@/integrations/supabase/client.server")
    >["supabaseAdmin"];
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function checkCode(code: string) {
  if (code !== "2027") throw new Error("رمز الدخول غير صحيح");
}

export type CatalogItem = {
  id: string;
  title: string;
  description: string;
  keywords: string;
  category_id: string | null;
  language: string;
  page_count: number;
  created_at: string;
  cover_url: string | null;
};

export const listCatalogs = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const [{ data: cats }, { data: rows }] = await Promise.all([
    sb.from("categories").select("id,name").order("name"),
    sb.from("catalogs").select("*").order("created_at", { ascending: false }),
  ]);
  const list = rows ?? [];
  const covers = list.map((r) => r.cover_path).filter((p): p is string => !!p && !p.startsWith("/"));
  const urlMap = new Map<string, string>();
  if (covers.length) {
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(covers, 60 * 60 * 24);
    data?.forEach((d) => d.path && d.signedUrl && urlMap.set(d.path, d.signedUrl));
  }
  const catalogs: CatalogItem[] = list.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    keywords: r.keywords,
    category_id: r.category_id,
    language: r.language,
    page_count: r.page_count,
    created_at: r.created_at,
    cover_url: r.cover_path ? (r.cover_path.startsWith("/") ? r.cover_path : (urlMap.get(r.cover_path) ?? null)) : null,
  }));
  return { categories: cats ?? [], catalogs };
});

export const searchCatalogs = createServerFn({ method: "POST" })
  .inputValidator((d: { q: string }) => ({ q: String(d.q ?? "").slice(0, 200) }))
  .handler(async ({ data }) => {
    if (!data.q.trim()) return [] as string[];
    const sb = await admin();
    const { data: rows } = await sb.rpc("search_catalogs", { q: data.q });
    return (rows ?? []).map((r) => r.id);
  });

export const getCatalog = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => ({ id: String(d.id) }))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: row } = await sb.from("catalogs").select("*, categories(name)").eq("id", data.id).maybeSingle();
    if (!row) return null;
    if (row.file_path.startsWith("/")) {
      return {
        id: row.id, title: row.title, description: row.description, language: row.language,
        category: (row.categories as { name: string } | null)?.name ?? null,
        page_count: row.page_count, file_url: row.file_path, download_url: row.file_path,
      };
    }
    const { data: file } = await sb.storage.from(BUCKET).createSignedUrl(row.file_path, 60 * 60 * 6);
    const { data: dl } = await sb.storage
      .from(BUCKET)
      .createSignedUrl(row.file_path, 60 * 60 * 6, { download: `${row.title}.pdf` });
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      language: row.language,
      category: (row.categories as { name: string } | null)?.name ?? null,
      page_count: row.page_count,
      file_url: file?.signedUrl ?? null,
      download_url: dl?.signedUrl ?? null,
    };
  });

/* ---------- Assistant ---------- */

type Msg = { role: "user" | "assistant"; content: string };

const REMOTE_ASSISTANT = "https://catalog-whisperer-hub.lovable.app/api/public/assistant";

export function cleanMsgs(d: { messages?: Msg[] }) {
  return {
    messages: (d?.messages ?? []).slice(-10).map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: String(m.content).slice(0, 2000),
    })),
  };
}

export const askAssistant = createServerFn({ method: "POST" })
  .inputValidator((d: { messages: Msg[] }) => cleanMsgs(d))
  .handler(async ({ data }) => {
    if (!process.env["LOVABLE_API_KEY"]) {
      // Hosted elsewhere (e.g. Vercel): forward the question to the main app.
      try {
        const r = await fetch(REMOTE_ASSISTANT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data),
        });
        const j = (await r.json()) as { answer?: string };
        return { answer: j.answer ?? "عذراً، حدث خطأ مؤقت. حاول مرة أخرى.", sources: [] as { id: string; title: string }[] };
      } catch (e) {
        console.error(e);
        return { answer: "عذراً، حدث خطأ مؤقت. حاول مرة أخرى.", sources: [] as { id: string; title: string }[] };
      }
    }
    return runAssistant(data);
  });

export async function runAssistant(data: { messages: Msg[] }) {
  {
    const sb = await admin();
    const userMsgs = data.messages.filter((m) => m.role === "user");
    const dg = (s: string) =>
      s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
    const alias = (s: string) =>
      s
        .replace(/دا[يى]|ديي|ديا[يى]/g, " Deye ")
        .replace(/سول[يى][سز]/g, " Solis ")
        .replace(/بايلونتك|بيلونتك|بايلون/g, " Pylontech ")
        .replace(/سانتك|صنتك/g, " Suntech ")
        .replace(/هايث[يى]وم|ه[يى]ث[يى]وم/g, " HiTHIUM ")
        .replace(/ل[يى] ?باور/g, " Li Power ")
        .replace(/([A-Za-z]) +(\d)/g, "$1 $2")
        .replace(/\s+/g, " ")
        .trim();
    const last = alias(dg(userMsgs[userMsgs.length - 1]?.content ?? ""));
    const prev = alias(dg(userMsgs[userMsgs.length - 2]?.content ?? ""));

    // Split comparison questions into separate product parts so each product gets its own specs.
    const parts = last
      .split(/\s+(?:و|مع|vs\.?|versus|or|أو|او|and)\s+|،|,|\s+بين\s+|قارن|مقارنة|الفرق/i)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);
    const isCompare = parts.length > 1 || /قارن|مقارن|الفرق|افضل|أفضل|vs|compare/i.test(last);

    const [{ data: a }, { data: b }, { data: cats }, ...partRes] = await Promise.all([
      sb.rpc("search_chunks", { q: last, lim: isCompare ? 6 : 7 }),
      prev ? sb.rpc("search_chunks", { q: `${prev} ${last}`, lim: 4 }) : Promise.resolve({ data: [] }),
      sb.from("catalogs").select("id,title,keywords"),
      ...(parts.length > 1 ? parts.slice(0, 4).map((p) => sb.rpc("search_chunks", { q: p, lim: 7 })) : []),
    ]);
    // Always add every English/clean chunk of the top matching catalogs so no spec (e.g. MPPT) is missed.
    const base = [...(a ?? []), ...((b as typeof a) ?? []), ...partRes.flatMap((r) => (r.data as typeof a) ?? [])];
    const topIds: string[] = [];
    // Direct model match: brand + power number (e.g. "Solis 20" -> catalog whose keywords contain "20K").
    for (const p of parts.length > 1 ? parts : [last]) {
      const brand = p.match(/Deye|Solis|Pylontech|Suntech|HiTHIUM|Li Power/i)?.[0]?.toLowerCase();
      const nums = p.match(/\d+(?:\.\d+)?/g) ?? [];
      for (const c of cats ?? []) {
        const hay = `${c.title} ${c.keywords}`.toLowerCase();
        if (brand && !hay.includes(brand)) continue;
        if (nums.some((n) => new RegExp(`(^|[^\\d.])${n}(k|kw|ah)?\\b`, "i").test(hay)) && !topIds.includes(c.id))
          topIds.push(c.id);
      }
    }
    for (const r of [a ?? [], ...partRes.map((r) => (r.data as typeof a) ?? [])]) {
      for (const c of r.slice(0, 2)) if (!topIds.includes(c.catalog_id)) topIds.push(c.catalog_id);
    }
    const titleOf = new Map((cats ?? []).map((c) => [c.id as string, c.title as string]));
    let full: typeof base = [];
    if (topIds.length) {
      const { data: rows } = await sb
        .from("catalog_chunks")
        .select("catalog_id,page,content")
        .in("catalog_id", topIds.slice(0, 6));
      const garbled = (t: string) => (t.match(/[\uFB50-\uFEFF]/g)?.length ?? 0) > 20 || (t.match(/\u202B|\u202C/g)?.length ?? 0) > 20;
      full = (rows ?? [])
        .filter((r) => !garbled(r.content))
        .map((r) => ({ ...r, title: titleOf.get(r.catalog_id) ?? "", score: 0 }));
    }
    const seen = new Set<string>();
    const chunks = [...full, ...base].filter((c) => {
      const k = `${c.catalog_id}-${c.page}-${c.content.slice(0, 40)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    if (process.env.DEBUG_CTX) console.log("CTX", topIds, chunks.map((c) => c.title.slice(0, 30) + " p" + c.page + " " + c.content.slice(0, 30)));
    const context = chunks
      .map((c) => `[كتالوج: ${c.title} | id: ${c.catalog_id} | صفحة ${c.page}]\n${c.content}`)
      .join("\n\n---\n\n");
    const list = (cats ?? []).map((c) => `- ${c.title}${c.keywords ? ` (${c.keywords})` : ""}`).join("\n");

    const system = `أنت مساعد ذكي لشركة، تعرف كل كتالوجات منتجاتها. أجب بالعربية بإجابة مباشرة ومختصرة جداً (جملة واحدة غالباً) بدون مقدمات.
- ممنوع تماماً أي تحية أو مقدمة أو خاتمة (مثل: مرحباً، بالتأكيد، بخصوص، يسعدني، هل تحتاج شيئاً آخر).
- ابدأ الإجابة بالمعلومة نفسها مباشرة، ولا تعِد صياغة السؤال. مثال: سؤال "ما سعة بطارية RV12100CH؟" ← الجواب "100Ah، 1280Wh، 12.8V." وليس "سعة بطارية RV12100CH هي...".
- اعتمد فقط على المقتطفات المرفقة من الكتالوجات. لا تخترع أرقاماً أو مواصفات.
- لا تستخدم كلمة "بطاقة" أبداً للتعبير عن الطاقة أو السعة؛ استخدم كلمة "بقدرة" بدلاً منها (مثال: "بقدرة 1280 واط ساعة").
- افهم الأسماء المكتوبة بشكل تقريبي (مثل "سوليز 50" = "Solis 50kW").
- لا تذكر اسم الكتالوج ولا رقم الصفحة ولا أي مصدر.
- عند طلب مقارنة أو اختيار الأفضل: قدّم مقارنة مختصرة في نقاط قصيرة (القدرة، الجهد، عدد MPPT أو السعة، الكفاءة، أهم ميزة) لكل منتج، ثم سطر واحد بالخلاصة. بدون مقدمات.
- بعض النصوص العربية في المقتطفات قد تكون مشوشة الحروف؛ اعتمد على الأرقام والموديلات والنسخة الإنجليزية للمنتج نفسه.
- إذا لم تجد المعلومة فقل بوضوح إنها غير موجودة في الكتالوجات المتاحة.

قائمة الكتالوجات المتاحة:
${list || "(لا توجد كتالوجات بعد)"}

مقتطفات ذات صلة:
${context || "(لا توجد مقتطفات مطابقة)"}`;

    const { generateChatCompletion } = await import("@lovable.dev/ai-gateway");
    try {
      const res = await generateChatCompletion({
        model: "openai/gpt-6-astra",
        messages: [{ role: "system", content: system }, ...data.messages],
      });
      const text = res.choices?.[0]?.message?.content;
      const sources = Array.from(
        new Map(chunks.slice(0, 4).map((c) => [c.catalog_id, { id: c.catalog_id, title: c.title }])).values(),
      );
      return { answer: typeof text === "string" ? text : "عذراً، لم أتمكن من الإجابة.", sources: [] as typeof sources };
    } catch (e) {
      console.error(e);
      return { answer: "عذراً، حدث خطأ مؤقت. حاول مرة أخرى.", sources: [] };
    }
  }
}

/* ---------- Admin ---------- */

export const verifyAdmin = createServerFn({ method: "POST" })
  .inputValidator((d: { code: string }) => d)
  .handler(async ({ data }) => {
    checkCode(data.code);
    return { ok: true };
  });

export const createUploadUrls = createServerFn({ method: "POST" })
  .inputValidator((d: { code: string }) => d)
  .handler(async ({ data }) => {
    checkCode(data.code);
    const sb = await admin();
    const id = crypto.randomUUID();
    const filePath = `files/${id}.pdf`;
    const coverPath = `covers/${id}.jpg`;
    const [f, c] = await Promise.all([
      sb.storage.from(BUCKET).createSignedUploadUrl(filePath),
      sb.storage.from(BUCKET).createSignedUploadUrl(coverPath),
    ]);
    if (f.error || c.error) throw new Error("تعذر تجهيز الرفع");
    return { filePath, coverPath, fileToken: f.data.token, coverToken: c.data.token };
  });

export const saveCatalog = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      code: string;
      title: string;
      description: string;
      keywords: string;
      category_id: string | null;
      language?: string;
      file_path: string;
      cover_path: string | null;
      page_count: number;
      pages: { page: number; content: string }[];
    }) => d,
  )
  .handler(async ({ data }) => {
    checkCode(data.code);
    const sb = await admin();
    const { data: row, error } = await sb
      .from("catalogs")
      .insert({
        title: data.title,
        description: data.description,
        keywords: data.keywords,
        category_id: data.category_id || null,
        language: data.language === "en" ? "en" : "ar",
        file_path: data.file_path,
        cover_path: data.cover_path,
        page_count: data.page_count,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const rows: { catalog_id: string; page: number; content: string }[] = [];
    for (const p of data.pages) {
      const text = p.content.replace(/\s+/g, " ").trim();
      for (let i = 0; i < text.length; i += 1200) {
        rows.push({ catalog_id: row.id, page: p.page, content: text.slice(Math.max(0, i - 150), i + 1200) });
      }
    }
    for (let i = 0; i < rows.length; i += 500) {
      await sb.from("catalog_chunks").insert(rows.slice(i, i + 500));
    }
    return { id: row.id, chunks: rows.length };
  });

export const deleteCatalog = createServerFn({ method: "POST" })
  .inputValidator((d: { code: string; id: string }) => d)
  .handler(async ({ data }) => {
    checkCode(data.code);
    const sb = await admin();
    const { data: row } = await sb.from("catalogs").select("file_path,cover_path").eq("id", data.id).single();
    if (row) {
      await sb.storage.from(BUCKET).remove([row.file_path, ...(row.cover_path ? [row.cover_path] : [])]);
    }
    await sb.from("catalogs").delete().eq("id", data.id);
    return { ok: true };
  });

export const addCategory = createServerFn({ method: "POST" })
  .inputValidator((d: { code: string; name: string }) => d)
  .handler(async ({ data }) => {
    checkCode(data.code);
    const sb = await admin();
    await sb.from("categories").insert({ name: data.name.trim() });
    return { ok: true };
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .inputValidator((d: { code: string; id: string }) => d)
  .handler(async ({ data }) => {
    checkCode(data.code);
    const sb = await admin();
    await sb.from("categories").delete().eq("id", data.id);
    return { ok: true };
  });
