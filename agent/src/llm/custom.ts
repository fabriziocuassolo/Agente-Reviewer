import Anthropic from "@anthropic-ai/sdk";
import { LLMError, type LLMProvider, type LLMRequest, type LLMResponse } from "./types.js";

/**
 * IAs que el usuario agrega en el .env, sin tocar código.
 *
 *   IA_<NOMBRE>_URL=...       dirección de la API (no hace falta con FORMATO=anthropic)
 *   IA_<NOMBRE>_KEY=...       clave de la API (opcional para servidores locales)
 *   IA_<NOMBRE>_MODEL=...     modelo
 *   IA_<NOMBRE>_FORMATO=...   openai (por defecto) | anthropic
 *
 * Apenas están en el .env, `--use <nombre>` y `guardian ia` las reconocen.
 *
 * - Formato "openai": el estándar de /chat/completions que usan OpenAI, DeepSeek, Groq,
 *   OpenRouter, Mistral, LM Studio, Ollama... Se llama con fetch: es un formato genérico.
 * - Formato "anthropic": Claude tiene su propia API; se usa el SDK oficial de Anthropic.
 */

export type CustomFormat = "openai" | "anthropic";

export interface CustomProviderConfig {
  /** Nombre en minúsculas, el que se escribe en --use. */
  name: string;
  /** Prefijo de las variables, para los mensajes de ayuda (ej: IA_CHATGPT). */
  prefix: string;
  url?: string;
  key?: string;
  model?: string;
  format: CustomFormat;
}

// Nombres que ya usa Guardian: no se pueden pisar.
export const RESERVED_NAMES = new Set(["replay", "grabado", "gemini", "ia", "nube", "ollama", "local"]);

const VAR = /^IA_([A-Z0-9][A-Z0-9_]*?)_(URL|KEY|MODEL|FORMATO)$/;

/** Lee del entorno todas las IAs declaradas con el patrón IA_<NOMBRE>_... */
export function readCustomProviders(env: NodeJS.ProcessEnv): Map<string, CustomProviderConfig> {
  const found = new Map<string, CustomProviderConfig>();
  for (const [variable, rawValue] of Object.entries(env)) {
    const match = VAR.exec(variable);
    const value = rawValue?.trim();
    if (!match || !value) continue;

    const name = match[1].toLowerCase();
    const config = found.get(name) ?? { name, prefix: `IA_${match[1]}`, format: "openai" as CustomFormat };
    if (match[2] === "URL") config.url = value.replace(/\/+$/, "");
    if (match[2] === "KEY") config.key = value;
    if (match[2] === "MODEL") config.model = value;
    if (match[2] === "FORMATO") config.format = value.toLowerCase() === "anthropic" ? "anthropic" : "openai";
    found.set(name, config);
  }
  for (const name of RESERVED_NAMES) found.delete(name);
  return found;
}

/** Qué le falta a una IA propia para funcionar (null si está completa). */
export function missingConfig(config: CustomProviderConfig): string | null {
  const missing: string[] = [];
  if (!config.model) missing.push(`${config.prefix}_MODEL=nombre-del-modelo`);
  if (config.format === "openai" && !config.url) missing.push(`${config.prefix}_URL=https://...`);
  if (config.format === "anthropic" && !config.key) missing.push(`${config.prefix}_KEY=tu-clave`);
  if (missing.length === 0) return null;
  return (
    `A la IA "${config.name}" le falta configuración en el .env:\n` +
    missing.map((line) => `  ${line}`).join("\n") +
    "\nGuía completa: guardian ayuda otra-ia"
  );
}

export function createCustomProvider(config: CustomProviderConfig, timeoutMs: number): LLMProvider {
  const model = config.model!;
  return config.format === "anthropic"
    ? new AnthropicProvider(config.name, model, config.key!, config.url, timeoutMs)
    : new OpenAICompatibleProvider(config.name, model, config.url!, config.key, timeoutMs);
}

// ---------------------------------------------------------------------------
// Formato OpenAI (/chat/completions)

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string } | string;
}

export class OpenAICompatibleProvider implements LLMProvider {
  /** Si el proveedor rechazó el modo JSON una vez, no se vuelve a pedir. */
  private jsonModeSupported = true;

  constructor(
    readonly name: string,
    readonly model: string,
    private readonly url: string,
    private readonly key: string | undefined,
    private readonly timeoutMs: number,
  ) {}

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const wantsJson = request.json !== false && this.jsonModeSupported;
    const response = await this.post(request, wantsJson);
    const data = (await response.json().catch(() => ({}))) as ChatCompletionResponse;

    // Algunos proveedores compatibles no soportan el modo JSON: se reintenta sin él
    // (el prompt igual pide JSON y el revisor lo valida).
    if (response.status === 400 && wantsJson && /response_format|json/i.test(JSON.stringify(data.error ?? ""))) {
      this.jsonModeSupported = false;
      return this.complete(request);
    }
    return this.handle(response, data);
  }

  private async post(request: LLMRequest, jsonMode: boolean): Promise<Response> {
    try {
      return await fetch(`${this.url}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // La clave va en un header, nunca en la URL.
          ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.prompt },
          ],
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if ((error as Error).name === "TimeoutError") {
        throw new LLMError(`${this.name} no respondió en ${Math.round(this.timeoutMs / 1000)} s (LLM_TIMEOUT_MS)`);
      }
      throw new LLMError(`No se pudo conectar con ${this.name} en ${this.url}: ${(error as Error).message}`);
    }
  }

  private handle(response: Response, data: ChatCompletionResponse): LLMResponse {
    if (!response.ok) {
      const detail = typeof data.error === "string" ? data.error : (data.error?.message ?? response.statusText);
      const hint =
        response.status === 401 || response.status === 403
          ? " (revisá la clave)"
          : response.status === 404
            ? " (revisá la URL y el nombre del modelo)"
            : response.status === 429
              ? " (límite de uso o saldo de la cuenta)"
              : "";
      throw new LLMError(`${this.name} respondió ${response.status}: ${detail.split("\n")[0]}${hint}`);
    }

    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new LLMError(`${this.name} no devolvió texto`);
    return { text, inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens };
  }
}

// ---------------------------------------------------------------------------
// Formato Anthropic (Claude), con el SDK oficial

// Modelos de Claude con respaldo automático ("fallbacks") si el modelo rechaza un pedido
// por sus filtros de seguridad: la API reintenta con otro modelo dentro de la misma llamada.
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export class AnthropicProvider implements LLMProvider {
  private readonly client: Anthropic;

  constructor(
    readonly name: string,
    readonly model: string,
    apiKey: string,
    baseURL: string | undefined,
    timeoutMs: number,
  ) {
    this.client = new Anthropic({ apiKey, baseURL, timeout: timeoutMs, maxRetries: 2 });
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const params = {
      model: this.model,
      max_tokens: 16000,
      system: request.system,
      messages: [{ role: "user" as const, content: request.prompt }],
    };

    try {
      const response = FALLBACK_MODELS.has(this.model)
        ? await this.client.beta.messages.create({
            ...params,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          })
        : await this.client.messages.create(params);

      if (response.stop_reason === "refusal") {
        throw new LLMError(`${this.name} rechazó revisar este cambio (filtro de seguridad del modelo)`);
      }
      const text = response.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("")
        .trim();
      if (!text) throw new LLMError(`${this.name} no devolvió texto (stop_reason: ${response.stop_reason})`);
      return { text, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
    } catch (error) {
      if (error instanceof LLMError) throw error;
      if (error instanceof Anthropic.AuthenticationError) throw new LLMError(`${this.name}: la clave no es válida (revisá la KEY)`);
      if (error instanceof Anthropic.NotFoundError) throw new LLMError(`${this.name}: no existe el modelo "${this.model}"`);
      if (error instanceof Anthropic.RateLimitError) throw new LLMError(`${this.name}: límite de uso alcanzado, probá más tarde`);
      if (error instanceof Anthropic.APIConnectionError) throw new LLMError(`No se pudo conectar con ${this.name}`);
      if (error instanceof Anthropic.APIError) throw new LLMError(`${this.name} respondió ${error.status}: ${error.message}`);
      throw error;
    }
  }
}
