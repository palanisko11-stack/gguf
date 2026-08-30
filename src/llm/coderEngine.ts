// ─────────────────────────────────────────────────────────────────────────────
// CODER ENGINE · GGUF inference v prohlížeči
// Engine je llama.cpp (C++) zkompilovaný do WebAssembly přes projekt wllama.
// Model se stáhne z Hugging Face (GGUF), cachuje se v OPFS a běží lokálně.
// ─────────────────────────────────────────────────────────────────────────────
import wasmUrl from "@wllama/wllama/esm/wasm/wllama.wasm?url";
import type { Wllama as WllamaType } from "@wllama/wllama";

export interface ChatModel {
  id: string;
  label: string;
  sub: string;
  sizeMB: number;
  url: string;
  tag?: string;
}

export const MODELS: ChatModel[] = [
  {
    id: "smol135",
    label: "SmolLM2 135M",
    sub: "Q8_0 · nejlehčí start",
    sizeMB: 145,
    url: "https://huggingface.co/bartowski/SmolLM2-135M-Instruct-GGUF/resolve/main/SmolLM2-135M-Instruct-Q8_0.gguf",
  },
  {
    id: "smol360",
    label: "SmolLM2 360M",
    sub: "Q4_K_M · rychlý chat",
    sizeMB: 217,
    url: "https://huggingface.co/bartowski/SmolLM2-360M-Instruct-GGUF/resolve/main/SmolLM2-360M-Instruct-Q4_K_M.gguf",
  },
  {
    id: "qwen-coder-0.5b",
    label: "Qwen2.5-Coder 0.5B",
    sub: "Q4_K_M · psaní kódu",
    sizeMB: 398,
    url: "https://huggingface.co/bartowski/Qwen2.5-Coder-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-0.5B-Instruct-Q4_K_M.gguf",
    tag: "CODER",
  },
];

export function customModel(url: string): ChatModel {
  const name = url.split("/").pop() ?? "vlastní.gguf";
  return { id: `custom:${url}`, label: name.length > 26 ? name.slice(0, 25) + "…" : name, sub: "vlastní GGUF URL", sizeMB: 0, url };
}

// ── detekce systému ─────────────────────────────────────────────────────────
export interface SystemInfo {
  cores: number;
  ramGb: number | null;
  gpu: string | null;
  threads: boolean;
  saveData: boolean;
  downlink: number | null;
}

export async function detectSystem(): Promise<SystemInfo> {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean; downlink?: number };
  };
  let gpu: string | null = null;
  try {
    const g = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    if (g) {
      const adapter = (await g.requestAdapter()) as {
        info?: { description?: string; vendor?: string; device?: string };
      } | null;
      const info = adapter?.info;
      if (info?.description) gpu = info.description;
      else if (info?.vendor || info?.device) gpu = [info?.vendor, info?.device].filter(Boolean).join(" ");
      else if (adapter) gpu = "WebGPU adaptér";
    }
  } catch {
    gpu = null;
  }
  return {
    cores: nav.hardwareConcurrency ?? 4,
    ramGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    gpu,
    threads: typeof crossOriginIsolated !== "undefined" && crossOriginIsolated === true,
    saveData: !!nav.connection?.saveData,
    downlink: nav.connection?.downlink ?? null,
  };
}

/** Optimální model podle paměti, připojení a účelu (coder). */
export function recommendModelId(sys: SystemInfo): string {
  if (sys.saveData || (sys.downlink !== null && sys.downlink < 1.5)) return "smol135";
  const ram = sys.ramGb;
  if (ram === null || ram >= 6) return "qwen-coder-0.5b";
  if (ram >= 3) return "smol360";
  return "smol135";
}

// ── zprávy ──────────────────────────────────────────────────────────────────
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export const SYSTEM_PROMPT: ChatMessage = {
  role: "system",
  content:
    "Jsi Havířov Coder — stručný česky odpovídající programátorský asistent se záběrem na C++, " +
    "GGUF / llama.cpp, kvantizace modelů a počítačovou grafiku (raymarching, SDF). " +
    "Odpovídej stručně a věcně; kód dávej do bloků ```cpp nebo ```.",
};

// ── engine ──────────────────────────────────────────────────────────────────
export interface GenerationStats {
  tokens: number;
  ms: number;
  finish: string;
}

export class CoderEngine {
  private inst: WllamaType | null = null;
  private loadedUrl: string | null = null;
  private ctrl: AbortController | null = null;

  isLoaded(url: string): boolean {
    return !!this.inst && this.loadedUrl === url;
  }

  async load(model: ChatModel, onProgress: (loaded: number, total: number) => void): Promise<void> {
    if (this.isLoaded(model.url)) return;
    const mod = await import("@wllama/wllama");
    const inst = new mod.Wllama({ default: wasmUrl }, { suppressNativeLog: true });
    await inst.loadModelFromUrl(model.url, {
      n_ctx: 2048,
      n_batch: 512,
      progressCallback: (p: { loaded: number; total: number }) => onProgress(p.loaded ?? 0, p.total ?? 0),
    });
    this.inst = inst;
    this.loadedUrl = model.url;
  }

  async chat(messages: ChatMessage[], onDelta: (text: string) => void): Promise<GenerationStats> {
    if (!this.inst) throw new Error("Model není načtený.");
    this.ctrl = new AbortController();
    let text = "";
    let tokens = 0;
    let firstTokenAt = 0;
    let finish = "stop";
    const t0 = performance.now();

    const stream = await this.inst.createChatCompletion({
      messages,
      max_tokens: 384,
      temperature: 0.7,
      top_p: 0.9,
      abortSignal: this.ctrl.signal,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      const fr = chunk.choices?.[0]?.finish_reason;
      if (delta) {
        if (!firstTokenAt) firstTokenAt = performance.now();
        text += delta;
        tokens += 1;
        onDelta(text);
      }
      if (fr) finish = fr;
    }

    const ms = firstTokenAt ? performance.now() - firstTokenAt : performance.now() - t0;
    return { tokens, ms, finish };
  }

  abort(): void {
    this.ctrl?.abort();
  }

  wasAborted(): boolean {
    return this.ctrl ? this.ctrl.signal.aborted : false;
  }
}
