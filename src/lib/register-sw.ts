// Single place that registers the offline service worker. Never runs in preview/dev.
const SW_URL = "/sw.js";

function isRefusedContext(): boolean {
  if (!import.meta.env.PROD) return true;
  try {
    if (window.self !== window.top) return true;
  } catch {
    return true;
  }
  const h = window.location.hostname.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  if (params.get("sw") === "off") return true;
  const previewDomain = /\.(lovable\.app|gpt-eng\.com|gptengineer\.run)$/.test(h);
  if (previewDomain && /^(?:id-preview|preview)(?:-[a-z0-9]+)?--.+$/.test(h.split(".")[0] ?? "")) return true;
  if (/^project--[^.]+-dev\.(lovable\.app|gpt-eng\.com|gptengineer\.run)$/.test(h)) return true;
  if (h === "lovableproject.com" || h.endsWith(".lovableproject.com")) return true;
  if (h === "lovableproject-dev.com" || h.endsWith(".lovableproject-dev.com")) return true;
  if (h === "beta.lovable.dev" || h.endsWith(".beta.lovable.dev")) return true;
  return false;
}

async function unregisterAppSw() {
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    regs
      .filter((r) => (r.active || r.waiting || r.installing)?.scriptURL.endsWith(SW_URL))
      .map((r) => r.unregister()),
  );
}

export function registerAppSw() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (isRefusedContext()) {
    unregisterAppSw().catch(() => {});
    return;
  }
  navigator.serviceWorker
    .register(SW_URL, { scope: "/" })
    .then(() => navigator.serviceWorker.ready)
    // Save the home page right away so the app opens without internet from the next launch.
    .then(() => caches.open("pages"))
    .then((c) => c.add(new Request("/", { cache: "reload" })))
    .catch(() => {});
}
