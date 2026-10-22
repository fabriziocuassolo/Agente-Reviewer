import { resolveCommandChecks, runCommandChecks } from "./checks/commands.js";
import { findSecrets, secretFindings } from "./checks/secrets.js";
import { loadConfig } from "./config.js";
import { buildContext } from "./context.js";
import { parseAddedLines } from "./diff.js";
import { decide, sortFindings } from "./gate.js";
import { collectChanges, getRepoRoot } from "./git.js";
import { createProvider } from "./llm/provider.js";
import { RecordingProvider } from "./llm/replay.js";
import type { LLMProvider } from "./llm/types.js";
import { reviewWithLLM } from "./reviewer.js";
import { StageTimer } from "./timer.js";
import { GuardianError, type CheckResult, type Finding, type LLMUsage, type ReviewReport } from "./types.js";

export interface ReviewOptions {
  cwd: string;
  /** Ref contra la cual comparar (por defecto se decide automáticamente). */
  base?: string;
  /** false = no llamar al LLM (--no-llm). */
  llm?: boolean;
  /** Proveedor a usar; si no se pasa, se crea según LLM_PROVIDER. */
  provider?: LLMProvider | null;
  /** Grabar las respuestas del LLM para el modo replay (--record). */
  record?: boolean;
}

/**
 * Pipeline de `guardian review`:
 * 1. Recolector        → diff y archivos modificados
 * 2. Chequeos fijos    → secretos, lint, tipos, tests (sin IA, siempre corren)
 * 3. Contexto          → diff + archivos + imports + convenciones, con secretos redactados
 * 4. Agente revisor    → hallazgos del LLM validados con zod
 * 5. Gate de decisión  → reglas determinísticas
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
  const deterministic = await timer.measure("Chequeos", async () => {
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
  const findings = [...deterministic.findings];
  let llm: LLMUsage | undefined;
  let llmFailed = false;

  // 3 y 4. Revisión con IA (solo si tiene sentido gastarla)
  const hasCritical = findings.some((f) => f.severity === "critico");
  const { provider, reason } =
    options.provider !== undefined ? { provider: options.provider, reason: "proveedor no disponible" } : createProvider(process.env, { record: options.record });

  if (options.llm === false) {
    warnings.push("Revisión con IA desactivada (--no-llm).");
  } else if (hasCritical) {
    // Si ya está bloqueado, llamar al modelo es gastar tiempo y cuota: primero hay que arreglar esto.
    warnings.push("Se omitió la revisión con IA: los chequeos determinísticos ya encontraron fallos críticos.");
  } else if (!provider) {
    warnings.push(`Se omitió la revisión con IA: ${reason}.`);
  } else {
    const context = await timer.measure("Contexto", () => buildContext(root, changes, config.context.maxChars));
    const result = await timer.measure("Revisión IA", () => reviewWithLLM(provider, context));
    findings.push(...result.findings);
    warnings.push(...result.warnings);
    llmFailed = result.degraded;
    llm = {
      provider: provider.name,
      model: provider.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      attempts: result.attempts,
      failed: result.degraded,
      redactions: context.redactions,
      omitted: context.omitted,
      recordedTo: provider instanceof RecordingProvider ? (provider.savedTo ?? undefined) : undefined,
    };
  }

  // 5. Gate
  let gate = decide(findings, config.gate.rules);
  // Si la IA se intentó y falló, no aprobamos "a ciegas": como mucho ADVERTENCIA.
  // No bloquea (una caída de Google no debe frenar al equipo), pero tampoco da luz verde.
  if (llmFailed && gate.decision === "APROBADO") {
    gate = {
      decision: "ADVERTENCIA",
      rule: "ia-no-disponible",
      reason: "Los chequeos determinísticos pasaron, pero la revisión con IA no pudo completarse",
    };
  }

  return {
    decision: gate.decision,
    gate,
    changes: { description: changes.description, files: changes.files },
    checks: deterministic.checks,
    findings: sortFindings(findings),
    warnings,
    timings: [...timer.timings, timer.total()],
    llm,
  };
}
