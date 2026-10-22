export interface LLMRequest {
  system: string;
  prompt: string;
}

export interface LLMResponse {
  text: string;
  /** Tokens consumidos, si el proveedor los informa (para estimar costo). */
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Interfaz común de todos los proveedores. El resto del sistema solo conoce
 * esto: cambiar de Gemini a Ollama (o a respuestas grabadas) no toca el revisor.
 */
export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(request: LLMRequest): Promise<LLMResponse>;
}

/** Error del proveedor (red, timeout, cuota). El revisor lo convierte en un aviso. */
export class LLMError extends Error {}
