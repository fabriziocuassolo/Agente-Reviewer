import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { GuardianError, SEVERITIES } from "./types.js";

export const CONFIG_PATH = ".guardian/config.json";

const ruleSchema = z.object({
  name: z.string().min(1),
  severity: z.enum(SEVERITIES),
  /** Cantidad mínima de hallazgos de esa severidad para que la regla se dispare. */
  min: z.number().int().min(1),
  decision: z.enum(["BLOQUEADO", "ADVERTENCIA"]),
});
export type GateRule = z.infer<typeof ruleSchema>;

/**
 * Comando de cada chequeo:
 * - string    → se ejecuta ese comando
 * - null      → chequeo desactivado
 * - undefined → se autodetecta desde package.json / tsconfig.json
 */
const commandSchema = z.string().min(1).nullable().optional();

/** Regla fija del equipo: un patrón que se detecta SIEMPRE, sin IA y con cualquier modelo. */
const customRuleSchema = z.object({
  nombre: z.string().min(1),
  /** Expresión regular que se busca en las líneas agregadas (sin distinguir mayúsculas). */
  buscar: z.string().min(1).refine((pattern) => {
    try {
      new RegExp(pattern);
      return true;
    } catch {
      return false;
    }
  }, "no es una expresión regular válida"),
  /** Patrones de archivos donde aplica (sintaxis .gitignore). Si no se pone, aplica a todos. */
  archivos: z.array(z.string().min(1)).optional(),
  severidad: z.enum(SEVERITIES).default("alto"),
  mensaje: z.string().min(1),
  sugerencia: z.string().min(1).optional(),
});
export type CustomRule = z.infer<typeof customRuleSchema>;

// Lo que el usuario puede escribir en .guardian/config.json (todo opcional).
const userConfigSchema = z.object({
  baseBranch: z.string().min(1).optional(),
  checks: z
    .object({
      lint: commandSchema,
      typecheck: commandSchema,
      test: commandSchema,
      timeoutMs: z.number().int().positive().optional(),
    })
    .optional(),
  gate: z.object({ rules: z.array(ruleSchema).min(1).optional() }).optional(),
  context: z.object({ maxChars: z.number().int().min(1000).optional() }).optional(),
  /** Skill → patrones de archivos (sintaxis .gitignore) que la activan. */
  skills: z.record(z.string(), z.array(z.string().min(1)).min(1)).optional(),
  /** Reglas fijas del equipo (se detectan siempre, sin IA). */
  reglas: z.array(customRuleSchema).optional(),
  ia: z
    .object({
      /** true = si los chequeos fijos ya encontraron algo crítico, no se llama a la IA (ahorra costo). */
      saltearSiHayCriticos: z.boolean().optional(),
    })
    .optional(),
});

export interface GuardianConfig {
  baseBranch: string;
  checks: {
    lint?: string | null;
    typecheck?: string | null;
    test?: string | null;
    timeoutMs: number;
  };
  gate: { rules: GateRule[] };
  /** Tope de caracteres enviados al LLM (~4 caracteres por token). Controla costo y latencia. */
  context: { maxChars: number };
  /** Si no se define, se cargan todas las skills de .guardian/skills. */
  skills?: Record<string, string[]>;
  /** Reglas fijas del equipo. */
  rules: CustomRule[];
  /** Por defecto la IA revisa siempre (reporta TODOS los problemas); true = ahorrar si ya hay un crítico. */
  skipAiOnCritical: boolean;
}

// Reglas por defecto del gate, tal como pide la consigna.
export const DEFAULT_RULES: GateRule[] = [
  { name: "critico-bloquea", severity: "critico", min: 1, decision: "BLOQUEADO" },
  { name: "muchos-altos-bloquean", severity: "alto", min: 3, decision: "BLOQUEADO" },
  { name: "alto-advierte", severity: "alto", min: 1, decision: "ADVERTENCIA" },
  { name: "medio-advierte", severity: "medio", min: 1, decision: "ADVERTENCIA" },
];

export const DEFAULT_CONFIG: GuardianConfig = {
  baseBranch: "main",
  checks: { timeoutMs: 180_000 },
  gate: { rules: DEFAULT_RULES },
  context: { maxChars: 80_000 },
  rules: [],
  skipAiOnCritical: false,
};

/**
 * Agrega una regla fija a .guardian/config.json (la crea si no existe), conservando el resto.
 * La usa `guardian aprender "mensaje" --patron "..."`.
 */
export function addFixedRule(
  projectDir: string,
  input: { mensaje: string; buscar: string; archivos?: string[]; severidad?: string },
): CustomRule {
  const path = join(projectDir, CONFIG_PATH);
  const current: Record<string, unknown> = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const existing = Array.isArray(current.reglas) ? (current.reglas as CustomRule[]) : [];

  const slug = input.mensaje
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const parsed = customRuleSchema.safeParse({
    nombre: `${slug || "regla"}-${existing.length + 1}`,
    buscar: input.buscar,
    ...(input.archivos && input.archivos.length > 0 ? { archivos: input.archivos } : {}),
    severidad: input.severidad ?? "alto",
    mensaje: input.mensaje,
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new GuardianError(`La regla fija no es válida: ${problems}`);
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ ...current, reglas: [...existing, parsed.data] }, null, 2) + "\n");
  return parsed.data;
}

/** Lee .guardian/config.json del repo (si existe) y lo combina con los valores por defecto. */
export function loadConfig(repoRoot: string): GuardianConfig {
  const path = join(repoRoot, CONFIG_PATH);
  if (!existsSync(path)) return DEFAULT_CONFIG;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new GuardianError(`${CONFIG_PATH} no es un JSON válido: ${(error as Error).message}`);
  }

  const parsed = userConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new GuardianError(`${CONFIG_PATH} tiene errores:\n${problems}`);
  }

  const user = parsed.data;
  return {
    baseBranch: user.baseBranch ?? DEFAULT_CONFIG.baseBranch,
    checks: { ...DEFAULT_CONFIG.checks, ...user.checks },
    gate: { rules: user.gate?.rules ?? DEFAULT_RULES },
    context: { maxChars: user.context?.maxChars ?? DEFAULT_CONFIG.context.maxChars },
    skills: user.skills,
    rules: user.reglas ?? [],
    skipAiOnCritical: user.ia?.saltearSiHayCriticos ?? false,
  };
}
