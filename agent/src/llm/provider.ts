import { join } from "node:path";
import { GUARDIAN_HOME } from "../env.js";
import { GeminiProvider } from "./gemini.js";
import { OllamaProvider } from "./ollama.js";
import { RecordingProvider, ReplayProvider } from "./replay.js";
import type { LLMProvider } from "./types.js";

// Medido en oct-2026 con la capa gratuita, sobre el mismo bug de precios:
// - gemini-3.8-flash:      mejor calidad, pero saturado (503) o ~60-80 s por revisión
// - gemini-3.6-flash:      buena calidad, ~11 s  ← equilibrio elegido
// - gemini-3.5-flash-lite: ~2 s, pero subestimó la severidad y explicó mal el bug
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
export const DEFAULT_OLLAMA_MODEL = "qwen2.5-coder:7b";

export const RECORDINGS_DIR = join(GUARDIAN_HOME, "demo", "recordings");

export interface ProviderOptions {
  /** Guardar las respuestas del proveedor real en demo/recordings (--record). */
  record?: boolean;
}

/**
 * Crea el proveedor según LLM_PROVIDER. Si falta configuración devuelve
 * el motivo en vez de lanzar: la revisión sigue con los chequeos determinísticos.
 */
export function createProvider(
  env: NodeJS.ProcessEnv = process.env,
  options: ProviderOptions = {},
): { provider: LLMProvider | null; reason?: string } {
  const name = (env.LLM_PROVIDER ?? "").trim().toLowerCase();
  const timeoutMs = Number(env.LLM_TIMEOUT_MS) || 60_000;
  // Nombre de la grabación: lo define `npm run demo` (nombre del escenario).
  const recordingKey = env.GUARDIAN_RECORDING?.trim() || undefined;

  let provider: LLMProvider;
  switch (name) {
    case "gemini": {
      const apiKey = env.GEMINI_API_KEY?.trim();
      if (!apiKey) return { provider: null, reason: "LLM_PROVIDER=gemini pero falta GEMINI_API_KEY en .env" };
      provider = new GeminiProvider(apiKey, env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL, timeoutMs);
      break;
    }
    case "ollama":
      provider = new OllamaProvider(
        env.OLLAMA_HOST?.trim() || "http://localhost:11434",
        env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL,
        // Un modelo local en CPU puede tardar bastante más que una API.
        Number(env.LLM_TIMEOUT_MS) || 180_000,
      );
      break;
    case "replay":
      if (options.record) return { provider: null, reason: "--record necesita un proveedor real (gemini u ollama), no replay" };
      return { provider: new ReplayProvider(RECORDINGS_DIR, recordingKey) };
    case "":
      return { provider: null, reason: "No hay LLM configurado (definí LLM_PROVIDER en .env)" };
    default:
      return { provider: null, reason: `LLM_PROVIDER desconocido: "${name}" (opciones: replay, ollama, gemini)` };
  }

  return { provider: options.record ? new RecordingProvider(provider, RECORDINGS_DIR, recordingKey) : provider };
}
