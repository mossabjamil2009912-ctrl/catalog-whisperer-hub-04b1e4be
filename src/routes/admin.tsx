import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  addCategory,
  createUploadUrls,
  deleteCatalog,
  deleteCategory,
  saveCatalog,
  verifyAdmin,
} from "@/lib/catalog.functions";
import { catalogsQuery } from "./index";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "لوحة الإدارة — مكتبة الكتالوجات" },
      { name: "description", content: "إدارة الكتالوجات والأقسام." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "لوحة الإدارة" },
      { property: "og:description", content: "إدارة الكتالوجات والأقسام." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminPage,
});

const field = "w-full rounded-xl border border-input bg-background px-3 py-3 text-base outline-none focus:border-primary";

function AdminPage() {
  const [code, setCode] = useState<string | null>(null);
  const [entry, setEntry] = useState("");
  const verify = useServerFn(verifyAdmin);

  useEffect(() => {
    const saved = sessionStorage.getItem("admin_code");
    if (saved) setCode(saved);
  }, []);

  if (!code)
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await verify({ data: { code: entry } });
              sessionStorage.setItem("admin_code", entry);
              setCode(entry);
            } catch {
              toast.error("رمز الدخول غير صحيح");
            }
          }}
          className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6"
        >
          <h1 className="text-xl font-bold">دخول الإدارة</h1>
          <input type="password" inputMode="numeric" value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="رمز الدخول" className={field} />
          <button className="w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground">دخول</button>
        </form>
      </main>
    );
  return <Dashboard code={code} />;
}

function Dashboard({ code }: { code: string }) {
  const qc = useQueryClient();
  const { data } = useQuery(catalogsQuery);
  const getUrls = useServerFn(createUploadUrls);
  const save = useServerFn(saveCatalog);
  const del = useServerFn(deleteCatalog);
  const addCat = useServerFn(addCategory);
  const delCat = useServerFn(deleteCategory);
  const refresh = () => qc.invalidateQueries({ queryKey: ["catalogs"] });

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [keywords, setKeywords] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [language, setLanguage] = useState("ar");
  const [status, setStatus] = useState<string | null>(null);
  const [newCat, setNewCat] = useState("");

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !title.trim()) { toast.error("اختر ملف PDF واكتب الاسم"); return; }
    try {
      setStatus("جارٍ قراءة الكتالوج...");
      const { extractPdf } = await import("@/lib/pdf-extract");
      const { pages, cover, pageCount } = await extractPdf(file);
      setStatus("جارٍ رفع الملف...");
      const u = await getUrls({ data: { code } });
      const store = supabase.storage.from("catalogs");
      const r1 = await store.uploadToSignedUrl(u.filePath, u.fileToken, file, { contentType: "application/pdf" });
      if (r1.error) throw r1.error;
      const r2 = await store.uploadToSignedUrl(u.coverPath, u.coverToken, cover, { contentType: "image/jpeg" });
      setStatus("جارٍ الحفظ...");
      await save({
        data: {
          code,
          title: title.trim(),
          description: desc.trim(),
          keywords: keywords.trim(),
          category_id: categoryId || null,
          language,
          file_path: u.filePath,
          cover_path: r2.error ? null : u.coverPath,
          page_count: pageCount,
          pages,
        },
      });
      toast.success(pages.length ? "تمت الإضافة بنجاح" : "تمت الإضافة — تنبيه: الملف صور بلا نص، المساعد لن يقرأ محتواه");
      setFile(null);
      setTitle("");
      setDesc("");
      setKeywords("");
      (e.target as HTMLFormElement).reset();
      refresh();
    } catch (err) {
      console.error(err);
      toast.error("فشل الرفع");
    } finally {
      setStatus(null);
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-4 pb-28 pt-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">لوحة الإدارة</h1>
        <Link to="/" className="text-sm text-primary">عرض الموقع</Link>
      </div>

      <form onSubmit={upload} className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">إضافة كتالوج</h2>
        <input type="file" accept="application/pdf" onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setFile(f);
          if (f && !title) setTitle(f.name.replace(/\.pdf$/i, ""));
        }} className={field} />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="اسم الكتالوج (مثال: انفرتر سوليس 50kW)" className={field} />
        <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="كلمات بديلة (مثال: سوليز، solis، 50 كيلو)" className={field} />
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="وصف مختصر (اختياري)" rows={2} className={field} />
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={field}>
          <option value="">بدون قسم</option>
          {data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="لغة الكتالوج" className={field}>
          <option value="ar">عربي</option>
          <option value="en">English</option>
        </select>
        <button disabled={!!status} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground disabled:opacity-60">
          {status ? <><Loader2 className="h-5 w-5 animate-spin" /> {status}</> : <><Upload className="h-5 w-5" /> رفع الكتالوج</>}
        </button>
      </form>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">الأقسام</h2>
        <form className="flex gap-2" onSubmit={async (e) => {
          e.preventDefault();
          if (!newCat.trim()) return;
          await addCat({ data: { code, name: newCat } });
          setNewCat("");
          refresh();
        }}>
          <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="اسم القسم (مثال: انفرترات)" className={field} />
          <button className="rounded-xl bg-primary px-5 text-primary-foreground">إضافة</button>
        </form>
        <div className="flex flex-wrap gap-2">
          {data?.categories.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-sm">
              {c.name}
              <button onClick={async () => { if (confirm(`حذف قسم ${c.name}؟`)) { await delCat({ data: { code, id: c.id } }); refresh(); } }} aria-label="حذف">
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </button>
            </span>
          ))}
        </div>
      </section>

      <section className="space-y-2 rounded-2xl border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">الكتالوجات ({data?.catalogs.length ?? 0})</h2>
        {data?.catalogs.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 border-b border-border py-2 last:border-0">
            <Link to="/catalog/$id" params={{ id: c.id }} className="truncate hover:text-primary">{c.title} <span className="text-xs text-muted-foreground">({c.language === "en" ? "EN" : "عربي"})</span></Link>
            <button onClick={async () => { if (confirm(`حذف ${c.title}؟`)) { await del({ data: { code, id: c.id } }); refresh(); } }} aria-label="حذف">
              <Trash2 className="h-4 w-4 text-destructive" />
            </button>
          </div>
        ))}
      </section>
    </main>
  );
}
