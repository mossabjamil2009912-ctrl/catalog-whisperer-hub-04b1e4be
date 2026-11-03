// Browser-only: extract text per page and render page 1 as a JPEG cover.
export async function extractPdf(file: File) {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: { page: number; content: string }[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const text = tc.items.map((it) => ("str" in it ? it.str : "")).join(" ");
    if (text.trim()) pages.push({ page: i, content: text });
  }
  const first = await pdf.getPage(1);
  const vp = first.getViewport({ scale: 1 });
  const scale = 600 / vp.width;
  const viewport = first.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await first.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
  const cover = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 0.82));
  return { pages, cover, pageCount: pdf.numPages };
}
