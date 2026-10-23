import { ollamaSetupHelp } from "./help.js";
import { LLMError, type LLMProvider, type LLMRequest, type LLMResponse } from "./types.js";

interface OllamaChatResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

/**
 * Proveedor Ollama: el modelo corre en la máquina del desarrollador.
 * El código nunca sale de la computadora y no tiene costo por uso.
 */
export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";

  constructor(
    private readonly host: string,
    readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  /** Modelos instalados en Ollama, o null si Ollama no responde. */
  async listModels(): Promise<string[] | null> {
    return (await this.listModelsWithSize())?.map((m) => m.name) ?? null;
  }

  /** Modelos instalados con su tamaño en bytes (para ofrecer "el más chico" y "el más grande"). */
  async listModelsWithSize(): Promise<{ name: string; size: number }[] | null> {
    try {
      const response = await fetch(`${this.host.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(3_000) });
      const data = (await response.json()) as { models?: { name: string; size?: number }[] };
      return (data.models ?? []).map((m) => ({ name: m.name, size: m.size ?? 0 }));
    } catch {
      return null;
    }
  }

  /** Antes de revisar: ¿Ollama está corriendo y tiene el modelo? Si no, devuelve qué hacer. */
  async checkReady(): Promise<string | null> {
    const models = await this.listModels();
    if (models === null) return ollamaSetupHelp(this.model, "no-server", this.host);
    const wanted = this.model.includes(":") ? this.model : `${this.model}:latest`;
    if (!models.includes(wanted)) return ollamaSetupHelp(this.model, "no-model", this.host);
    return null;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    let response: Response;
    try {
      response = await fetch(`${this.host.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.prompt },
          ],
          stream: false,
          // Fuerza salida JSON para las revisiones; `ask` pide texto libre.
          ...(request.json === false ? {} : { format: "json" }),
          options: {
            temperature: 0.2,
            // Ollama usa por defecto una ventana chica (2-4k tokens) y recorta el prompt en silencio.
            num_ctx: 16384,
          },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if ((error as Error).name === "TimeoutError") {
        throw new LLMError(`Ollama no respondió en ${Math.round(this.timeoutMs / 1000)} s (LLM_TIMEOUT_MS)`);
      }
      throw new LLMError(`No se pudo conectar con Ollama en ${this.host}. ¿Está corriendo? (ollama serve)`);
    }

    const data = (await response.json().catch(() => ({}))) as OllamaChatResponse;
    if (!response.ok) {
      const hint = response.status === 404 ? ` Descargalo con: ollama pull ${this.model}` : "";
      throw new LLMError(`Ollama respondió ${response.status}: ${data.error ?? response.statusText}.${hint}`);
    }
    const text = data.message?.content;
    if (!text) throw new LLMError("Ollama no devolvió texto");
    return { text, inputTokens: data.prompt_eval_count, outputTokens: data.eval_count };
  }
}
