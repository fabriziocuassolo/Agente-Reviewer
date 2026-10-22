import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { GuardianError, type Finding, type ReviewReport } from "./types.js";

/**
 * Memoria del equipo: hallazgos que alguien marcó como falso positivo.
 * Vive en el repo revisado (.guardian/memory.json) y se commitea: así el
 * conocimiento se comparte con todo el equipo y queda versionado.
 *
 * Se usa de dos formas:
 * 1. Filtro exacto: un hallazgo con el mismo ID no se vuelve a mostrar.
 * 2. Prompt: se le pasan al revisor como "excepciones conocidas", para que
 *    no repita el mismo criterio aunque lo redacte distinto.
 * Es lo que hace que el agente mejore con el uso, sin fine-tuning.
 */
export const MEMORY_PATH = ".guardian/memory.json";
/** Último reporte, para que `dismiss` sepa a qué hallazgo corresponde un ID. No se commitea. */
export const LAST_REVIEW_PATH = ".guardian/last-review.json";

const entrySchema = z.object({
  id: z.string(),
  file: z.string().nullable(),
  category: z.string(),
  /** Descripción del hallazgo descartado (el "patrón" que no hay que repetir). */
  pattern: z.string(),
  reason: z.string(),
  date: z.string(),
});
export type MemoryEntry = z.infer<typeof entrySchema>;

const memorySchema = z.object({ dismissed: z.array(entrySchema) });

// Los chequeos de comandos son hechos, no opiniones: no se descartan, se arreglan.
const NOT_DISMISSABLE = new Set(["lint", "tipos", "tests"]);

export function loadMemory(root: string): MemoryEntry[] {
  const path = join(root, MEMORY_PATH);
  if (!existsSync(path)) return [];
  const parsed = memorySchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) throw new GuardianError(`${MEMORY_PATH} tiene un formato inválido.`);
  return parsed.data.dismissed;
}

function writeJson(root: string, relativePath: string, data: unknown) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

export function saveLastReview(root: string, report: ReviewReport) {
  writeJson(root, LAST_REVIEW_PATH, report);
}

/** Separa los hallazgos que ya fueron descartados por el equipo. */
export function applyMemory(findings: Finding[], memory: MemoryEntry[]): { kept: Finding[]; hidden: Finding[] } {
  const dismissedIds = new Set(memory.map((m) => m.id));
  return {
    kept: findings.filter((f) => !dismissedIds.has(f.id)),
    hidden: findings.filter((f) => dismissedIds.has(f.id)),
  };
}

/** Excepciones relevantes para este cambio (las de sus archivos + las generales), para el prompt. */
export function relevantExceptions(memory: MemoryEntry[], changedFiles: string[], limit = 20): MemoryEntry[] {
  const files = new Set(changedFiles);
  return memory.filter((m) => m.file === null || files.has(m.file)).slice(-limit);
}

/** `guardian dismiss <id> "<motivo>"` */
export function dismissFinding(root: string, id: string, reason: string): MemoryEntry {
  if (reason.trim().length < 5) {
    throw new GuardianError("Escribí un motivo (al menos 5 caracteres): es lo que va a leer el resto del equipo.");
  }

  const lastPath = join(root, LAST_REVIEW_PATH);
  if (!existsSync(lastPath)) throw new GuardianError("No hay una revisión previa. Corré `guardian review` primero.");
  const last = JSON.parse(readFileSync(lastPath, "utf8")) as ReviewReport;

  const finding = last.findings.find((f) => f.id === id);
  if (!finding) {
    const ids = last.findings.map((f) => f.id).join(", ") || "ninguno";
    throw new GuardianError(`No encontré el hallazgo ${id} en la última revisión (IDs disponibles: ${ids}).`);
  }
  if (finding.source === "deterministico" && NOT_DISMISSABLE.has(finding.category)) {
    throw new GuardianError(
      `Los fallos de ${finding.category} no se descartan: corregí el código o ajustá el comando en .guardian/config.json.`,
    );
  }

  const memory = loadMemory(root);
  if (memory.some((m) => m.id === id)) throw new GuardianError(`El hallazgo ${id} ya estaba descartado.`);

  const entry: MemoryEntry = {
    id,
    file: finding.file,
    category: finding.category,
    pattern: finding.explanation.split("\n")[0].slice(0, 300),
    reason: reason.trim(),
    date: new Date().toISOString().slice(0, 10),
  };
  writeJson(root, MEMORY_PATH, { dismissed: [...memory, entry] });
  return entry;
}
