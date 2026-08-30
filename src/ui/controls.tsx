import { useCallback, type CSSProperties, type ReactNode } from "react";

/* ── zvuková zpětná vazba ─────────────────────────────── */
let audioCtx: AudioContext | null = null;
export function playTick(freq = 540, gain = 0.035) {
  try {
    audioCtx = audioCtx ?? new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.72, t + 0.07);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  } catch {
    /* ticho je také odpověď */
  }
}

const fmt = (v: number, digits: number) =>
  v.toLocaleString("cs-CZ", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/* ── sekce ────────────────────────────────────────────── */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-coal-700/70 px-4 py-3.5 last:border-b-0">
      <h3 className="mb-3 flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.22em] text-lamp-400 uppercase">
        <span className="inline-block h-[5px] w-[5px] rotate-45 bg-lamp-500" />
        {title}
      </h3>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

/* ── posuvník ─────────────────────────────────────────── */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  digits = 2,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  digits?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[12.5px] text-sand-200">{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-lamp-300">
          {fmt(value, digits)}
          {unit ? <span className="ml-0.5 text-sand-500">{unit}</span> : null}
        </span>
      </div>
      <input
        type="range"
        className="slider"
        style={{ "--fill": `${fill}%` } as CSSProperties}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}

/* ── přepínač ─────────────────────────────────────────── */
export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const flip = useCallback(() => {
    playTick(checked ? 420 : 620);
    onChange(!checked);
  }, [checked, onChange]);
  return (
    <button
      type="button"
      onClick={flip}
      className="group flex w-full items-center justify-between rounded-sm py-0.5 text-left"
    >
      <span className="text-[12.5px] text-sand-200 group-hover:text-sand-100">{label}</span>
      <span
        className={`relative inline-flex h-[18px] w-[34px] items-center rounded-full border transition-colors duration-200 ${
          checked ? "border-lamp-500 bg-lamp-500/25" : "border-coal-600 bg-coal-800"
        }`}
      >
        <span
          className={`absolute h-[12px] w-[12px] rounded-full transition-all duration-200 ${
            checked ? "left-[18px] bg-lamp-400 shadow-[0_0_8px_rgba(242,163,60,0.6)]" : "left-[3px] bg-coal-400"
          }`}
        />
      </span>
    </button>
  );
}

/* ── segmentovaný výběr ───────────────────────────────── */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-sm border border-coal-700 bg-coal-900 p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => {
              playTick(active ? 500 : 660);
              onChange(o.value);
            }}
            className={`rounded-[3px] px-1 py-1.5 text-[11.5px] font-medium transition-all duration-150 ${
              active
                ? "bg-lamp-500/20 text-lamp-300 shadow-[inset_0_0_0_1px_rgba(242,163,60,0.45)]"
                : "text-sand-400 hover:bg-coal-800 hover:text-sand-200"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── akční tlačítko ────────────────────────────────────── */
export function ActionButton({
  children,
  onClick,
  primary,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        playTick(480);
        onClick();
      }}
      className={`flex-1 rounded-sm border px-3 py-2 text-[12px] font-medium transition-all duration-150 active:translate-y-px ${
        primary
          ? "border-lamp-500/60 bg-lamp-500/15 text-lamp-300 hover:bg-lamp-500/25"
          : "border-coal-600 bg-coal-800 text-sand-200 hover:border-coal-500 hover:bg-coal-700"
      }`}
    >
      {children}
    </button>
  );
}

/* ── ikony (inline SVG) ────────────────────────────────── */
export function IconSliders({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
      <circle cx="16" cy="8" r="2.2" />
      <circle cx="10" cy="16" r="2.2" />
    </svg>
  );
}

export function IconClose({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function IconReset({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v4h4" />
    </svg>
  );
}

export function IconOrbit({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="3.2" />
      <ellipse cx="12" cy="12" rx="9.5" ry="4.2" transform="rotate(-24 12 12)" />
    </svg>
  );
}
