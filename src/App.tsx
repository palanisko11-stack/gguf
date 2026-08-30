import { useEffect, useRef, useState } from "react";
import {
  createBoardScene,
  DEFAULT_PARAMS,
  type BoardParams,
  type SceneAPI,
  type Telemetry,
  type TextureState,
} from "./three/boardScene";
import {
  Section,
  Slider,
  Toggle,
  Segmented,
  ActionButton,
  IconSliders,
  IconClose,
  IconReset,
} from "./ui/controls";
import CompilerPanel from "./ui/CompilerPanel";

const nf = new Intl.NumberFormat("cs-CZ");

function Chip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-[74px] rounded-sm border border-coal-700/80 bg-coal-900/80 px-2.5 py-1.5">
      <div className="font-mono text-[9px] tracking-[0.18em] text-sand-500 uppercase">{label}</div>
      <div className={`font-mono text-[12.5px] tabular-nums ${accent ? "text-lamp-300" : "text-sand-200"}`}>{value}</div>
    </div>
  );
}

function CmdBlock({ label, cmd }: { label: string; cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-sm border border-coal-700/80 bg-coal-900/80 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[9px] tracking-[0.18em] text-sand-500 uppercase">{label}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(cmd)
              .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1400);
              })
              .catch(() => {});
          }}
          className="rounded-sm border border-coal-600 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.14em] text-sand-500 uppercase transition-colors hover:border-lamp-500/60 hover:text-lamp-300"
        >
          {copied ? "✓ hotovo" : "kopírovat"}
        </button>
      </div>
      <code className="mt-1 block font-mono text-[11px] leading-relaxed break-all text-sand-200">
        <span className="text-lamp-400">$</span> {cmd}
      </code>
    </div>
  );
}

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<SceneAPI | null>(null);
  const [params, setParams] = useState<BoardParams>(DEFAULT_PARAMS);
  const [tele, setTele] = useState<Telemetry | null>(null);
  const [tex, setTex] = useState<TextureState>({ status: "loading", source: "github", width: 0, height: 0 });
  const [panelOpen, setPanelOpen] = useState<boolean>(
    () => typeof window === "undefined" || window.matchMedia("(min-width: 1024px)").matches
  );

  useEffect(() => {
    if (!mountRef.current) return;
    const api = createBoardScene(mountRef.current, {
      onTelemetry: setTele,
      onTexture: setTex,
    });
    apiRef.current = api;
    return () => {
      apiRef.current = null;
      api.dispose();
    };
  }, []);

  useEffect(() => {
    apiRef.current?.setParams(params);
  }, [params]);

  const patch = (p: Partial<BoardParams>) => setParams((prev) => ({ ...prev, ...p }));

  return (
    <div className="relative h-full w-full overflow-hidden bg-coal-950 font-body text-sand-200">
      {/* 3D viewport */}
      <div ref={mountRef} className="absolute inset-0" />

      {/* vinětace */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse 120% 90% at 50% 42%, transparent 52%, rgba(6,4,3,0.62) 100%)" }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-coal-950/80 to-transparent" />

      {/* ── hlavička ── */}
      <header className="fade-up pointer-events-none absolute top-5 left-5 max-w-[420px] select-none md:top-7 md:left-7">
        <div className="mb-2 flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.3em] text-lamp-400 uppercase">
          <span className="inline-block h-px w-8 bg-lamp-500" />
          Povrchová studie · Three.js
        </div>
        <h1 className="font-display text-[34px] leading-none font-black tracking-tight text-sand-100 md:text-[52px]">
          HAVÍŘOV
        </h1>
        <p className="mt-3 max-w-[330px] text-[13px] leading-relaxed text-sand-400">
          Reliéfní panel, jehož povrch tvoří textura{" "}
          <span className="font-mono text-[12px] text-lamp-300">havirov.webp</span> stažená z repozitáře
          3D&#8209;assety. Geometrie meshy reaguje vlněním, materiál na světlo.
        </p>

        {/* stav textury */}
        <div className="pointer-events-auto mt-4">
          {tex.status === "loading" && (
            <div className="inline-flex items-center gap-2.5 rounded-sm border border-lamp-600/50 bg-coal-900/85 px-3 py-1.5">
              <svg className="spin-slow h-3.5 w-3.5 text-lamp-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M12 3a9 9 0 1 0 9 9" />
              </svg>
              <span className="font-mono text-[11px] text-lamp-300">Stahuji texturu · 2,46 MB…</span>
            </div>
          )}
          {tex.status === "ready" && (
            <div className="inline-flex items-center gap-2.5 rounded-sm border border-coal-600 bg-coal-900/85 px-3 py-1.5">
              <span className="pulse-lamp inline-block h-[7px] w-[7px] rounded-full bg-lamp-400 shadow-[0_0_8px_rgba(242,163,60,0.8)]" />
              <span className="font-mono text-[11px] text-sand-200">
                havirov.webp · {nf.format(tex.width)}×{nf.format(tex.height)} px · načteno
              </span>
            </div>
          )}
          {tex.status === "fallback" && (
            <div className="inline-flex items-center gap-2.5 rounded-sm border border-mine-400/50 bg-coal-900/85 px-3 py-1.5">
              <span className="inline-block h-[7px] w-[7px] rounded-full bg-mine-300" />
              <span className="font-mono text-[11px] text-mine-300">Offline · procedurální textura</span>
            </div>
          )}
        </div>
      </header>

      {/* ── telemetrie ── */}
      <footer className="fade-up fade-up-2 absolute bottom-4 left-4 right-4 flex flex-wrap items-end gap-1.5 md:bottom-6 md:left-7 md:right-auto md:max-w-[62%]">
        <Chip label="FPS" value={tele ? tele.fps.toFixed(0).padStart(2, "0") : "—"} accent />
        <Chip label="Snímek" value={tele ? `${tele.ms.toFixed(1)} ms` : "—"} />
        <Chip label="Draw calls" value={tele ? nf.format(tele.calls) : "—"} />
        <Chip label="Trojúhelníky" value={tele ? nf.format(tele.triangles) : "—"} />
        <Chip label="Vertexy" value={tele ? nf.format(tele.vertices) : "—"} />
        <Chip label="Kamera" value={tele ? `${tele.camDist.toFixed(1)} m` : "—"} />
        <Chip label="Azimut" value={tele ? `${tele.azimuth.toFixed(0)}°` : "—"} />
        <div className="ml-1 hidden pb-1 font-mono text-[10px] tracking-wide text-sand-500 lg:block">
          tažení = otáčení · kolečko = zoom · pravé tlačítko = posun
        </div>
      </footer>

      {/* ── ovládací panel ── */}
      {panelOpen ? (
        <aside className="fade-up fade-up-1 absolute top-3 right-3 bottom-3 z-20 flex w-[290px] flex-col overflow-hidden rounded-md border border-coal-700 bg-coal-900/92 shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-md md:top-5 md:right-5 md:bottom-5">
          <div className="flex items-center justify-between border-b border-coal-700 px-4 py-3">
            <div>
              <div className="font-display text-[13px] font-bold tracking-wide text-sand-100">ŘÍDICÍ PULT</div>
              <div className="font-mono text-[9.5px] tracking-[0.2em] text-sand-500 uppercase">Panel · povrch · světlo</div>
            </div>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              className="rounded-sm border border-coal-600 p-1.5 text-sand-400 transition-colors hover:border-coal-500 hover:text-sand-100"
              aria-label="Skrýt panel"
            >
              <IconClose />
            </button>
          </div>

          <div className="panel-scroll flex-1 overflow-y-auto">
            <Section title="Povrch meshy">
              <Slider label="Výška vlnění" value={params.amplitude} min={0} max={0.45} step={0.005} unit="m" onChange={(v) => patch({ amplitude: v })} />
              <Slider label="Prostorová frekvence" value={params.frequency} min={0.4} max={3.5} step={0.05} onChange={(v) => patch({ frequency: v })} />
              <Slider label="Rychlost animace" value={params.speed} min={0} max={3} step={0.05} unit="×" onChange={(v) => patch({ speed: v })} />
              <Slider label="Reliéf z textury" value={params.bumpScale} min={0} max={0.15} step={0.005} onChange={(v) => patch({ bumpScale: v })} />
            </Section>

            <Section title="Materiál">
              <Slider label="Drsnost" value={params.roughness} min={0} max={1} step={0.01} onChange={(v) => patch({ roughness: v })} />
              <Slider label="Kovovost" value={params.metalness} min={0} max={1} step={0.01} onChange={(v) => patch({ metalness: v })} />
              <Slider label="Čirý lak" value={params.clearcoat} min={0} max={1} step={0.01} onChange={(v) => patch({ clearcoat: v })} />
              <Slider label="Měřítko textury" value={params.texRepeat} min={0.4} max={2} step={0.05} unit="×" onChange={(v) => patch({ texRepeat: v })} />
            </Section>

            <Section title="Rám a stojan">
              <Segmented
                value={params.frame}
                options={[
                  { value: "uhel", label: "Uhel" },
                  { value: "ocel", label: "Ocel" },
                  { value: "mosaz", label: "Mosaz" },
                ]}
                onChange={(v) => patch({ frame: v })}
              />
            </Section>

            <Section title="Osvětlení">
              <Slider label="Klíčové světlo" value={params.keyLight} min={0} max={6} step={0.1} onChange={(v) => patch({ keyLight: v })} />
              <Slider label="Obrysové světlo" value={params.rimLight} min={0} max={6} step={0.1} onChange={(v) => patch({ rimLight: v })} />
              <Slider label="Expozice" value={params.exposure} min={0.4} max={2} step={0.02} onChange={(v) => patch({ exposure: v })} />
              <Toggle label="Stěhovací reflektor" checked={params.scanLight} onChange={(v) => patch({ scanLight: v })} />
              {params.scanLight && (
                <Slider label="Rychlost reflektoru" value={params.scanSpeed} min={0.1} max={2.5} step={0.05} onChange={(v) => patch({ scanSpeed: v })} />
              )}
            </Section>

            <Section title="Pohled">
              <Toggle label="Automatická rotace kamery" checked={params.autoRotate} onChange={(v) => patch({ autoRotate: v })} />
              <Toggle label="Pozastavit animaci" checked={params.paused} onChange={(v) => patch({ paused: v })} />
            </Section>

            <Section title="Zabudovaný kompilátor">
              <div className="-mt-1 mb-1 inline-flex w-fit items-center gap-1.5 rounded-sm border border-mine-400/40 bg-mine-400/10 px-2 py-0.5">
                <span className="inline-block h-[5px] w-[5px] rounded-full bg-mine-300" />
                <span className="font-mono text-[9px] tracking-[0.18em] text-mine-300 uppercase">Clang → WASM · běží v prohlížeči</span>
              </div>
              <CompilerPanel />
            </Section>

            <Section title="Natívní build (C++)">
              <p className="text-[11px] leading-relaxed text-sand-400">
                <span className="text-sand-200">tabule.cpp</span> je plnohodnotný C++17 raytracer bez jediné
                knihovny — vlní touž funkcí povrchu. Texturu načte z{" "}
                <span className="font-mono text-[10.5px] text-lamp-300">havirov.ppm</span> vedle programu,
                jinak si vygeneruje procedurální uhlí.
              </p>
              <div className="flex flex-col gap-1.5">
                <CmdBlock label="překlad" cmd="g++ -O2 -std=c++17 tabule.cpp -o tabule" />
                <CmdBlock label="spuštění · 1 snímek" cmd="./tabule" />
                <CmdBlock label="animace · 90 fází" cmd="./tabule 90" />
                <CmdBlock label="textura z webp" cmd="ffmpeg -i havirov.webp havirov.ppm" />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <a
                  href={`${import.meta.env.BASE_URL}tabule.cpp`}
                  download="tabule.cpp"
                  className="flex items-center justify-center gap-2 rounded-sm border border-lamp-500/60 bg-lamp-500/10 px-2 py-2 text-[10px] font-semibold tracking-[0.1em] text-lamp-300 uppercase transition-colors hover:bg-lamp-500/20"
                >
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v12" />
                    <path d="m7 10 5 5 5-5" />
                    <path d="M5 21h14" />
                  </svg>
                  tabule.cpp
                </a>
                <a
                  href={`${import.meta.env.BASE_URL}tabule_web.c`}
                  download="tabule_web.c"
                  className="flex items-center justify-center gap-2 rounded-sm border border-coal-600 px-2 py-2 text-[10px] font-semibold tracking-[0.1em] text-sand-400 uppercase transition-colors hover:border-coal-500 hover:text-sand-200"
                >
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v12" />
                    <path d="m7 10 5 5 5-5" />
                    <path d="M5 21h14" />
                  </svg>
                  tabule_web.c
                </a>
              </div>
              <p className="mt-2 font-mono text-[9.5px] leading-relaxed text-sand-500">
                výstup: tabule.ppm (P6) · tabule_web.c je C99 dvojče pro vestavěný kompilátor
              </p>
            </Section>
          </div>

          <div className="flex gap-2 border-t border-coal-700 px-4 py-3">
            <ActionButton
              primary
              onClick={() => {
                setParams(DEFAULT_PARAMS);
              }}
            >
              Obnovit parametry
            </ActionButton>
            <ActionButton onClick={() => apiRef.current?.resetCamera()}>
              <span className="flex items-center justify-center gap-1.5">
                <IconReset className="h-3.5 w-3.5" />
                Kamera
              </span>
            </ActionButton>
          </div>
        </aside>
      ) : (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className="fade-up absolute right-4 bottom-16 z-20 flex items-center gap-2 rounded-sm border border-lamp-500/60 bg-coal-900/92 px-4 py-2.5 text-[12.5px] font-medium text-lamp-300 shadow-lg backdrop-blur-md transition-all hover:bg-lamp-500/20 md:right-6 md:bottom-20"
        >
          <IconSliders />
          Ovládání
        </button>
      )}
    </div>
  );
}
