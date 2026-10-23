import ignore from "ignore";
import type { CustomRule } from "../config.js";
import type { AddedLine } from "../diff.js";
import { belongsTo, inProject, type Project } from "../project.js";
import { makeFindingId, type Finding } from "../types.js";

/**
 * Reglas fijas del equipo (config.json → "reglas").
 * Se buscan en las líneas AGREGADAS del cambio. No usan IA: se detectan siempre,
 * igual con Gemini, con un modelo local chico o con --no-llm.
 * Sirven para lo que NO se puede escapar nunca (ej: innerHTML, console.log, una URL interna).
 */
export function customRuleFindings(
  addedLines: Map<string, AddedLine[]>,
  rules: CustomRule[],
  project: Project,
): Finding[] {
  const findings: Finding[] = [];
  for (const rule of rules) {
    const regex = new RegExp(rule.buscar, "i");
    const appliesTo = rule.archivos ? ignore().add(rule.archivos) : null;

    for (const [file, lines] of addedLines) {
      if (!belongsTo(project, file)) continue;
      if (appliesTo && !appliesTo.ignores(inProject(project, file))) continue;
      for (const { line, text } of lines) {
        if (!regex.test(text)) continue;
        findings.push({
          id: makeFindingId("regla", rule.nombre, file, text.trim()),
          file,
          line,
          severity: rule.severidad,
          category: `regla: ${rule.nombre}`,
          explanation: rule.mensaje,
          suggestion: rule.sugerencia ?? "Revisá la regla del equipo en .guardian/config.json.",
          source: "deterministico",
        });
      }
    }
  }
  return findings;
}
