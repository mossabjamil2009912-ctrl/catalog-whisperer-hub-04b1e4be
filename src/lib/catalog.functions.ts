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

    const sem = await import("@/lib/semantic.server");
    const { fuseRanks } = await import("@/lib/rank");
    type Hit = { catalog_id: string; title: string; page: number; content: string; score: number };
    const [{ data: cats }, { data: profs }] = await Promise.all([
      sb.from("catalogs").select("id,title,keywords"),
      sb.from("catalog_profiles").select("catalog_id,specs"),
    ]);
    type Prof = { product_type?: string; models?: string[]; summary_en?: string; specs?: { model: string; key_specs: string }[] };
    const profOf = new Map((profs ?? []).map((p) => [p.catalog_id as string, p.specs as Prof]));
    const catLines = (cats ?? []).map((c) => {
      const p = profOf.get(c.id);
      return { id: c.id, line: `${c.title} | ${c.keywords} | ${p?.product_type ?? ""} | ${(p?.models ?? []).join(", ").slice(0, 200)}` };
    });

    // 1) Understand the question (meaning, dialect, follow-ups) + embed it, alongside keyword searches.
    const embedText = [prev, last].filter(Boolean).join("\n");
    const [u, qEmb, { data: a }, { data: b }, ...partRes] = await Promise.all([
      sem.understandQuestion(data.messages, catLines),
      sem.embed([embedText]).then((v) => v[0]).catch((e) => (console.error("embed", e), null)),
      sb.rpc("search_chunks", { q: last, lim: isCompare ? 6 : 7 }),
      prev ? sb.rpc("search_chunks", { q: `${prev} ${last}`, lim: 4 }) : Promise.resolve({ data: [] }),
      ...(parts.length > 1 ? parts.slice(0, 4).map((p) => sb.rpc("search_chunks", { q: p, lim: 7 })) : []),
    ]);
    // 2) Semantic + cross-language searches.
    const vec = qEmb ? sem.toVector(qEmb) : null;
    const [semChunks, semProfs, enRes] = await Promise.all([
      vec ? sb.rpc("match_chunks", { query_embedding: vec, lim: 12 }).then((r) => (r.data ?? []) as Hit[]) : Promise.resolve([] as Hit[]),
      vec ? sb.rpc("match_profiles", { query_embedding: vec, lim: 6 }).then((r) => (r.data ?? []) as { catalog_id: string; score: number }[]) : Promise.resolve([]),
      u?.search_query_en ? sb.rpc("search_chunks", { q: u.search_query_en, lim: 6 }).then((r) => (r.data ?? []) as Hit[]) : Promise.resolve([] as Hit[]),
    ]);

    const base: Hit[] = [...semChunks, ...((a as Hit[]) ?? []), ...((b as Hit[]) ?? []), ...enRes, ...partRes.flatMap((r) => (r.data as Hit[]) ?? [])];
    // Direct model match: brand + power number (e.g. "Solis 20" -> catalog whose keywords contain "20K").
    const modelIds: string[] = [];
    for (const p of [...(parts.length > 1 ? parts : [last]), u?.search_query_en ?? ""]) {
      const brand = p.match(/Deye|Solis|Pylontech|Suntech|HiTHIUM|Li Power|FIDUS/i)?.[0]?.toLowerCase();
      const nums = p.match(/\d+(?:\.\d+)?/g) ?? [];
      for (const c of catLines) {
        const hay = c.line.toLowerCase();
        if (brand && !hay.includes(brand)) continue;
        if (nums.some((n) => new RegExp(`(^|[^\\d.])${n}(k|kw|kwh|ah|w)?\\b`, "i").test(hay)) && !modelIds.includes(c.id))
          modelIds.push(c.id);
      }
    }
    const ids = (r: { catalog_id: string }[] | null | undefined) => (r ?? []).map((x) => x.catalog_id);
    const topIds = fuseRanks(
      [u?.catalog_ids ?? [], modelIds.slice(0, 6), ids(semProfs), ids(semChunks), ids(a as Hit[]), ids(enRes)],
      60,
      [3, 1.5, 1.5, 1, 0.7, 0.7],
    ).slice(0, u?.catalog_ids.length ? Math.max(4, u.catalog_ids.length) : 5);
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
    const noisy = (t: string) => (t.match(/[\uFB50-\uFEFF]/g)?.length ?? 0) > 20 || (t.match(/\u202B|\u202C/g)?.length ?? 0) > 20;
    const chunks = [...full, ...base].filter((c) => {
      if (noisy(c.content)) return false;
      const k = `${c.catalog_id}-${c.page}-${c.content.slice(0, 40)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 60);

    const profileText = topIds
      .map((id) => {
        const p = profOf.get(id);
        if (!p) return "";
        return `[ملف المنتج: ${titleOf.get(id)}]\nType: ${p.product_type}\n${p.summary_en}\n${(p.specs ?? []).map((s) => `${s.model}: ${s.key_specs}`).join("\n")}`;
      })
      .filter(Boolean)
      .join("\n\n");
    const context = [profileText, chunks.map((c) => `[كتالوج: ${c.title} | id: ${c.catalog_id} | صفحة ${c.page}]\n${c.content}`).join("\n\n---\n\n")]
      .filter(Boolean)
      .join("\n\n===\n\n");
    const list = catLines.map((c) => `- ${c.line}`).join("\n");
    const lang = u?.answer_language ?? (/[\u0600-\u06FF]/.test(last) ? "ar" : "en");

    const system = `أنت خبير منتجات لشركة طاقة شمسية، تعرف كل كتالوجات منتجاتها. ${lang === "en" ? "Answer in ENGLISH (the user wrote in English)." : "أجب بالعربية."} إجابة مباشرة ومختصرة جداً (جملة واحدة غالباً) بدون مقدمات.
- ممنوع تماماً أي تحية أو مقدمة أو خاتمة (مثل: مرحباً، بالتأكيد، بخصوص، يسعدني، هل تحتاج شيئاً آخر).
- ابدأ الإجابة بالمعلومة نفسها مباشرة، ولا تعِد صياغة السؤال. مثال: سؤال "ما سعة بطارية RV12100CH؟" ← الجواب "100Ah، 1280Wh، 12.8V." وليس "سعة بطارية RV12100CH هي...".
- اعتمد فقط على ملفات المنتجات والمقتطفات المرفقة. لا تخترع منتجات أو موديلات أو أرقاماً أو توافقاً فنياً.
- افهم المعنى لا الكلمات: المستخدم قد يكتب بلهجة عامية أو بأخطاء إملائية أو بلغة مختلفة عن الكتالوج، أو يصف وظيفة المنتج (مثل "جهاز يحول كهرباء الألواح لكهرباء البيت" = انفرتر)، أو يطلب مواصفة (مثل "بطارية 10 كيلو" = بطارية جهدها × سعتها ≈ 10kWh، احسبها: 51.2V × 200Ah = 10.24kWh).
- فرّق بين الطاقة الاسمية والقابلة للاستخدام إن توفرتا.
- إذا كان التطابق جزئياً أو تقريبياً فقل ذلك صراحة، وإذا احتمل الطلب أكثر من منتج فاذكرها باختصار مع الفرق الأساسي. إذا كان الطلب غامضاً جداً فاسأل سؤالاً توضيحياً واحداً.
- لأسئلة المتابعة (مثل "كم أبعادها؟") اعتمد على المنتج المذكور سابقاً في المحادثة ولا تخلطه بغيره.
- احتفظ بأسماء الموديلات والعلامات التجارية كما هي دون ترجمة.
- لا تستخدم كلمة "بطاقة" أبداً للتعبير عن الطاقة أو السعة؛ استخدم كلمة "بقدرة" بدلاً منها (مثال: "بقدرة 1280 واط ساعة").
- لا تذكر اسم الكتالوج ولا رقم الصفحة ولا أي مصدر.
- عند طلب مقارنة أو اختيار الأفضل: قدّم مقارنة مختصرة في نقاط قصيرة (القدرة، الجهد، عدد MPPT أو السعة، الكفاءة، أهم ميزة) لكل منتج، ثم سطر واحد بالخلاصة. بدون مقدمات.
- بعض النصوص العربية في المقتطفات قد تكون مشوشة الحروف؛ اعتمد على ملف المنتج والأرقام والنسخة الإنجليزية.
- اقرأ جداول المواصفات (DATASHEET) كاملة بعناية: القيم مرتبة بنفس ترتيب الموديلات في سطر Models، وقيمة واحدة تعني أنها مشتركة لكل الموديلات. مثال: "MPPT number / Max. input strings number 3/6 4/8" مع "Models 29.9K 30K 40K 50K" تعني 3 MPPT لـ29.9K و30K، و4 MPPT لـ40K و50K.
- قبل أن تقول إن معلومة أو منتجاً غير موجود، راجع كل ملفات المنتجات والمقتطفات وقائمة الكتالوجات؛ وإذا وُجد منتج قريب فاذكره بدل النفي.
- إذا لم تجد المعلومة فعلاً فقل بوضوح إنها غير موجودة في الكتالوجات المتاحة.

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
