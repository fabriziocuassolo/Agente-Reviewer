import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LLMError, type LLMProvider, type LLMRequest, type LLMResponse } from "./types.js";

/**
 * Grabaciones de respuestas reales del LLM, para probar Guardian sin key ni modelo local.
 *
 * Cada archivo de demo/recordings/ guarda TODAS las respuestas de una revisión, en orden
 * (si hubo reintento por JSON inválido, quedan las dos). El nombre del archivo es:
 * - GUARDIAN_RECORDING (lo setea `npm run demo` con el nombre del escenario), o
 * - el hash del prompt, si no se definió.
 */
interface Recording {
  key: string;
  provider: string;
  model: string;
  recordedAt: string;
  /** Hash del primer prompt: permite avisar si el código cambió desde que se grabó. */
  promptHash: string;
  responses: LLMResponse[];
}

export function promptHash(request: LLMRequest): string {
  return createHash("sha256").update(request.system).update("\n").update(request.prompt).digest("hex").slice(0, 16);
}

function recordingPath(dir: string, key: string): string {
  return join(dir, `${key.replace(/[^\w.-]/g, "_")}.json`);
}

/** Envuelve un proveedor real y guarda sus respuestas (`guardian review --record`). */
export class RecordingProvider implements LLMProvider {
  private recording: Recording | null = null;

  constructor(
    private readonly inner: LLMProvider,
    private readonly dir: string,
    private readonly key?: string,
  ) {}

  get name() {
    return this.inner.name;
  }

  get model() {
    return this.inner.model;
  }

  /** Ruta del archivo grabado (para mostrarla al usuario). */
  get savedTo(): string | null {
    return this.recording ? recordingPath(this.dir, this.recording.key) : null;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const response = await this.inner.complete(request);
    if (!this.recording) {
      const hash = promptHash(request);
      this.recording = {
        key: this.key ?? hash,
        provider: this.inner.name,
        model: this.inner.model,
        recordedAt: new Date().toISOString(),
        promptHash: hash,
        responses: [],
      };
    }
    this.recording.responses.push({ text: response.text, inputTokens: response.inputTokens, outputTokens: response.outputTokens });
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(recordingPath(this.dir, this.recording.key), JSON.stringify(this.recording, null, 2) + "\n");
    return response;
  }
}

/** Reproduce respuestas grabadas. No hace ninguna llamada de red. */
export class ReplayProvider implements LLMProvider {
  readonly name = "replay";
  model = "respuestas grabadas";
  private calls = 0;

  constructor(
    private readonly dir: string,
    private readonly key?: string,
  ) {}

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const hash = promptHash(request);
    const path = recordingPath(this.dir, this.key ?? hash);
    if (!existsSync(path)) {
      throw new LLMError(
        "no hay una grabación para este cambio. El modo replay solo funciona con los escenarios de demo " +
          "(npm run demo); para revisar otros cambios usá ollama o gemini",
      );
    }

    const recording = JSON.parse(readFileSync(path, "utf8")) as Recording;
    this.model = `${recording.model} (grabado ${recording.recordedAt.slice(0, 10)})`;
    const response = recording.responses[Math.min(this.calls, recording.responses.length - 1)];
    this.calls++;

    const notice =
      this.calls === 1 && recording.promptHash !== hash
        ? "La grabación se hizo sobre un contexto distinto al actual (el código cambió desde que se grabó): se reproduce igual."
        : undefined;
    return { ...response, notice };
  }
}
