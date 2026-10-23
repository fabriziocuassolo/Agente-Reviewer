// Arma y publica el comentario de Guardian en el pull request.
// Lo usa .github/workflows/guardian.yml a través de actions/github-script.
//
// El reporte se lee desde un archivo (nunca se pega dentro del código del workflow):
// así un hallazgo con comillas, backticks o ${...} no puede romper ni inyectar nada.
const fs = require("node:fs");

const MARKER = "<!-- guardian-review -->";

const DECISION_ICON = { APROBADO: "✅", ADVERTENCIA: "⚠️", BLOQUEADO: "❌" };
const SEVERITY_ICON = { critico: "🔴", alto: "🟠", medio: "🟡", bajo: "⚪" };
const MAX_FINDINGS = 10;

/** Arma el cuerpo del comentario en markdown a partir del reporte JSON. */
function buildBody(report) {
  const lines = [MARKER, `## ${DECISION_ICON[report.decision] ?? ""} Guardian · ${report.decision}`, ""];
  const rule = report.gate.rule ? `Regla \`${report.gate.rule}\`: ` : "";
  lines.push(`${rule}${report.gate.reason}`, "");

  if (report.findings.length === 0) {
    lines.push("No se encontraron problemas.", "");
  } else {
    lines.push(`### Hallazgos (${report.findings.length})`, "");
    for (const f of report.findings.slice(0, MAX_FINDINGS)) {
      const where = f.file ? `\`${f.file}${f.line ? `:${f.line}` : ""}\`` : "(general)";
      lines.push(`${SEVERITY_ICON[f.severity] ?? ""} **${f.severity.toUpperCase()}** ${where} · ${f.category} · \`${f.id}\``);
      // La explicación puede traer varias líneas (salida de tests): va como cita.
      lines.push(...f.explanation.split("\n").map((l) => `> ${l}`));
      lines.push("", `**Sugerencia:** ${f.suggestion}`, "");
    }
    if (report.findings.length > MAX_FINDINGS) {
      lines.push(`_... y ${report.findings.length - MAX_FINDINGS} más. Corré \`guardian review\` localmente para verlos._`, "");
    }
  }

  if (report.warnings.length > 0) {
    lines.push(...report.warnings.map((w) => `> ⚠️ ${w}`), "");
  }

  const details = [`- Cambios: ${report.changes.description} (${report.changes.files.length} archivos)`];
  if (report.llm) {
    details.push(`- Modelo: ${report.llm.provider} · ${report.llm.model}`);
    details.push(`- Tokens: ${report.llm.inputTokens} de entrada / ${report.llm.outputTokens} de salida`);
    if (report.llm.skills.length > 0) details.push(`- Skills: ${report.llm.skills.join(", ")}`);
  }
  details.push(`- Tiempos: ${report.timings.map((t) => `${t.stage} ${t.ms} ms`).join(" · ")}`);
  lines.push("<details><summary>Detalles</summary>", "", ...details, "", "</details>");
  return lines.join("\n");
}

/** Publica el comentario; si ya existe uno de Guardian en el PR, lo actualiza en vez de duplicarlo. */
async function publish({ github, context, core, reportPath }) {
  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch {
    core.setFailed("Guardian no generó un reporte válido. Revisá la salida del paso anterior.");
    return;
  }
  const body = buildBody(report);

  const { owner, repo } = context.repo;
  const issue_number = context.issue.number;
  const comments = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number });
  const previous = comments.find((c) => c.body && c.body.includes(MARKER));

  if (previous) {
    await github.rest.issues.updateComment({ owner, repo, comment_id: previous.id, body });
  } else {
    await github.rest.issues.createComment({ owner, repo, issue_number, body });
  }

  if (report.decision === "BLOQUEADO") {
    core.setFailed("Guardian bloqueó este cambio: revisá los hallazgos críticos en el comentario del PR.");
  }
}

module.exports = { buildBody, publish };
