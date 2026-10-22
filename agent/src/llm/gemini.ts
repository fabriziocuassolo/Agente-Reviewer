import { LLMError, type LLMProvider, type LLMRequest, type LLMResponse } from "./types.js";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Errores transitorios (cuota por minuto, servicio saturado): vale la pena reintentar.
const RETRYABLE_STATUS = new Set([429, 500, 503]);
const MAX_ATTEMPTS = 3;

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
}

/**
 * Proveedor Gemini (Google AI Studio) usando la API REST con fetch.
 * Sin SDK: una dependencia menos y se ve exactamente qué se envía.
 */
export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: "user", parts: [{ text: request.prompt }] }],
      generationConfig: {
        temperature: 0.2, // revisiones consistentes entre ejecuciones
        responseMimeType: "application/json", // modo JSON nativo de Gemini
      },
    });

    for (let attempt = 1; ; attempt++) {
      const response = await this.post(body);
      const data = (await response.json().catch(() => ({}))) as GeminiResponse;

      if (response.ok) return this.extract(data);

      if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
        await sleep(2000 * attempt);
        continue;
      }
      throw new LLMError(`Gemini respondió ${response.status}: ${data.error?.message ?? response.statusText}`);
    }
  }

  private async post(body: string): Promise<Response> {
    try {
      return await fetch(`${API_BASE}/${encodeURIComponent(this.model)}:generateContent`, {
        method: "POST",
        // La key va en un header, nunca en la URL (las URLs quedan en logs).
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if ((error as Error).name === "TimeoutError") {
        throw new LLMError(`Gemini no respondió en ${Math.round(this.timeoutMs / 1000)} s (LLM_TIMEOUT_MS)`);
      }
      throw new LLMError(`No se pudo conectar con Gemini: ${(error as Error).message}`);
    }
  }

  private extract(data: GeminiResponse): LLMResponse {
    const candidate = data.candidates?.[0];
    // Los modelos con "thinking" pueden devolver partes de razonamiento: se descartan.
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("");
    if (!text) throw new LLMError(`Gemini no devolvió texto (finishReason: ${candidate?.finishReason ?? "desconocido"})`);
    return {
      text,
      inputTokens: data.usageMetadata?.promptTokenCount,
      outputTokens: data.usageMetadata?.candidatesTokenCount,
    };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
