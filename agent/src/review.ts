import { resolveCommandChecks, runCommandChecks } from "./checks/commands.js";
import { findSecrets, secretFindings } from "./checks/secrets.js";
import { loadConfig } from "./config.js";
import { parseAddedLines } from "./diff.js";
import { decide, sortFindings } from "./gate.js";
import { collectChanges, getRepoRoot } from "./git.js";
import { StageTimer } from "./timer.js";
import { GuardianError, type CheckResult, type Finding, type ReviewReport } from "./types.js";

export interface ReviewOptions {
  cwd: string;
  /** Ref contra la cual comparar (por defecto se decide automáticamente). */
  base?: string;
}

/**
 * Pipeline de `guardian review`:
 * 1. Recolector        → diff y archivos modificados
 * 2. Chequeos fijos    → secretos, lint, tipos, tests (sin IA, siempre corren)
 * 3. Gate de decisión  → reglas determinísticas
 */
export async function runReview(options: ReviewOptions): Promise<ReviewReport> {
  const root = getRepoRoot(options.cwd);
  if (!root) throw new GuardianError("Este directorio no está dentro de un repositorio git.");

  const config = loadConfig(root);
  const timer = new StageTimer();
  const warnings: string[] = [];

  // 1. Recolector
  const changes = await timer.measure("Recolección", () => collectChanges(root, config.baseBranch, options.base));
  if (changes.files.length === 0) {
    return {
      decision: "APROBADO",
      gate: { decision: "APROBADO", rule: null, reason: "No hay cambios para revisar" },
      changes: { description: changes.description, files: [] },
      checks: [],
      findings: [],
      warnings,
      timings: [...timer.timings, timer.total()],
    };
  }

  // 2. Chequeos determinísticos
  const { checks, findings } = await timer.measure("Chequeos determinísticos", async () => {
    const secretsStart = Date.now();
    const secrets = findSecrets(parseAddedLines(changes.diff));
    const secretsCheck: CheckResult = {
      name: "Secretos",
      status: secrets.length > 0 ? "fallo" : "ok",
      durationMs: Date.now() - secretsStart,
    };

    const { checks: commands, skipped } = resolveCommandChecks(root, config);
    const commandRun = await runCommandChecks(root, commands, config.checks.timeoutMs);

    return {
      checks: [secretsCheck, ...commandRun.results, ...skipped],
      findings: [...secretFindings(secrets), ...commandRun.findings] as Finding[],
    };
  });

  // 3. Gate
  const gate = decide(findings, config.gate.rules);

  return {
    decision: gate.decision,
    gate,
    changes: { description: changes.description, files: changes.files },
    checks,
    findings: sortFindings(findings),
    warnings,
    timings: [...timer.timings, timer.total()],
  };
}
