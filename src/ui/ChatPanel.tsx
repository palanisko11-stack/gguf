import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CoderEngine,
  MODELS,
  SYSTEM_PROMPT,
  customModel,
  detectSystem,
  recommendModelId,
  type ChatMessage,
  type ChatModel,
  type SystemInfo,
} from "../llm/coderEngine";
import { IconClose } from "./controls";

type Phase = "detect" | "idle" | "loading" | "ready" | "error";

interface ThreadMsg {
  role: "user" | "assistant";
  content: string;
}

const nf1 = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 });

function SysChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-coal-700/80 bg-coal-950/70 px-2 py-1">
      <div className="font-mono text-[8px] tracking-[0.16em] text-sand-500 uppercase">{label}</div>
      <div className="truncate font-mono text-[10.5px] text-sand-200">{value}</div>
    </div>
  );
}

function Dots() {
  return (
    <span className="inline-flex items-center gap-1 px-1 py-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-lamp-400"
          style={{ animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </span>
  );
}

const SUGGESTIONS = [
  "Napiš v C++ funkci pro sphere tracing SDF koule",
  "Vysvětli kvantizaci Q4_K_M v GGUF",
  "Jak funguje RoPE v transformeru?",
];

export default function ChatPanel({ onClose }: { onClose: () => void }) {
  const engineRef = useRef<CoderEngine | null>(null);
  if (!engineRef.current) engineRef.current = new CoderEngine();
  const engine = engineRef.current;
  const genTextRef = useRef<string | null>(null);

  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [phase, setPhase] = useState<Phase>("detect");
  const [model, setModel] = useState<ChatModel | null>(null);
  const [recommendedId, setRecommendedId] = useState<string>("qwen-coder-0.5b");
  const [customUrl, setCustomUrl] = useState("");

  const [prog, setProg] = useState<{ loaded: number; total: number } | null>(null);
  const [loadSec, setLoadSec] = useState(0);
  const loadStartRef = useRef(0);

  const [thread, setThread] = useState<ThreadMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const [genText, setGenText] = useState<string | null>(null);
  const [waitingFirst, setWaitingFirst] = useState(false);
  const [stats, setStats] = useState<{ tps: number; tokens: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");

  const threadRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);

  // detekce systému + doporučení
  useEffect(() => {
    let alive = true;
    detectSystem().then((s) => {
      if (!alive) return;
      setSys(s);
      const rec = recommendModelId(s);
      setRecommendedId(rec);
      setModel(MODELS.find((m) => m.id === rec) ?? MODELS[0]);
      setPhase("idle");
    });
    return () => {
      alive = false;
    };
  }, []);

  // timer stahování
  useEffect(() => {
    if (phase !== "loading") {
      if (timerRef.current) window.clearInterval(timerRef.current);
      return;
    }
    loadStartRef.current = Date.now();
    timerRef.current = window.setInterval(() => setLoadSec((Date.now() - loadStartRef.current) / 1000), 250);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [phase]);

  // autoscroll
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread, genText, waitingFirst, phase]);

  const pickModel = useCallback(
    (m: ChatModel) => {
      if (busy || phase === "loading") return;
      setModel(m);
      setPhase("idle");
      setError(null);
    },
    [busy, phase]
  );

  const activate = useCallback(async () => {
    if (!model || busy) return;
    if (engine.isLoaded(model.url)) {
      setPhase("ready");
      return;
    }
    setPhase("loading");
    setError(null);
    setProg(null);
    setLoadSec(0);
    try {
      await engine.load(model, (loaded, total) => setProg({ loaded, total }));
      setPhase("ready");
      setProg(null);
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [model, busy, engine]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy || phase !== "ready") return;
      const nextThread: ThreadMsg[] = [...thread, { role: "user", content: trimmed }];
      setThread(nextThread);
      setInput("");
      setBusy(true);
      setWaitingFirst(true);
      setGenText(null);
      setStats(null);

      const history: ChatMessage[] = [
        SYSTEM_PROMPT,
        ...nextThread.slice(-7).map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
      ];
      try {
        const res = await engine.chat(history, (t) => {
          setWaitingFirst(false);
          setGenText(t);
        });
        setThread((cur) => [...cur, { role: "assistant", content: genTextRef.current ?? "" }]);
        setGenText(null);
        setStats({ tps: res.ms > 0 ? (res.tokens / res.ms) * 1000 : 0, tokens: res.tokens });
      } catch (e) {
        if (engine.wasAborted()) {
          const partial = genTextRef.current;
          if (partial) setThread((cur) => [...cur, { role: "assistant", content: partial + " ▌" }]);
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
        setGenText(null);
      } finally {
        setWaitingFirst(false);
        setBusy(false);
      }
    },
    [thread, busy, phase, engine]
  );

  // mirror genText do ref pro použití v catch/setThread
  useEffect(() => {
    genTextRef.current = genText;
  }, [genText]);

  const pct = useMemo(() => {
    if (!prog || !prog.total) return null;
    return Math.min(100, (prog.loaded / prog.total) * 100);
  }, [prog]);

  const mb = (b: number) => nf1.format(b / (1024 * 1024));

  const statusLine = useMemo(() => {
    switch (phase) {
      case "detect":
        return "Zjišťuji parametry systému…";
      case "idle":
        return model ? `Připraveno stáhnout ${model.label} (${model.sizeMB ? model.sizeMB + " MB" : "velikost neznámá"})` : "";
      case "loading":
        return pct !== null ? `Stahuji a načítám model · ${pct.toFixed(0)} %` : "Stahuji model…";
      case "ready":
        return busy ? (waitingFirst ? "Model přemýšlí…" : "Generuji odpověď…") : "Model běží lokálně · llama.cpp (C++) → WASM";
      case "error":
        return "Chyba — detail níže";
    }
  }, [phase, model, pct, busy, waitingFirst]);

  return (
    <section className="fade-up absolute bottom-3 left-3 z-30 flex h-[min(640px,calc(100dvh-90px))] w-[min(94vw,375px)] flex-col overflow-hidden rounded-md border border-coal-700 bg-coal-900/95 shadow-[0_24px_70px_rgba(0,0,0,0.6)] backdrop-blur-md md:bottom-5 md:left-5">
      {/* hlavička */}
      <div className="flex items-center justify-between border-b border-coal-700 px-4 py-3">
        <div>
          <div className="font-display text-[13px] font-bold tracking-wide text-sand-100">CODER CHAT</div>
          <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[9px] tracking-[0.16em] text-sand-500 uppercase">
            <span className={`inline-block h-[6px] w-[6px] rounded-full ${phase === "ready" ? "pulse-lamp bg-lamp-400" : phase === "loading" ? "bg-mine-300" : "bg-coal-500"}`} />
            GGUF · lokální inference
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm border border-coal-600 p-1.5 text-sand-400 transition-colors hover:border-coal-500 hover:text-sand-100"
          aria-label="Zavřít chat"
        >
          <IconClose />
        </button>
      </div>

      {/* systém + model */}
      <div className="space-y-2.5 border-b border-coal-700 px-4 py-3">
        {sys && (
          <div className="grid grid-cols-4 gap-1.5">
            <SysChip label="CPU" value={`${sys.cores}×`} />
            <SysChip label="RAM" value={sys.ramGb !== null ? `~${sys.ramGb} GB` : "n/a"} />
            <SysChip label="GPU" value={sys.gpu ?? "bez WebGPU"} />
            <SysChip label="Vlákna" value={sys.threads ? "MT" : "1T"} />
          </div>
        )}

        <div className="space-y-1">
          {MODELS.map((m) => {
            const active = model?.id === m.id;
            const rec = m.id === recommendedId;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => pickModel(m)}
                disabled={busy || phase === "loading"}
                className={`flex w-full items-center justify-between gap-2 rounded-sm border px-2.5 py-1.5 text-left transition-all disabled:opacity-50 ${
                  active
                    ? "border-lamp-500/70 bg-lamp-500/10 shadow-[inset_0_0_12px_rgba(242,163,60,0.06)]"
                    : "border-coal-700 bg-coal-950/40 hover:border-coal-500"
                }`}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className={`truncate text-[12px] font-semibold ${active ? "text-lamp-300" : "text-sand-200"}`}>{m.label}</span>
                    {m.tag && (
                      <span className="rounded-sm border border-mine-400/50 px-1 font-mono text-[8px] tracking-[0.12em] text-mine-300">{m.tag}</span>
                    )}
                  </span>
                  <span className="block truncate font-mono text-[9px] text-sand-500">{m.sub}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="font-mono text-[10px] tabular-nums text-sand-400">{m.sizeMB ? `${m.sizeMB} MB` : "—"}</span>
                  {rec && <span className="font-mono text-[8px] tracking-[0.1em] text-lamp-400 uppercase">optimální</span>}
                </span>
              </button>
            );
          })}

          <div className="flex gap-1.5">
            <input
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="https://…/model.gguf"
              className="min-w-0 flex-1 rounded-sm border border-coal-700 bg-coal-950 px-2 py-1.5 font-mono text-[10.5px] text-sand-200 outline-none placeholder:text-sand-500/60 focus:border-lamp-500/70"
            />
            <button
              type="button"
              onClick={() => {
                if (!/^https?:\/\/.+/.test(customUrl.trim())) return;
                pickModel(customModel(customUrl.trim()));
              }}
              className="shrink-0 rounded-sm border border-coal-600 px-2.5 font-mono text-[9.5px] tracking-[0.1em] text-sand-400 uppercase transition-colors hover:border-lamp-500/60 hover:text-lamp-300"
            >
              URL
            </button>
          </div>
        </div>

        {phase !== "ready" && phase !== "loading" && (
          <button
            type="button"
            onClick={activate}
            disabled={!model || phase === "detect"}
            className="w-full rounded-sm border border-lamp-500/70 bg-lamp-500/15 px-3 py-2.5 text-[11px] font-bold tracking-[0.16em] text-lamp-300 uppercase transition-all hover:bg-lamp-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {model ? `Stáhnout a spustit ${model.label}` : "…"}
          </button>
        )}

        {phase === "loading" && (
          <div className="space-y-1.5">
            <div className="h-[5px] overflow-hidden rounded-sm bg-coal-800">
              {pct !== null ? (
                <div className="h-full rounded-sm bg-gradient-to-r from-lamp-600 to-lamp-400 transition-[width] duration-200" style={{ width: `${pct}%` }} />
              ) : (
                <div className="indeterminate-bar h-full w-1/3 rounded-sm bg-lamp-500" />
              )}
            </div>
            <div className="flex justify-between font-mono text-[9.5px] text-sand-500">
              <span>{prog && prog.total ? `${mb(prog.loaded)} / ${mb(prog.total)} MB` : "připojování…"}</span>
              <span>{loadSec.toFixed(0)} s · poté se model cachuje (OPFS)</span>
            </div>
          </div>
        )}

        {phase === "error" && error && (
          <div className="rounded-sm border border-red-900/70 bg-red-950/30 px-2.5 py-2">
            <p className="font-mono text-[10px] leading-relaxed break-words text-red-300">{error}</p>
            <button
              type="button"
              onClick={activate}
              className="mt-1.5 font-mono text-[9.5px] tracking-[0.12em] text-lamp-300 uppercase hover:underline"
            >
              Zkusit znovu
            </button>
          </div>
        )}
      </div>

      {/* vlákno konverzace */}
      <div ref={threadRef} className="panel-scroll flex-1 space-y-2.5 overflow-y-auto px-3.5 py-3">
        {thread.length === 0 && !genText && !waitingFirst && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="font-display text-[44px] leading-none font-black text-coal-600 select-none">{"{ }"}</div>
            <p className="max-w-[240px] text-[11.5px] leading-relaxed text-sand-500">
              Model běží celý ve tvém prohlížeči — žádné API, žádný server. Vyber model výše a spusť ho.
            </p>
            <div className="flex w-full flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => phase === "ready" && send(s)}
                  disabled={phase !== "ready"}
                  className="rounded-sm border border-coal-700 bg-coal-950/50 px-2.5 py-2 text-left font-mono text-[10px] leading-relaxed text-sand-400 transition-colors hover:border-lamp-500/50 hover:text-lamp-300 disabled:opacity-40"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {thread.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-md rounded-br-sm border border-lamp-600/40 bg-lamp-500/12 px-3 py-2 text-[12.5px] leading-relaxed text-sand-100">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[92%] rounded-md rounded-bl-sm border border-coal-700 bg-coal-800/80 px-3 py-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap text-sand-200">
                {m.content}
              </div>
            </div>
          )
        )}

        {waitingFirst && (
          <div className="flex justify-start">
            <div className="rounded-md rounded-bl-sm border border-coal-700 bg-coal-800/80 px-3 py-1.5">
              <Dots />
            </div>
          </div>
        )}

        {genText !== null && (
          <div className="flex justify-start">
            <div className="max-w-[92%] rounded-md rounded-bl-sm border border-lamp-600/40 bg-coal-800/80 px-3 py-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap text-sand-200">
              {genText}
              <span className="pulse-lamp ml-0.5 inline-block text-lamp-400">▍</span>
            </div>
          </div>
        )}
      </div>

      {/* vstup */}
      <div className="border-t border-coal-700 px-3 py-2.5">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            placeholder={phase === "ready" ? "Zeptej se na C++, GGUF, grafiku…" : "Nejdřív spusť model výše"}
            disabled={phase !== "ready" || busy}
            className="min-w-0 flex-1 resize-none rounded-sm border border-coal-700 bg-coal-950 px-2.5 py-2 text-[12.5px] leading-snug text-sand-100 outline-none placeholder:text-sand-500/60 focus:border-lamp-500/70 disabled:opacity-50"
          />
          {busy ? (
            <button
              type="button"
              onClick={() => engine.abort()}
              className="shrink-0 rounded-sm border border-red-800/70 bg-red-950/40 p-2.5 text-red-300 transition-colors hover:bg-red-900/40"
              aria-label="Zastavit generování"
              title="Zastavit"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send(input)}
              disabled={phase !== "ready" || !input.trim()}
              className="shrink-0 rounded-sm border border-lamp-500/70 bg-lamp-500/15 p-2.5 text-lamp-300 transition-all hover:bg-lamp-500/30 disabled:cursor-not-allowed disabled:opacity-35"
              aria-label="Odeslat zprávu"
              title="Odeslat (Enter)"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h13" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2 font-mono text-[9px] tracking-wide text-sand-500">
          <span className="truncate">{statusLine}</span>
          <span className="shrink-0 tabular-nums">
            {stats ? `${nf1.format(stats.tps)} tok/s · ${stats.tokens} tok` : phase === "ready" ? "ctx 2048 · Q-KV" : ""}
          </span>
        </div>
      </div>
    </section>
  );
}
