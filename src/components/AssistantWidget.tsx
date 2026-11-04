import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Send, X, Loader2, Mic, Square, Volume2 } from "lucide-react";
import { askAssistant } from "@/lib/catalog.functions";
import { speakable } from "@/lib/speakable";
const logo = { url: "/actes-logo.png" };

type Msg = { role: "user" | "assistant"; content: string; sources?: { id: string; title: string }[] };



// Short spoken version: first 1–2 sentences without tables/markdown, so audio starts fast.
function speechText(t: string) {
  const clean = t
    .split("\n")
    .filter((l) => !l.trim().startsWith("|"))
    .join(" ")
    .replace(/[*#_`>|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = clean.match(/[^.!؟?\n]+[.!؟?]?/g) ?? [clean];
  let out = "";
  for (const p of parts) {
    if ((out + p).length > 220 && out) break;
    out += p;
  }
  return speakable(out.trim().slice(0, 260));
}



export function AssistantWidget() {
  const ask = useServerFn(askAssistant);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const [rec, setRec] = useState(false);
  const [playing, setPlaying] = useState<number | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const srRef = useRef<{ stop: () => void } | null>(null);

  function stopAudio() {
    audioRef.current?.pause();
    audioRef.current = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setPlaying(null);
  }

  // Fast path: device's built-in Arabic voice (instant, no download).
  function speakLocal(text: string, idx: number): boolean {
    if (!("speechSynthesis" in window)) return false;
    const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("ar"));
    if (!voices.length) return false;
    const male = voices.find((v) => /male|man|maged|tarik|naayf|hamed|ذكر/i.test(v.name) && !/female/i.test(v.name));
    const u = new SpeechSynthesisUtterance(text);
    const voice = male ?? voices[0]!;
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = 1.15;
    u.pitch = male ? 1 : 0.85;
    u.onend = () => setPlaying((p) => (p === idx ? null : p));
    u.onerror = () => setPlaying((p) => (p === idx ? null : p));
    window.speechSynthesis.speak(u);
    return true;
  }

  async function speak(text: string, idx: number) {
    stopAudio();
    setPlaying(idx);
    // Instant: phone's built-in voice first; server voice only if unavailable.
    if (speakLocal(text, idx)) return;
    try {
      const r = await fetch(`/api/public/speak`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) throw new Error();
      const url = URL.createObjectURL(await r.blob());
      const a = new Audio(url);
      audioRef.current = a;
      a.onended = () => { setPlaying((p) => (p === idx ? null : p)); URL.revokeObjectURL(url); };
      await a.play();
    } catch {
      if (!speakLocal(text, idx)) setPlaying(null);
    }
  }

  useEffect(() => {
    if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
  }, []);

  // Fast path: on-device speech recognition (text appears instantly, auto-ends on silence).
  function recLocal(): boolean {
    const W = window as unknown as Record<string, unknown>;
    const SR = (W["SpeechRecognition"] || W["webkitSpeechRecognition"]) as
      | (new () => {
          lang: string; interimResults: boolean; continuous: boolean;
          onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
          onend: () => void; onerror: () => void; start: () => void; stop: () => void;
        })
      | undefined;
    if (!SR) return false;
    const r = new SR();
    r.lang = "ar-YE";
    r.interimResults = false;
    r.continuous = false;
    let got = "";
    r.onresult = (e) => { got = Array.from(e.results).map((x) => x[0]?.transcript ?? "").join(" "); };
    r.onerror = () => {};
    r.onend = () => {
      setRec(false);
      srRef.current = null;
      if (got.trim()) void send(got, true);
    };
    try { r.start(); } catch { return false; }
    srRef.current = r;
    setRec(true);
    return true;
  }

  async function toggleRec() {
    if (rec) { srRef.current?.stop(); recRef.current?.stop(); return; }
    stopAudio();
    if (recLocal()) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      // Auto-stop: once speech is heard, stop after ~1.3s of silence (or 15s max / 6s with no speech).
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const t0 = Date.now();
      let spoke = false;
      let lastLoud = Date.now();
      const iv = window.setInterval(() => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += (v - 128) ** 2;
        const rms = Math.sqrt(sum / buf.length);
        const now = Date.now();
        if (rms > 8) { spoke = true; lastLoud = now; }
        if ((spoke && now - lastLoud > 800) || (!spoke && now - t0 > 6000) || now - t0 > 15000) {
          if (mr.state === "recording") mr.stop();
        }
      }, 100);
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = async () => {
        window.clearInterval(iv);
        void ctx.close();
        stream.getTracks().forEach((t) => t.stop());
        if (!spoke) { setRec(false); return; }
        setRec(false);
        const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
        if (blob.size < 1000) return;
        setBusy(true);
        try {
          const r = await fetch(`/api/public/transcribe`, { method: "POST", headers: { "content-type": blob.type }, body: blob });
          const { text } = (await r.json()) as { text?: string };
          setBusy(false);
          if (text) await send(text, true);
          else setMsgs((m) => [...m, { role: "assistant", content: "لم أسمعك جيداً، حاول مرة أخرى." }]);
        } catch {
          setBusy(false);
          setMsgs((m) => [...m, { role: "assistant", content: "تعذر فهم الصوت، حاول مرة أخرى." }]);
        }
      };
      recRef.current = mr;
      mr.start();
      setRec(true);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "يرجى السماح باستخدام المايك لتتحدث معي." }]);
    }
  }

  useEffect(() => () => { recRef.current?.state === "recording" && recRef.current.stop(); audioRef.current?.pause(); }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  async function send(text: string, voice = false) {
    const q = text.trim();
    if (!q) return;
    const next = [...msgs, { role: "user" as const, content: q }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const payload = { messages: next.map(({ role, content }) => ({ role, content })) };
      const res = await ask({ data: payload });
      setMsgs((m) => [...m, { role: "assistant", content: res.answer, sources: res.sources }]);
      if (voice) void speak(speechText(res.answer), next.length);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "عذراً، حدث خطأ. حاول مرة أخرى." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="المساعد الذكي"
          className="assistant-fab fixed bottom-5 left-5 z-50 flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-[3px] border-foreground bg-card p-1.5 shadow-glow ring-2 ring-foreground/50 ring-offset-2 ring-offset-background transition-transform hover:scale-105"
        >
          <img src={logo.url} alt="ACTES" className="h-full w-full object-contain" />
        </button>
      )}
      {open && (
        <div className="fixed inset-x-3 bottom-3 z-50 flex h-[78vh] flex-col overflow-hidden rounded-2xl border border-border bg-[#eef0f4] text-[#1f1f22] shadow-glow sm:inset-x-auto sm:left-5 sm:w-[400px]">
          <div className="flex items-center justify-between bg-gradient-to-l from-[#1e3a5f] to-[#2b5480] px-4 py-3 text-white">
            <div className="flex items-center gap-2 font-semibold">
              <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-[#1f1f22] p-1">
                <img src={logo.url} alt="ACTES" className="h-full w-full object-contain" />
                <span className="absolute -bottom-0.5 -left-0.5 h-3 w-3 rounded-full border-2 border-background bg-emerald-500" />
              </span>
              <div className="leading-tight">
                <div>المساعد الذكي</div>
                <div className="flex items-center gap-1 text-xs font-normal text-emerald-300">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  متصل الآن
                </div>
              </div>
            </div>
            <button onClick={() => { stopAudio(); setOpen(false); }} aria-label="إغلاق">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {msgs.length === 0 && (
              <div className="space-y-3 text-sm text-[#4b5563]">
                <p>مرحباً! اسألني عن أي منتج أو مواصفة في كتالوجاتنا.</p>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-start" : "flex justify-end"}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                    m.role === "user" ? "bg-primary text-primary-foreground" : "bg-white text-[#1f1f22] shadow-sm"
                  }`}
                >
                  {m.content}
                  {m.role === "assistant" && i > 0 && (
                    <button
                      type="button"
                      onClick={() => (playing === i ? stopAudio() : speak(speechText(m.content), i))}
                      aria-label={playing === i ? "إيقاف الصوت" : "استمع"}
                      className="mt-1 flex items-center gap-1 text-xs text-[#2b5480]"
                    >
                      {playing === i ? <Square className="h-3.5 w-3.5" /> : <Volume2 className="h-4 w-4" />}
                      {playing === i ? "إيقاف" : "استمع"}
                    </button>
                  )}
                  {m.sources && m.sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {m.sources.map((s) => (
                        <Link
                          key={s.id}
                          to="/catalog/$id"
                          params={{ id: s.id }}
                          onClick={() => setOpen(false)}
                          className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground hover:underline"
                        >
                          📄 {s.title}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-end">
                <div className="flex items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm text-[#4b5563]">
                  <Loader2 className="h-4 w-4 animate-spin" /> يبحث في الكتالوجات...
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex gap-2 border-t border-[#d6d9e0] p-3"
          >
            <button
              type="button"
              onClick={toggleRec}
              disabled={busy && !rec}
              aria-label={rec ? "إيقاف التسجيل وإرسال" : "تحدث بالصوت"}
              className={`shrink-0 rounded-xl px-3 text-white disabled:opacity-50 ${rec ? "animate-pulse bg-red-600" : "bg-[#2b5480]"}`}
            >
              {rec ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={rec ? "جاري التسجيل... اضغط للإرسال" : "اكتب سؤالك أو اضغط المايك..."}
              className="min-w-0 flex-1 rounded-xl border-2 border-[#c7cbd3] bg-white px-3 py-2 text-base text-[#1f1f22] outline-none placeholder:text-[#9ca3af] focus:border-emerald-500"
            />
            <button
              disabled={busy || !input.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-full bg-emerald-600 text-white disabled:opacity-40"
              aria-label="إرسال"
            >
              <ArrowUp className="h-5 w-5" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
