import type { GateRule } from "./config.js";
import { SEVERITIES, type Finding, type GateResult, type Severity } from "./types.js";

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts = { critico: 0, alto: 0, medio: 0, bajo: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

const LABELS: Record<Severity, [string, string]> = {
  critico: ["crítico", "críticos"],
  alto: ["alto", "altos"],
  medio: ["medio", "medios"],
  bajo: ["bajo", "bajos"],
};

/**
 * Gate de decisión. Es DETERMINÍSTICO a propósito: el LLM opina (hallazgos),
 * pero la decisión de bloquear la toman reglas fijas, auditables y configurables.
 *
 * Las reglas de BLOQUEADO se evalúan antes que las de ADVERTENCIA (gana la más estricta);
 * dentro de cada grupo se respeta el orden del config. La primera que se cumple decide.
 */
export function decide(findings: Finding[], rules: GateRule[]): GateResult {
  const counts = countBySeverity(findings);
  const ordered = [
    ...rules.filter((r) => r.decision === "BLOQUEADO"),
    ...rules.filter((r) => r.decision === "ADVERTENCIA"),
  ];

  for (const rule of ordered) {
    const count = counts[rule.severity];
    if (count >= rule.min) {
      const [singular, plural] = LABELS[rule.severity];
      return {
        decision: rule.decision,
        rule: rule.name,
        reason: `${count} hallazgo${count === 1 ? "" : "s"} ${count === 1 ? singular : plural} (la regla exige ${rule.min} o más)`,
      };
    }
  }

  return {
    decision: "APROBADO",
    rule: null,
    reason: findings.length === 0 ? "No se encontraron problemas" : "Solo hay hallazgos que no alcanzan ninguna regla",
  };
}

/** Ordena de más grave a menos grave. */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
}
