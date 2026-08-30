/* Zabudovaný kompilátor: Clang běžící v prohlížeči přes Wasmer JS SDK.
 * Zdroj se zkompiluje do WASM a výsledek se hned spustí — PPM snímek
 * se zachytí ze stdout (mezi značkami PPMBEGIN / PPMEND). */

export type SourceLang = "c" | "cpp";

export interface CompiledProgram {
  program: unknown;
  wasmBytes: number;
  compileMs: number;
  log: string;
}

export interface RunOutput {
  ok: boolean;
  log: string;
  runMs: number;
  ppm: { w: number; h: number; rgb: Uint8Array } | null;
}

interface Sdk {
  init: () => Promise<void>;
  Wasmer: {
    fromRegistry: (name: string) => Promise<{ entrypoint: { run: (opts: unknown) => Promise<{ wait: () => Promise<ProcOut> }> } }>;
    fromFile: (bytes: Uint8Array) => Promise<{ entrypoint: { run: (opts: unknown) => Promise<{ wait: () => Promise<ProcOut> }> } }>;
  };
  Directory: new () => { writeFile: (path: string, data: string) => Promise<void>; readFile: (path: string) => Promise<Uint8Array> };
}

interface ProcOut {
  ok: boolean;
  code: number;
  stdout: Uint8Array | string;
  stderr: Uint8Array | string;
}

const SDK_URL = "https://cdn.jsdelivr.net/npm/@wasmer/sdk@0.8.0/dist/index.mjs";

let sdkPromise: Promise<Sdk> | null = null;
let clangPkg: { entrypoint: { run: (opts: unknown) => Promise<{ wait: () => Promise<ProcOut> }> } } | null = null;

function asText(v: Uint8Array | string | undefined): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(v);
  } catch {
    return "";
  }
}

/** Stáhne a inicializuje Wasmer SDK + balík clang/clang (~30 MB). */
export async function ensureCompiler(onStage: (msg: string) => void): Promise<void> {
  if (clangPkg) return;
  if (!sdkPromise) {
    sdkPromise = (async () => {
      onStage("Stahuji Wasmer SDK…");
      // @ts-ignore – dynamický import z CDN, typy neexistují
      const sdk = (await import(/* @vite-ignore */ SDK_URL)) as Sdk;
      await sdk.init();
      return sdk;
    })();
  }
  const sdk = await sdkPromise;
  onStage("Stahuji balík clang/clang z Wasmer registry (~30 MB)…");
  const started = performance.now();
  const timer = window.setInterval(() => {
    const s = ((performance.now() - started) / 1000) | 0;
    onStage(`Stahuji clang/clang… ${s} s (komprimováno ~30 MB)`);
  }, 500);
  try {
    clangPkg = await sdk.Wasmer.fromRegistry("clang/clang");
  } finally {
    window.clearInterval(timer);
  }
}

export function compilerLoaded(): boolean {
  return clangPkg !== null;
}

/** Zkompiluje zdrojový soubor do WASM pomocí clangu v prohlížeči. */
export async function compileProgram(
  source: string,
  filename: string,
  lang: SourceLang,
  onStage: (msg: string) => void
): Promise<CompiledProgram> {
  if (!clangPkg) throw new Error("Kompilátor není načtený.");
  const s = await sdkPromise;
  if (!s) throw new Error("SDK není inicializované.");

  onStage("Zapisuji zdroj do virtuálního FS…");
  const project = new s.Directory();
  await project.writeFile(filename, source);

  onStage(`Kompiluji ${filename} (clang → WASM)…`);
  const t0 = performance.now();
  const args =
    lang === "cpp"
      ? ["-x", "c++", "-std=c++17", "-O2", `/project/${filename}`, "-o", "/project/out.wasm"]
      : ["-std=c99", "-O2", `/project/${filename}`, "-o", "/project/out.wasm", "-lm"];
  const inst = await clangPkg.entrypoint.run({ args, mount: { "/project": project } });
  const out = await inst.wait();
  const compileMs = performance.now() - t0;
  const log = (asText(out.stdout) + "\n" + asText(out.stderr)).trim();

  if (!out.ok) {
    return { program: null, wasmBytes: 0, compileMs, log: log || `clang skončil s kódem ${out.code}` };
  }

  onStage("Načítám vygenerovaný WASM modul…");
  const wasm = await project.readFile("out.wasm");
  const program = await s.Wasmer.fromFile(wasm);
  return { program, wasmBytes: wasm.byteLength, compileMs, log };
}

/** Spustí zkompilovaný program a vrátí log + PPM snímek ze stdout. */
export async function runProgram(program: unknown, phase: number, onStage: (msg: string) => void): Promise<RunOutput> {
  const s = await sdkPromise;
  if (!s) throw new Error("SDK není inicializované.");
  const prog = program as { entrypoint: { run: (opts: unknown) => Promise<{ wait: () => Promise<ProcOut> }> } };

  onStage("Spouštím raytracer (WASM)…");
  const t0 = performance.now();
  const workdir = new s.Directory();
  const inst = await prog.entrypoint.run({
    args: ["tabule", "--web", "--phase", phase.toFixed(3)],
    mount: { "/project": workdir },
  });
  const out = await inst.wait();
  const runMs = performance.now() - t0;

  const stdoutBytes = typeof out.stdout === "string" ? new TextEncoder().encode(out.stdout) : out.stdout;
  const log = (asText(out.stdout) + "\n" + asText(out.stderr)).trim();
  return { ok: out.ok, log, runMs, ppm: stdoutBytes ? extractPPM(stdoutBytes) : null };
}

/** Najde v proudu stdout blok PPMBEGIN → P6 header → RGB data → PPMEND. */
function extractPPM(bytes: Uint8Array): { w: number; h: number; rgb: Uint8Array } | null {
  const marker = [80, 80, 77, 66, 69, 71, 73, 78, 10]; // "PPMBEGIN\n"
  outer: for (let i = 0; i + marker.length < bytes.length; i++) {
    for (let k = 0; k < marker.length; k++) {
      if (bytes[i + k] !== marker[k]) continue outer;
    }
    // za značkou očekáváme "P6\n<W> <H>\n255\n"
    let p = i + marker.length;
    if (bytes[p] !== 80 || bytes[p + 1] !== 54 || bytes[p + 2] !== 10) return null;
    p += 3;
    let w = 0;
    while (p < bytes.length && bytes[p] >= 48 && bytes[p] <= 57) w = w * 10 + (bytes[p++] - 48);
    if (bytes[p] !== 32) return null;
    p++;
    let h = 0;
    while (p < bytes.length && bytes[p] >= 48 && bytes[p] <= 57) h = h * 10 + (bytes[p++] - 48);
    if (bytes[p] !== 10) return null;
    p++;
    if (bytes[p] !== 50 || bytes[p + 1] !== 53 || bytes[p + 2] !== 53 || bytes[p + 3] !== 10) return null;
    p += 4;
    const need = w * h * 3;
    if (w < 1 || h < 1 || need > 24_000_000 || p + need > bytes.length) return null;
    return { w, h, rgb: bytes.slice(p, p + need) };
  }
  return null;
}
