import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { loadPdfBytes } from "@/lib/pdf-cache";

// Renders PDF pages as canvases. Page 1 first; other pages render only when scrolled near.
// Bytes are cached on the device so reopening is instant.
export function PdfPages({ id, url, cover }: { id: string; url: string; cover?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let doc: { destroy: () => Promise<void> } | null = null;
    const tasks: { cancel: () => void }[] = [];

    const box = ref.current;
    if (!box) return;
    box.innerHTML = "";
    setLoading(true);
    setError(false);
    (async () => {
      try {
        const [pdfjs, workerMod, data] = await Promise.all([
          import("pdfjs-dist"),
          import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
          loadPdfBytes(id, url),
        ]);
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default;
        // Font helpers are bundled in the app: no internet wait (Arabic fonts needed these).
        const task = pdfjs.getDocument({
          data: new Uint8Array(data.slice(0)),
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          wasmUrl: "/pdfjs/wasm/",
          useSystemFonts: false,
          disableFontFace: true,
        });
        doc = task;
        const pdf = await task.promise;
        if (cancelled) return;
        const width = box.clientWidth || 800;
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const pages = await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1)));
        if (cancelled) return;
        const canvases = pages.map((page) => {
          const b = page.getViewport({ scale: 1 });
          const canvas = document.createElement("canvas");
          canvas.style.aspectRatio = `${b.width} / ${b.height}`;
          canvas.className = "mb-2 block w-full rounded-lg bg-white shadow";
          box.appendChild(canvas);
          return canvas;
        });
        const draw = async (i: number, target: number) => {
          const page = pages[i]!;
          const b = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: target / b.width });
          const off = document.createElement("canvas");
          off.width = viewport.width;
          off.height = viewport.height;
          const t = page.render({ canvas: off, canvasContext: off.getContext("2d")!, viewport });
          tasks.push(t);
          await t.promise;
          if (cancelled) return;
          const c = canvases[i]!;
          c.width = off.width;
          c.height = off.height;
          c.getContext("2d")!.drawImage(off, 0, 0);
        };
        // 1) Fast pass at screen sharpness, one page after another (page 1 shows first).
        const quick = Math.min(Math.max(width * dpr, 900), 1400);
        for (let i = 0; i < pages.length; i++) {
          await draw(i, quick);
          if (cancelled) return;
          if (i === 0) setLoading(false);
        }
        // 2) Sharp pass for zooming, done quietly afterwards.
        const sharp = Math.min(Math.max(width * dpr * 2.5, 1600), 2400);
        for (let i = 0; i < pages.length; i++) {
          await draw(i, sharp);
          if (cancelled) return;
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      tasks.forEach((t) => { try { t.cancel(); } catch {} });
      doc?.destroy().catch(() => {});
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="h-full overflow-y-auto overscroll-contain p-2">
      {loading && (
        <div className="relative">
          {cover ? (
            <img src={cover} alt="" className="w-full rounded-lg bg-white opacity-80 shadow" />
          ) : (
            <div className="h-40" />
          )}
          <Loader2 className="absolute left-1/2 top-20 h-8 w-8 -translate-x-1/2 animate-spin text-primary" />
        </div>
      )}
      {error && <p className="p-6 text-center text-muted-foreground">تعذر عرض الكتالوج — استخدم زر التحميل.</p>}
      <TransformWrapper
        minScale={1}
        maxScale={5}
        panning={{ disabled: !zoomed }}
        doubleClick={{ mode: zoomed ? "reset" : "zoomIn", step: 1 }}
        wheel={{ activationKeys: ["Control"] }}
        onTransform={(_, s) => setZoomed(s.scale > 1.01)}
      >
        <TransformComponent wrapperStyle={{ width: "100%", overflow: "visible" }} contentStyle={{ width: "100%" }}>
          <div ref={ref} className="w-full" />
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}
