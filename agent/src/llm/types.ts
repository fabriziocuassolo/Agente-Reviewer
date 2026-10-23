export interface LLMRequest {
  system: string;
  prompt: string;
  /** Pedir la respuesta en JSON (por defecto sí; `ask` lo desactiva para recibir texto). */
  json?: boolean;
}

export interface LLMResponse {
  text: string;
  /** Tokens consumidos, si el proveedor los informa (para estimar costo). */
  inputTokens?: number;
  outputTokens?: number;
  /** Aviso del proveedor para mostrar al usuario (ej: grabación desactualizada). */
  notice?: string;
}

/**
 * Interfaz común de todos los proveedores. El resto del sistema solo conoce
 * esto: cambiar de Gemini a Ollama (o a respuestas grabadas) no toca el revisor.
 */
export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(request: LLMRequest): Promise<LLMResponse>;
  /** Verificación previa opcional: devuelve null si está listo, o instrucciones si no. */
  checkReady?(): Promise<string | null>;
}

/** Error del proveedor (red, timeout, cuota). El revisor lo convierte en un aviso. */
export class LLMError extends Error {}
