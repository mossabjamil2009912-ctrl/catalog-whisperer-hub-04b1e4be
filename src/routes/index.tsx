import { shareLink } from "@/components/ShareSheet";
import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FileText, Search, Share2 } from "lucide-react";
import { toast } from "sonner";
import { CatalogViewer } from "@/components/CatalogViewer";
import { getCatalog, listCatalogs, searchCatalogs } from "@/lib/catalog.functions";
import { getRecent, prefetchCatalog } from "@/lib/pdf-cache";
const logo = { url: "/actes-logo.png" };

export const catalogsQuery = queryOptions({
  queryKey: ["catalogs"],
  queryFn: async () => {
    // Open instantly from the saved list; refresh it quietly for next time.
    if (typeof window !== "undefined") {
      const cached = localStorage.getItem("catalogs-list");
      if (cached) {
        listCatalogs().then((d) => { try { localStorage.setItem("catalogs-list", JSON.stringify(d)); } catch {} }).catch(() => {});
        return JSON.parse(cached) as Awaited<ReturnType<typeof listCatalogs>>;
      }
    }
    try {
      const d = await listCatalogs();
      if (typeof window !== "undefined") {
        try { localStorage.setItem("catalogs-list", JSON.stringify(d)); } catch {}
      }
      return d;
    } catch (e) {
      const saved = typeof window !== "undefined" ? localStorage.getItem("catalogs-list") : null;
      if (saved) return JSON.parse(saved) as Awaited<ReturnType<typeof listCatalogs>>;
      throw e;
    }
  },
});

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "مكتبة الكتالوجات — كل منتجاتنا في مكان واحد" },
      { name: "description", content: "ابحث في جميع كتالوجات منتجاتنا واسأل المساعد الذكي عن أي مواصفة." },
      { property: "og:title", content: "مكتبة الكتالوجات" },
      { property: "og:description", content: "ابحث في جميع كتالوجات منتجاتنا واسأل المساعد الذكي." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(catalogsQuery),
  component: Index,
});

const digits = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
const norm = (s: string) =>
  digits(s)
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/([\u0600-\u06FF])(\d)/g, "$1 $2")
    .replace(/(\d)([\u0600-\u06FF])/g, "$1 $2");

function pairUp<T extends { id: string; title: string; language: string }>(list: T[], keepOrder = false): T[] {
  const sorted = keepOrder ? list : [...list].sort((a, b) => a.title.localeCompare(b.title, "ar"));
  const out: T[] = [];
  const used = new Set<string>();
  for (const c of sorted) {
    if (used.has(c.id)) continue;
    used.add(c.id);
    const twin = sorted.find((x) => !used.has(x.id) && x.title === c.title && x.language !== c.language);
    if (twin) {
      used.add(twin.id);
      out.push(...(c.language === "en" ? [c, twin] : [twin, c]));
    } else out.push(c);
  }
  return out;
}

function Index() {
  const BRANDS = [
    { name: "Suntech", terms: ["suntech", "سانتك"] },
    { name: "Li Power", terms: ["li power", "لي باور", "bz4024"] },
    { name: "Deye", terms: ["deye", "داي"] },
    { name: "Solis", terms: ["solis", "سوليس"] },
    { name: "Pylontech", terms: ["pylontech", "بايلونتك", "powercube"] },
    { name: "HiTHIUM", terms: ["hithium", "هايثيوم", "heroee"] },
  ];
  const { data } = useSuspenseQuery(catalogsQuery);
  const search = useServerFn(searchCatalogs);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [fuzzy, setFuzzy] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const fetchCatalog = useServerFn(getCatalog);
  const prefetch = (id: string) => prefetchCatalog(id, fetchCatalog);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  useEffect(() => {
    const sync = () => setRecentIds(getRecent());
    sync();
    window.addEventListener("recent-changed", sync);
    return () => window.removeEventListener("recent-changed", sync);
  }, []);
  useEffect(() => {
    try { localStorage.setItem("catalogs-list", JSON.stringify(data)); } catch {}
    // Warm up the PDF viewer engine so the first catalog opens instantly.
    const t = setTimeout(() => { import("pdfjs-dist"); import("pdfjs-dist/build/pdf.worker.min.mjs?url"); }, 800);
    return () => clearTimeout(t);
  }, [data]);
  const recent = recentIds.map((id) => data.catalogs.find((c) => c.id === id)).filter((c): c is (typeof data.catalogs)[number] => !!c);
  const openCover = data.catalogs.find((c) => c.id === openId)?.cover_url ?? null;

  useEffect(() => {
    if (!q.trim()) { setFuzzy([]); return; }
    const t = setTimeout(() => search({ data: { q: norm(q) } }).then(setFuzzy).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q, search]);

  const results = useMemo(() => {
    let list = data.catalogs;
    const brand = BRANDS.find((b) => b.name === cat);
    if (brand) {
      list = list.filter((c) => {
        const hay = `${c.title} ${c.keywords}`.toLowerCase();
        return brand.terms.some((t) => hay.includes(t));
      });
    }
    if (!q.trim()) return pairUp(list);
    const words = norm(q).split(/\s+/).filter(Boolean);
    const direct = list.filter((c) => {
      const hay = norm(`${c.title} ${c.keywords} ${c.description}`);
      return words.every((w) => hay.includes(w));
    });
    if (direct.length) return pairUp(direct, true);
    const extra = fuzzy.map((id) => list.find((c) => c.id === id)).filter(Boolean);
    return pairUp(extra as typeof list, true);
  }, [data.catalogs, q, cat, fuzzy]);

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 pb-28 pt-4">
      <header className="mb-4 text-center">
        <img src={logo.url} alt="ACTES" className="mx-auto mb-4 h-14 w-auto object-contain sm:h-16" />
        <h1 className="text-3xl font-bold sm:text-4xl">
          مكتبة <span className="text-[#e85d3a]">الكتالوجات</span>
        </h1>
        <p className="mt-2 text-muted-foreground">ابحث عن كتالوج المنتج</p>
      </header>

      <div className="relative mx-auto mb-5 max-w-2xl">
        <Search className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ابحث باسم المنتج أو الموديل أو القدرة..."
          className="w-full rounded-2xl border-2 border-foreground bg-card py-4 pl-4 pr-12 text-lg outline-none transition placeholder:text-sm focus:border-emerald-500"
        />
      </div>

      <div className="mb-8 flex gap-2 overflow-x-auto pb-2 sm:flex-wrap sm:justify-center">
        <Chip active={!cat} onClick={() => setCat(null)}>الكل</Chip>
        {BRANDS.map((b) => (
          <Chip key={b.name} active={cat === b.name} onClick={() => setCat(b.name)}>
            {b.name}
          </Chip>
        ))}
      </div>


      {results.length === 0 ? (
        <div className="py-20 text-center text-muted-foreground">
          {data.catalogs.length === 0 ? "لا توجد كتالوجات بعد." : "لا توجد نتائج — جرّب سؤال المساعد الذكي."}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {results.map((c) => (
            <div
              key={c.id}
              className="group relative overflow-hidden rounded-2xl border border-border bg-card transition hover:-translate-y-1 hover:border-primary hover:shadow-glow"
            >
              <button type="button" onPointerEnter={() => prefetch(c.id)} onPointerDown={() => prefetch(c.id)} onClick={() => setOpenId(c.id)} className="block w-full text-right">
                <div className="relative aspect-[3/4] bg-muted">
                  {c.cover_url ? (
                    <img src={`/catalogs/${c.id}.jpg`} onError={(e) => { if (c.cover_url) e.currentTarget.src = c.cover_url; }} alt={c.title} loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <FileText className="h-12 w-12 text-muted-foreground" />
                    </div>
                  )}
                  <span className={`absolute right-2 top-2 rounded-full px-2.5 py-0.5 text-xs font-bold ${c.language === "en" ? "bg-blue-600 text-white" : "bg-destructive text-destructive-foreground"}`}>
                    {c.language === "en" ? "English" : "عربي"}
                  </span>
                </div>
                <div className="p-3 pl-12">
                  <h2 className="line-clamp-2 text-base font-bold leading-snug group-hover:text-primary">{c.title}</h2>
                  {c.category_id && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {data.categories.find((x) => x.id === c.category_id)?.name}
                    </p>
                  )}
                </div>
              </button>
              <button
                onClick={() => shareCatalog(c.id, c.title)}
                aria-label={`مشاركة ${c.title}`}
                className="absolute bottom-3 left-3 rounded-full border border-border bg-background p-2 text-muted-foreground hover:border-primary hover:text-primary"
              >
                <Share2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      <CatalogViewer id={openId} cover={openCover} onClose={() => setOpenId(null)} />
    </main>
  );
}

async function shareCatalog(id: string, title: string) {
  const url = `${window.location.origin}/catalog/${id}`;
  await shareLink(title, url);
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-4 py-2 text-sm transition ${
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary"
      }`}
    >
      {children}
    </button>
  );
}
