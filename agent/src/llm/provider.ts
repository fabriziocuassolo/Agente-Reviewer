import { GeminiProvider } from "./gemini.js";
import type { LLMProvider } from "./types.js";

// Medido en oct-2026 con la capa gratuita, sobre el mismo bug de precios:
// - gemini-3.8-flash:      mejor calidad, pero saturado (503) o ~60-80 s por revisión
// - gemini-3.6-flash:      buena calidad, ~11 s  ← equilibrio elegido
// - gemini-3.5-flash-lite: ~2 s, pero subestimó la severidad y explicó mal el bug
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

/**
 * Crea el proveedor según LLM_PROVIDER. Si falta configuración devuelve
 * el motivo en vez de lanzar: la revisión sigue con los chequeos determinísticos.
 */
export function createProvider(env = process.env): { provider: LLMProvider | null; reason?: string } {
  const name = (env.LLM_PROVIDER ?? "").trim().toLowerCase();
  const timeoutMs = Number(env.LLM_TIMEOUT_MS) || 60_000;

  switch (name) {
    case "gemini": {
      const apiKey = env.GEMINI_API_KEY?.trim();
      if (!apiKey) return { provider: null, reason: "LLM_PROVIDER=gemini pero falta GEMINI_API_KEY en .env" };
      const model = env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
      return { provider: new GeminiProvider(apiKey, model, timeoutMs) };
    }
    case "":
      return { provider: null, reason: "No hay LLM configurado (definí LLM_PROVIDER en .env)" };
    default:
      return { provider: null, reason: `LLM_PROVIDER desconocido: "${name}" (opciones: gemini)` };
  }
}
