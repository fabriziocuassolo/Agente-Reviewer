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
          format: "json", // fuerza salida JSON
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
