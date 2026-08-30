import { useEffect, useRef, useState } from "react";
import {
  ensureCompiler,
  compileProgram,
  runProgram,
  type CompiledProgram,
  type SourceLang,
} from "../wasm/wasmerCompiler";
import { Segmented, Slider, ActionButton } from "./controls";

type CompilerStatus = "idle" | "downloading" | "ready" | "error";
type RunPhase = "idle" | "compiling" | "running" | "done" | "error";

const nf = new Intl.NumberFormat("cs-CZ");

export default function CompilerPanel() {
  const [status, setStatus] = useState<CompilerStatus>("idle");
  const [stage, setStage] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [source, setSource] = useState<"web" | "cpp">("web");
  const [phase, setPhase] = useState(2.4);
  const [runPhase, setRunPhase] = useState<RunPhase>("idle");
  const [log, setLog] = useState("");
  const [stats, setStats] = useState<{ compileMs: number; runMs: number; wasmBytes: number; w: number; h: number } | null>(null);
  const [hasImage, setHasImage] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const sourceCache = useRef<Record<string, string>>({});
  const programCache = useRef<Partial<Record<"web" | "cpp", CompiledProgram>>>({});

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const appendLog = (s: string) => setLog((prev) => (prev ? prev + "\n" : "") + s);

  async function handleActivate() {
    setStatus("downloading");
    setErrMsg("");
    setStage("Připravuji…");
    try {
      await ensureCompiler(setStage);
      setStatus("ready");
      setStage("");
    } catch (e) {
      setStatus("error");
      setErrMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function fetchSourceText(key: "web" | "cpp"): Promise<string> {
    const file = key === "web" ? "tabule_web.c" : "tabule.cpp";
    if (sourceCache.current[file]) return sourceCache.current[file];
    const res = await fetch(`${import.meta.env.BASE_URL}${file}`);
    if (!res.ok) throw new Error(`Nelze načíst ${file} (HTTP ${res.status}).`);
    const text = await res.text();
    sourceCache.current[file] = text;
    return text;
  }

  async function handleRun() {
    setRunPhase("compiling");
    setLog("");
    setStats(null);
    try {
      const lang: SourceLang = source === "web" ? "c" : "cpp";
      const file = source === "web" ? "tabule_web.c" : "tabule.cpp";
      let compiled = programCache.current[source];
      if (!compiled || !compiled.program) {
        const src = await fetchSourceText(source);
        appendLog(`$ clang ${lang === "cpp" ? "-x c++ -std=c++17" : "-std=c99"} -O2 ${file} -o out.wasm`);
        compiled = await compileProgram(src, file, lang, (m) => setStage(m));
        programCache.current[source] = compiled;
        if (!compiled.program) {
          appendLog(compiled.log || "clang selhal bez diagnostického výstupu.");
          appendLog(
            lang === "cpp"
              ? "⚠ C++17 varianta potřebuje libc++; balík clang/clang ji nemusí obsahovat — použij zdroj tabule_web.c (C99)."
              : "⚠ Kompilace selhala — viz výstup clangu výše."
          );
          setRunPhase("error");
          setStage("");
          return;
        }
        appendLog(`✓ zkompilováno za ${compiled.compileMs.toFixed(0)} ms · WASM ${nf.format(Math.round(compiled.wasmBytes / 1024))} kB`);
        if (compiled.log) appendLog(compiled.log);
      } else {
        appendLog(`$ (používám uložený WASM modul · ${nf.format(Math.round(compiled.wasmBytes / 1024))} kB)`);
      }

      setRunPhase("running");
      const out = await runProgram(compiled.program, phase, setStage);
      appendLog(out.log || "(program nedal žádný textový výstup)");
      if (out.ok && out.ppm) {
        drawPPM(out.ppm.w, out.ppm.h, out.ppm.rgb);
        setStats({ compileMs: compiled.compileMs, runMs: out.runMs, wasmBytes: compiled.wasmBytes, w: out.ppm.w, h: out.ppm.h });
        setHasImage(true);
        appendLog(`✓ snímek ${out.ppm.w}×${out.ppm.h} vykreslen za ${out.runMs.toFixed(0)} ms (fáze ${phase.toFixed(2)})`);
        setRunPhase("done");
      } else {
        appendLog(out.ok ? "⚠ program doběhl, ale ve stdout nebyl nalezen PPM blok." : `⚠ program skončil chybou (kód výstupu).`);
        setRunPhase("error");
      }
    } catch (e) {
      appendLog(`✗ ${e instanceof Error ? e.message : String(e)}`);
      setRunPhase("error");
    } finally {
      setStage("");
    }
  }

  function drawPPM(w: number, h: number, rgb: Uint8Array) {
    const c = canvasRef.current;
    if (!c) return;
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(w, h);
    for (let i = 0, o = 0; i < rgb.length; i += 3, o += 4) {
      img.data[o] = rgb[i];
      img.data[o + 1] = rgb[i + 1];
      img.data[o + 2] = rgb[i + 2];
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  const busy = runPhase === "compiling" || runPhase === "running";
  const compiledHere = !!programCache.current[source]?.program;

  return (
    <div className="flex flex-col gap-3">
      {/* stav kompilátoru */}
      <div className="flex items-center gap-2 rounded-sm border border-coal-700 bg-coal-950/70 px-2.5 py-2">
        {status === "downloading" ? (
          <svg className="spin-slow h-3 w-3 shrink-0 text-lamp-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M12 3a9 9 0 1 0 9 9" />
          </svg>
        ) : (
          <span
            className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full ${
              status === "ready" ? "pulse-lamp bg-lamp-400 shadow-[0_0_8px_rgba(242,163,60,0.8)]" : status === "error" ? "bg-red-400" : "bg-coal-500"
            }`}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10.5px] text-sand-200">
            {status === "idle" && "Clang (WASM) · neaktivní"}
            {status === "downloading" && "Stahuji kompilátor…"}
            {status === "ready" && "Clang (WASM) · připraven"}
            {status === "error" && "Clang (WASM) · chyba"}
          </div>
          {status === "downloading" && <div className="truncate font-mono text-[9.5px] text-sand-500">{stage}</div>}
          {status === "error" && <div className="truncate font-mono text-[9.5px] text-red-300">{errMsg}</div>}
        </div>
      </div>

      {status === "idle" && (
        <>
          <ActionButton primary onClick={handleActivate}>
            <span className="flex items-center justify-center gap-2">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v12" />
                <path d="m7 10 5 5 5-5" />
                <path d="M5 21h14" />
              </svg>
              Aktivovat zabudovaný kompilátor
            </span>
          </ActionButton>
          <p className="font-mono text-[9.5px] leading-relaxed text-sand-500">
            Clang poběží celý v prohlížeči (WASM, Wasmer registry). Jednorázový stah ≈ 30 MB — pak se kompiluje
            i spouští offline vůči serveru.
          </p>
        </>
      )}

      {status === "downloading" && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-coal-800">
          <div className="indeterminate-bar h-full w-1/3 rounded-full bg-lamp-500" />
        </div>
      )}

      {status === "error" && (
        <ActionButton onClick={handleActivate}>Zkusit znovu</ActionButton>
      )}

      {status === "ready" && (
        <>
          <Segmented
            value={source}
            options={[
              { value: "web", label: "tabule_web.c" },
              { value: "cpp", label: "tabule.cpp" },
            ]}
            onChange={(v) => setSource(v)}
          />
          <div className="-mt-1 font-mono text-[9.5px] text-sand-500">
            {source === "web" ? "C99 dvojče raytraceru · garantovaný běh" : "C++17 originál · clang zkouší libc++ (může selhat link)"}
          </div>

          <Slider label="Fáze vlnění povrchu" value={phase} min={0} max={6.28} step={0.02} unit="rad" onChange={(v) => setPhase(v)} />

          <ActionButton primary onClick={handleRun}>
            {busy ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="spin-slow h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M12 3a9 9 0 1 0 9 9" />
                </svg>
                {runPhase === "compiling" ? "Kompiluji…" : "Renderuji ve WASM…"}
              </span>
            ) : compiledHere ? (
              "Spustit znovu (WASM uložen)"
            ) : (
              "Zkompilovat a spustit"
            )}
          </ActionButton>
          {busy && stage && <div className="-mt-1 font-mono text-[9.5px] text-lamp-300/80">{stage}</div>}

          {/* konzole */}
          <pre
            ref={logRef}
            className={`max-h-28 overflow-y-auto whitespace-pre-wrap rounded-sm border px-2.5 py-2 font-mono text-[9.5px] leading-relaxed ${
              runPhase === "error" ? "border-red-500/40 bg-red-950/20 text-red-200" : "border-coal-700 bg-coal-950/80 text-sand-200"
            }`}
          >
            {log || "$ výstup kompilátoru a programu se zobrazí zde…"}
          </pre>

          {/* náhled */}
          <div className="relative overflow-hidden rounded-sm border border-coal-700 bg-coal-950" style={{ aspectRatio: "8 / 5" }}>
            <canvas ref={canvasRef} className={`absolute inset-0 h-full w-full transition-opacity duration-500 ${hasImage ? "opacity-100" : "opacity-0"}`} />
            {!hasImage && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 font-mono text-[9.5px] text-sand-500">
                <svg viewBox="0 0 24 24" className="h-4 w-4 text-coal-500" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="14" rx="1" />
                  <path d="m3 15 4-4 5 5 3-3 6 6" />
                </svg>
                náhled vyrenderovaného snímku
              </div>
            )}
          </div>

          {stats && (
            <div className="grid grid-cols-4 gap-1">
              <StatBox label="kompilace" value={`${(stats.compileMs / 1000).toFixed(1)} s`} />
              <StatBox label="běh" value={`${(stats.runMs / 1000).toFixed(1)} s`} />
              <StatBox label="wasm" value={`${nf.format(Math.round(stats.wasmBytes / 1024))} kB`} />
              <StatBox label="snímek" value={`${stats.w}×${stats.h}`} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-coal-700/80 bg-coal-950/70 px-1.5 py-1 text-center">
      <div className="font-mono text-[8px] tracking-[0.14em] text-sand-500 uppercase">{label}</div>
      <div className="font-mono text-[10.5px] tabular-nums text-lamp-300">{value}</div>
    </div>
  );
}
