// Browser-only helpers: catalog info memo + PDF bytes cached on the device (keyed by catalog id,
// because signed file URLs change every time).
import { getCatalog } from "@/lib/catalog.functions";

type Cat = Awaited<ReturnType<typeof getCatalog>>;
const infoMemo = new Map<string, Promise<Cat>>();
const bytesMemo = new Map<string, Promise<ArrayBuffer>>();
const CACHE = "catalog-pdfs-v1";

export function loadCatalogInfo(id: string, fetcher: (a: { data: { id: string } }) => Promise<Cat>) {
  let p = infoMemo.get(id);
  if (!p) {
    p = fetcher({ data: { id } })
      .then((c) => {
        try { if (c) localStorage.setItem(`cat-info:${id}`, JSON.stringify(c)); } catch {}
        return c;
      })
      .catch((e) => {
        infoMemo.delete(id);
        const saved = localStorage.getItem(`cat-info:${id}`);
        if (saved) return JSON.parse(saved) as Cat;
        throw e;
      });
    infoMemo.set(id, p);
  }
  return p;
}

export function loadPdfBytes(id: string, url: string): Promise<ArrayBuffer> {
  let p = bytesMemo.get(id);
  if (!p) {
    p = (async () => {
      const key = `/__catalog/${id}`;
      const cache = "caches" in window ? await caches.open(CACHE).catch(() => null) : null;
      const hit = await cache?.match(key);
      if (hit) return hit.arrayBuffer();
      // Catalogs bundled inside the app itself.
      const local = await fetch(`/catalogs/${id}.pdf`).catch(() => null);
      if (local?.ok && (local.headers.get("content-type") ?? "").includes("pdf")) {
        const buf = await local.arrayBuffer();
        cache?.put(key, new Response(buf.slice(0), { headers: { "content-type": "application/pdf" } })).catch(() => {});
        return buf;
      }
      if (!url) throw new Error("offline");
      const res = await fetch(url);
      if (!res.ok) throw new Error("fetch failed");
      const buf = await res.arrayBuffer();
      cache?.put(key, new Response(buf.slice(0), { headers: { "content-type": "application/pdf" } })).catch(() => {});
      return buf;
    })().catch((e) => {
      bytesMemo.delete(id);
      throw e;
    });
    bytesMemo.set(id, p);
  }
  return p;
}

export function prefetchCatalog(id: string, fetcher: (a: { data: { id: string } }) => Promise<Cat>) {
  loadCatalogInfo(id, fetcher)
    .then((c) => (c?.file_url ? loadPdfBytes(id, c.file_url) : undefined))
    .catch(() => {});
}

const RECENT = "recent-catalogs";
export function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT) || "[]");
  } catch {
    return [];
  }
}
export function pushRecent(id: string) {
  const list = [id, ...getRecent().filter((x) => x !== id)].slice(0, 4);
  localStorage.setItem(RECENT, JSON.stringify(list));
  window.dispatchEvent(new Event("recent-changed"));
}

export async function isPdfSaved(id: string) {
  if (!("caches" in window)) return false;
  const cache = await caches.open(CACHE);
  return !!(await cache.match(`/__catalog/${id}`));
}

let downloading = false;
/** Saves every catalog PDF on the device, one after another, so all of them open without internet. */
export async function downloadAll(
  ids: string[],
  fetcher: (a: { data: { id: string } }) => Promise<Cat>,
  onProgress: (done: number, total: number) => void,
) {
  if (downloading || !("caches" in window)) return;
  downloading = true;
  let done = 0;
  try {
    for (const id of ids) {
      try {
        if (!(await isPdfSaved(id))) {
          const c = await loadCatalogInfo(id, fetcher);
          if (c?.file_url) await loadPdfBytes(id, c.file_url);
        } else {
          await loadCatalogInfo(id, fetcher).catch(() => null);
        }
        done++;
      } catch {
        if (!navigator.onLine) break;
      }
      onProgress(done, ids.length);
    }
  } finally {
    downloading = false;
  }
}
