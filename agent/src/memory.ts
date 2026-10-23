import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import ignore from "ignore";
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

/** Regla que el equipo le enseñó a Guardian con `guardian aprender`. */
const learnedSchema = z.object({
  regla: z.string().min(1),
  /** Patrones de archivos donde aplica (sintaxis .gitignore); vacío = todos. */
  archivos: z.array(z.string()).optional(),
  fecha: z.string(),
});
export type LearnedRule = z.infer<typeof learnedSchema>;

const memorySchema = z.object({
  dismissed: z.array(entrySchema).default([]),
  aprendido: z.array(learnedSchema).default([]),
});
type MemoryFile = z.infer<typeof memorySchema>;

function readMemoryFile(root: string): MemoryFile {
  const path = join(root, MEMORY_PATH);
  if (!existsSync(path)) return { dismissed: [], aprendido: [] };
  const parsed = memorySchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) throw new GuardianError(`${MEMORY_PATH} tiene un formato inválido.`);
  return parsed.data;
}

// Los chequeos de comandos son hechos, no opiniones: no se descartan, se arreglan.
const NOT_DISMISSABLE = new Set(["lint", "tipos", "tests"]);

export function loadMemory(root: string): MemoryEntry[] {
  return readMemoryFile(root).dismissed;
}

// ---------------------------------------------------------------------------
// Aprendizaje: reglas en lenguaje natural que se le pasan a CUALQUIER modelo.
// No es reentrenar la IA: es conocimiento del equipo, versionado en el repo,
// que viaja en cada revisión. Si mañana cambian de modelo, lo aprendido sigue.

export function loadLearned(root: string): LearnedRule[] {
  return readMemoryFile(root).aprendido;
}

export function learnRule(root: string, regla: string, archivos?: string[]): LearnedRule {
  if (regla.trim().length < 10) {
    throw new GuardianError("Escribí la regla con un poco más de detalle (al menos 10 caracteres).");
  }
  const memory = readMemoryFile(root);
  const rule: LearnedRule = {
    regla: regla.trim(),
    ...(archivos && archivos.length > 0 ? { archivos } : {}),
    fecha: new Date().toISOString().slice(0, 10),
  };
  writeJson(root, MEMORY_PATH, { ...memory, aprendido: [...memory.aprendido, rule] });
  return rule;
}

/** Reglas aprendidas que aplican a este cambio (las generales + las de sus archivos). */
export function relevantLearned(rules: LearnedRule[], projectFiles: string[]): LearnedRule[] {
  return rules.filter((rule) => {
    if (!rule.archivos || rule.archivos.length === 0) return true;
    const matcher = ignore().add(rule.archivos);
    return projectFiles.some((file) => matcher.ignores(file));
  });
}

/** Borra la regla número `index` (empieza en 1, como se muestra en la lista). */
export function forgetRule(root: string, index: number): LearnedRule {
  const memory = readMemoryFile(root);
  const rule = memory.aprendido[index - 1];
  if (!rule) throw new GuardianError(`No existe la regla ${index}. Mirá la lista con: guardian aprender --lista`);
  writeJson(root, MEMORY_PATH, { ...memory, aprendido: memory.aprendido.filter((_, i) => i !== index - 1) });
  return rule;
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

  // La memoria se guarda en el proyecto revisado (en un monorepo, su subcarpeta).
  const memoryDir = join(root, last.project ?? "");
  const file = readMemoryFile(memoryDir);
  const memory = file.dismissed;
  if (memory.some((m) => m.id === id)) throw new GuardianError(`El hallazgo ${id} ya estaba descartado.`);

  const entry: MemoryEntry = {
    id,
    file: finding.file,
    category: finding.category,
    pattern: finding.explanation.split("\n")[0].slice(0, 300),
    reason: reason.trim(),
    date: new Date().toISOString().slice(0, 10),
  };
  writeJson(memoryDir, MEMORY_PATH, { ...file, dismissed: [...memory, entry] });
  return entry;
}
