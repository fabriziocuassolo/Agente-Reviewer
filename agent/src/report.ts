import pc from "picocolors";
import type { CheckResult, Decision, Finding, ReviewReport, Severity, StageTiming } from "./types.js";

const SEVERITY_STYLE: Record<Severity, (s: string) => string> = {
  critico: (s) => pc.bgRed(pc.white(pc.bold(s))),
  alto: (s) => pc.red(pc.bold(s)),
  medio: (s) => pc.yellow(pc.bold(s)),
  bajo: (s) => pc.cyan(s),
};

const SEVERITY_LABEL: Record<Severity, string> = {
  critico: " CRÍTICO ",
  alto: "ALTO",
  medio: "MEDIO",
  bajo: "BAJO",
};

const DECISION_STYLE: Record<Decision, (s: string) => string> = {
  APROBADO: (s) => pc.bgGreen(pc.black(pc.bold(s))),
  ADVERTENCIA: (s) => pc.bgYellow(pc.black(pc.bold(s))),
  BLOQUEADO: (s) => pc.bgRed(pc.white(pc.bold(s))),
};

export function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Arma el reporte legible para la terminal. */
export function renderReport(report: ReviewReport): string {
  const out: string[] = [];
  out.push("", pc.bold("🛡  Guardian · revisión de cambios"));
  out.push(pc.dim(`Comparando: ${report.changes.description} (${report.changes.files.length} archivo/s)`), "");

  if (report.checks.length > 0) {
    out.push(pc.bold("Chequeos determinísticos"));
    for (const check of report.checks) out.push(renderCheck(check));
    out.push("");
  }

  if (report.findings.length > 0) {
    out.push(pc.bold(`Hallazgos (${report.findings.length})`));
    for (const finding of report.findings) out.push(...renderFinding(finding), "");
  } else if (report.changes.files.length > 0) {
    out.push(pc.green("Sin hallazgos."), "");
  }

  if (report.dismissed.length > 0) {
    const ids = report.dismissed.map((f) => f.id).join(", ");
    out.push(pc.dim(`${report.dismissed.length} hallazgo(s) ocultos porque el equipo ya los descartó (${ids}). Ver .guardian/memory.json`), "");
  }

  if (report.llm) out.push(pc.dim(renderLLM(report)), "");

  for (const warning of report.warnings) out.push(pc.yellow(`⚠ ${warning}`));
  if (report.warnings.length > 0) out.push("");

  out.push(`${pc.bold("Decisión:")} ${DECISION_STYLE[report.decision](` ${report.decision} `)}`);
  const rule = report.gate.rule ? `Regla "${report.gate.rule}": ` : "";
  out.push(pc.dim(`  ${rule}${report.gate.reason}`), "");

  out.push(pc.dim(renderTimings(report.timings)));
  if (report.findings.some((f) => f.source === "llm")) {
    out.push(pc.dim('¿Falso positivo? guardian dismiss <id> "<motivo>"'));
  }
  out.push("");
  return out.join("\n");
}

function renderCheck(check: CheckResult): string {
  const icon = { ok: pc.green("✔"), fallo: pc.red("✖"), omitido: pc.dim("–") }[check.status];
  const name = check.name.padEnd(20);
  if (check.status === "omitido") return `  ${icon} ${pc.dim(`${name} omitido: ${check.detail}`)}`;
  const command = check.detail ? pc.dim(` ${check.detail}`) : "";
  return `  ${icon} ${name}${pc.dim(formatMs(check.durationMs).padStart(8))}${command}`;
}

function renderFinding(f: Finding): string[] {
  const location = f.file ? pc.underline(f.line ? `${f.file}:${f.line}` : f.file) : pc.dim("(general)");
  const header = `  ${SEVERITY_STYLE[f.severity](SEVERITY_LABEL[f.severity])} ${location} ${pc.dim(`[${f.category}] ${f.id}`)}`;

  const [first, ...rest] = f.explanation.split("\n");
  const lines = [header, `    ${first}`];
  // Salida de comandos (lint/tests): se muestra atenuada e indentada.
  for (const extra of rest) lines.push(pc.dim(`      ${extra}`));
  lines.push(`    ${pc.green("→")} ${f.suggestion}`);
  return lines;
}

function renderLLM({ llm }: ReviewReport): string {
  if (!llm) return "";
  if (llm.failed) return `IA: ${llm.provider} · ${llm.model} · sin revisión (ver aviso)`;
  const lines = [
    `IA: ${llm.provider} · ${llm.model} · ${formatTokens(llm.inputTokens)} tokens de entrada / ${formatTokens(llm.outputTokens)} de salida` +
      (llm.attempts > 1 ? ` · ${llm.attempts} intentos` : ""),
  ];
  if (llm.skills.length > 0) lines.push(`Skills aplicadas: ${llm.skills.join(", ")}`);
  if (llm.exceptions > 0) lines.push(`Memoria: ${llm.exceptions} excepción(es) conocida(s) incluidas en el prompt`);
  if (llm.redactions > 0) lines.push(`Privacidad: ${llm.redactions} secreto(s) redactado(s) antes de enviar el código`);
  if (llm.omitted.length > 0) lines.push(`No enviados al modelo: ${llm.omitted.join(", ")}`);
  if (llm.recordedTo) lines.push(`Grabación guardada en: ${llm.recordedTo}`);
  return lines.join("\n");
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function renderTimings(timings: StageTiming[]): string {
  return "Tiempos: " + timings.map((t) => `${t.stage} ${formatMs(t.ms)}`).join(" · ");
}
