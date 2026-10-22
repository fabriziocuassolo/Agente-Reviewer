import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
};

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
  };
}
