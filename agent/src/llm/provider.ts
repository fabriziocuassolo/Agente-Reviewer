import { readdirSync } from "node:fs";
import { join } from "node:path";
import { GUARDIAN_HOME } from "../env.js";
import { GuardianError } from "../types.js";
import { GeminiProvider } from "./gemini.js";
import { OllamaProvider } from "./ollama.js";
import { RecordingProvider, ReplayProvider } from "./replay.js";
import { DEFAULT_OLLAMA_HOST, geminiSetupHelp } from "./help.js";
import type { LLMProvider } from "./types.js";

export { geminiSetupHelp, ollamaSetupHelp } from "./help.js";

// Medido en oct-2026 con la capa gratuita, sobre el mismo bug de precios:
// - gemini-3.8-flash:      mejor calidad, pero saturado (503) o ~60-80 s por revisión
// - gemini-3.6-flash:      buena calidad, ~11 s  ← equilibrio elegido
// - gemini-3.5-flash-lite: ~2 s, pero subestimó la severidad y explicó mal el bug
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
export const DEFAULT_OLLAMA_MODEL = "qwen2.5-coder:7b";

export const RECORDINGS_DIR = join(GUARDIAN_HOME, "demo", "recordings");

export type ProviderName = "replay" | "gemini" | "ollama";

// Nombres que acepta `--use` (y LLM_PROVIDER). "ia" = la IA en la nube por defecto (Gemini).
const ALIASES: Record<string, ProviderName> = {
  replay: "replay",
  grabado: "replay",
  gemini: "gemini",
  ia: "gemini",
  nube: "gemini",
  ollama: "ollama",
  local: "ollama",
};

export interface ProviderOptions {
  /** IA elegida desde la terminal (`--use`). Tiene prioridad sobre el .env. */
  use?: string;
  /** Modelo elegido desde la terminal (`--model`). */
  model?: string;
  /** Guardar las respuestas del proveedor real en demo/recordings (--record). */
  record?: boolean;
}

export interface ProviderChoice {
  provider: LLMProvider | null;
  name: ProviderName | null;
  /** true si la eligió el usuario con --use: si no está lista, se corta con instrucciones. */
  explicit: boolean;
  /** Por qué no hay proveedor, con instrucciones para resolverlo. */
  reason?: string;
}

/** Orden de prioridad: --use  >  LLM_PROVIDER del .env  >  replay. */
export function resolveProviderName(use: string | undefined, env: NodeJS.ProcessEnv): ProviderName | string {
  const raw = (use ?? env.LLM_PROVIDER ?? "").trim().toLowerCase();
  if (!raw) return "replay";
  return ALIASES[raw] ?? raw;
}

/**
 * Crea el proveedor. Si falta configuración devuelve el motivo (con instrucciones)
 * en vez de lanzar: quien llama decide si corta (--use explícito) o sigue sin IA.
 */
export function createProvider(env: NodeJS.ProcessEnv = process.env, options: ProviderOptions = {}): ProviderChoice {
  const explicit = Boolean(options.use);
  const name = resolveProviderName(options.use, env);
  const timeoutMs = Number(env.LLM_TIMEOUT_MS) || 60_000;
  // Nombre de la grabación: lo define `npm run demo` (nombre del escenario).
  const recordingKey = env.GUARDIAN_RECORDING?.trim() || undefined;

  let provider: LLMProvider;
  switch (name) {
    case "gemini": {
      const apiKey = env.GEMINI_API_KEY?.trim();
      if (!apiKey) return { provider: null, name, explicit, reason: geminiSetupHelp() };
      provider = new GeminiProvider(apiKey, options.model || env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL, timeoutMs);
      break;
    }
    case "ollama":
      provider = new OllamaProvider(
        env.OLLAMA_HOST?.trim() || DEFAULT_OLLAMA_HOST,
        options.model || env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL,
        // Un modelo local en CPU puede tardar bastante más que una API.
        Number(env.LLM_TIMEOUT_MS) || 180_000,
      );
      break;
    case "replay":
      if (options.record) {
        return { provider: null, name, explicit, reason: "--record necesita una IA real: agregá --use gemini o --use ollama." };
      }
      return { provider: new ReplayProvider(RECORDINGS_DIR, recordingKey), name, explicit };
    default:
      return {
        provider: null,
        name: null,
        explicit,
        reason: `No conozco la IA "${name}". Opciones: --use replay, --use gemini (o "ia"), --use ollama (o "local").`,
      };
  }

  return {
    provider: options.record ? new RecordingProvider(provider, RECORDINGS_DIR, recordingKey) : provider,
    name,
    explicit,
  };
}

/**
 * Crea el proveedor y verifica que esté listo (ej.: Ollama corriendo y con el modelo).
 * Si el usuario lo pidió con --use y no está listo, corta con las instrucciones:
 * es mejor que enterarse al final de la revisión de que la IA no corrió.
 */
export async function prepareProvider(env: NodeJS.ProcessEnv, options: ProviderOptions): Promise<ProviderChoice> {
  let choice = createProvider(env, options);
  const problem = choice.provider?.checkReady ? await choice.provider.checkReady() : null;
  if (problem) choice = { ...choice, provider: null, reason: problem };

  if (!choice.provider && choice.explicit) throw new GuardianError(choice.reason ?? "La IA elegida no está disponible.");
  return choice;
}

// ---------------------------------------------------------------------------
// `guardian ia`: estado de cada opción

export interface ProviderStatus {
  name: ProviderName;
  active: boolean;
  ready: boolean;
  detail: string;
}

export async function providersStatus(env: NodeJS.ProcessEnv = process.env): Promise<ProviderStatus[]> {
  const active = resolveProviderName(undefined, env);

  let recordings = 0;
  try {
    recordings = readdirSync(RECORDINGS_DIR).filter((f) => f.endsWith(".json")).length;
  } catch {
    // sin carpeta de grabaciones
  }

  const geminiKey = Boolean(env.GEMINI_API_KEY?.trim());
  const ollamaModel = env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL;
  const ollama = new OllamaProvider(env.OLLAMA_HOST?.trim() || DEFAULT_OLLAMA_HOST, ollamaModel, 5_000);
  const ollamaProblem = await ollama.checkReady();
  const installed = await ollama.listModels();

  return [
    {
      name: "replay",
      active: active === "replay",
      ready: recordings > 0,
      detail: `${recordings} grabación(es) de la demo. Sin key ni internet; solo sirve para los escenarios de demo.`,
    },
    {
      name: "gemini",
      active: active === "gemini",
      ready: geminiKey,
      detail: geminiKey
        ? `Key configurada · modelo ${env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL}. En la nube, la más precisa.`
        : "Falta GEMINI_API_KEY. Corré con --use gemini para ver cómo conseguirla.",
    },
    {
      name: "ollama",
      active: active === "ollama",
      ready: !ollamaProblem,
      detail: ollamaProblem
        ? installed === null
          ? "No está instalado o no está abierto. Corré con --use ollama para ver cómo instalarlo."
          : `Ollama anda, pero falta el modelo ${ollamaModel} (ollama pull ${ollamaModel}).`
        : `Listo · modelo ${ollamaModel}${installed && installed.length > 1 ? ` (instalados: ${installed.join(", ")})` : ""}. Local y privado.`,
    },
  ];
}
