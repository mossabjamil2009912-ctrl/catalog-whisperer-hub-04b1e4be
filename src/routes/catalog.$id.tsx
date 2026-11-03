import { shareLink } from "@/components/ShareSheet";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowRight, Download, ExternalLink, Share2 } from "lucide-react";
import { toast } from "sonner";
import { getCatalog } from "@/lib/catalog.functions";

export const Route = createFileRoute("/catalog/$id")({
  loader: async ({ params }) => {
    const c = await getCatalog({ data: { id: params.id } });
    if (!c) throw notFound();
    return c;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `${loaderData.title} — مكتبة الكتالوجات` : "كتالوج" },
      { name: "description", content: loaderData?.description || "عرض وتحميل الكتالوج" },
      { property: "og:title", content: loaderData?.title ?? "كتالوج" },
      { property: "og:description", content: loaderData?.description || "عرض وتحميل الكتالوج" },
    ],
  }),
  notFoundComponent: () => (
    <div className="p-10 text-center">
      الكتالوج غير موجود. <Link to="/" className="text-primary">العودة</Link>
    </div>
  ),
  component: CatalogPage,
});

function CatalogPage() {
  const c = Route.useLoaderData();
  const share = async () => {
    const url = window.location.href;
    await shareLink(c.title, url);
  };
  return (
    <main className="mx-auto max-w-5xl px-4 pb-28 pt-6">
      <Link to="/" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowRight className="h-4 w-4" /> كل الكتالوجات
      </Link>
      <h1 className="text-2xl font-bold">{c.title}</h1>
      <p className="mt-1 flex items-center gap-2 text-sm text-primary">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${c.language === "en" ? "bg-blue-600 text-white" : "bg-destructive text-destructive-foreground"}`}>
          {c.language === "en" ? "English" : "عربي"}
        </span>
        {c.category}
      </p>
      {c.description && <p className="mt-2 text-muted-foreground">{c.description}</p>}
      <div className="my-5 flex flex-wrap gap-2">
        {c.file_url && (
          <a href={c.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground">
            <ExternalLink className="h-4 w-4" /> فتح الكتالوج
          </a>
        )}
        {c.download_url && (
          <a href={c.download_url} className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3">
            <Download className="h-4 w-4" /> تحميل
          </a>
        )}
        <button onClick={share} className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3">
          <Share2 className="h-4 w-4" /> مشاركة
        </button>
      </div>
      {c.file_url && (
        <iframe src={c.file_url} title={c.title} className="hidden h-[80vh] w-full rounded-2xl border border-border bg-card sm:block" />
      )}
    </main>
  );
}
