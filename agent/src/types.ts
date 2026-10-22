import { createHash } from "node:crypto";

// Orden de mayor a menor gravedad. Se usa para ordenar y contar hallazgos.
export const SEVERITIES = ["critico", "alto", "medio", "bajo"] as const;
export type Severity = (typeof SEVERITIES)[number];

export type Decision = "APROBADO" | "ADVERTENCIA" | "BLOQUEADO";

/** Un problema encontrado en el cambio, venga de un chequeo determinístico o del LLM. */
export interface Finding {
  id: string;
  file: string | null;
  line: number | null;
  severity: Severity;
  category: string;
  explanation: string;
  suggestion: string;
  source: "deterministico" | "llm";
}

export interface CheckResult {
  name: string;
  status: "ok" | "fallo" | "omitido";
  durationMs: number;
  /** Comando ejecutado o motivo por el que se omitió. */
  detail?: string;
}

export interface GateResult {
  decision: Decision;
  /** Nombre de la regla que definió la decisión (null si se aprobó sin reglas aplicadas). */
  rule: string | null;
  reason: string;
}

export interface StageTiming {
  stage: string;
  ms: number;
}

/** Resultado completo de `guardian review`. Es exactamente lo que imprime `--json`. */
export interface ReviewReport {
  decision: Decision;
  gate: GateResult;
  changes: { description: string; files: string[] };
  checks: CheckResult[];
  findings: Finding[];
  warnings: string[];
  timings: StageTiming[];
  /** Datos de la llamada al LLM, si se hizo. */
  llm?: LLMUsage;
  /** Hallazgos ocultados porque el equipo ya los descartó (memoria). */
  dismissed: Finding[];
}

export interface LLMUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  attempts: number;
  /** Secretos reemplazados en el contexto antes de enviarlo. */
  redactions: number;
  /** Archivos que no se enviaron (ignorados, binarios o por tamaño). */
  omitted: string[];
  /** Skills cargadas para esta revisión. */
  skills: string[];
  /** Excepciones de la memoria incluidas en el prompt. */
  exceptions: number;
  /** true si la llamada falló y no hubo revisión de IA. */
  failed: boolean;
  /** Archivo donde se guardó la grabación (solo con --record). */
  recordedTo?: string;
}

/** Error "esperado" (configuración inválida, no es un repo, etc.): se muestra sin stack trace. */
export class GuardianError extends Error {}

/**
 * ID corto y estable de un hallazgo, derivado de su contenido.
 * No incluye la línea: si el código se mueve, el ID sigue siendo el mismo
 * (importante para que `dismiss` funcione entre ejecuciones).
 */
export function makeFindingId(...parts: (string | null)[]): string {
  const hash = createHash("sha1").update(parts.join("|")).digest("hex");
  return `G-${hash.slice(0, 6)}`;
}
