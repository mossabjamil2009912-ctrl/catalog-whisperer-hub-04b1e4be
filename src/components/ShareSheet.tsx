import { useEffect, useState } from "react";
import { Copy, Mail, Send, X } from "lucide-react";
import { toast } from "sonner";

type Payload = { title: string; url: string };
const EVT = "open-share-sheet";

export async function shareLink(title: string, url: string) {
  const data = { title, text: title, url };
  if (typeof navigator !== "undefined" && navigator.share && (!navigator.canShare || navigator.canShare(data))) {
    try {
      await navigator.share(data);
      return;
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
    }
  }
  window.dispatchEvent(new CustomEvent<Payload>(EVT, { detail: { title, url } }));
}

export function ShareSheet() {
  const [p, setP] = useState<Payload | null>(null);
  useEffect(() => {
    const h = (e: Event) => setP((e as CustomEvent<Payload>).detail);
    window.addEventListener(EVT, h);
    return () => window.removeEventListener(EVT, h);
  }, []);
  if (!p) return null;
  const msg = encodeURIComponent(`${p.title}\n${p.url}`);
  const u = encodeURIComponent(p.url);
  const t = encodeURIComponent(p.title);
  const items = [
    { label: "واتساب", href: `https://wa.me/?text=${msg}`, icon: Send },
    { label: "تيليجرام", href: `https://t.me/share/url?url=${u}&text=${t}`, icon: Send },
    { label: "البريد", href: `mailto:?subject=${t}&body=${msg}`, icon: Mail },
  ];
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-foreground/60 sm:items-center" onClick={() => setP(null)}>
      <div className="w-full max-w-sm rounded-t-2xl bg-card p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-semibold">مشاركة الكتالوج</p>
          <button onClick={() => setP(null)} aria-label="إغلاق" className="rounded-lg p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>
        <p className="mb-4 truncate text-sm text-muted-foreground">{p.title}</p>
        <div className="grid grid-cols-4 gap-2">
          {items.map(({ label, href, icon: I }) => (
            <a key={label} href={href} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1 rounded-xl border border-border p-3 text-xs hover:border-primary hover:text-primary">
              <I className="h-5 w-5" />{label}
            </a>
          ))}
          <button
            onClick={async () => { await navigator.clipboard.writeText(p.url); toast.success("تم نسخ الرابط"); setP(null); }}
            className="flex flex-col items-center gap-1 rounded-xl border border-border p-3 text-xs hover:border-primary hover:text-primary"
          >
            <Copy className="h-5 w-5" />نسخ الرابط
          </button>
        </div>
      </div>
    </div>
  );
}
