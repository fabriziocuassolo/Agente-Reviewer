/**
 * Error de negocio con código HTTP asociado.
 * Las rutas lo lanzan y el middleware de errores lo convierte en respuesta JSON.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
