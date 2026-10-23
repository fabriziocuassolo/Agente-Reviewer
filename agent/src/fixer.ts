import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pc from "picocolors";
import { git } from "./git.js";
import type { LLMProvider } from "./llm/types.js";
import type { Finding, ReviewReport } from "./types.js";

/**
 * Corrección automática:
 * 1. Se guarda una FOTO (snapshot) de cada archivo antes de tocarlo.
 * 2. La IA reescribe cada archivo corrigiendo SOLO los hallazgos de ese archivo.
 * 3. Se vuelve a revisar (validación: ¿bajaron los problemas? ¿siguen pasando los tests?).
 * 4. La persona decide: commit + push, dejar los cambios, o ROLLBACK (todo vuelve a como estaba).
 */

export interface FileFix {
  file: string;
  before: string;
  after: string;
  findings: Finding[];
}

/** Hallazgos que la IA puede intentar corregir: los que señalan un archivo (no "fallan los tests" en general). */
export function fixableFindings(report: ReviewReport): Finding[] {
  return report.findings.filter((f) => f.file && (f.source === "llm" || f.category === "secretos" || f.category.startsWith("regla")));
}

const FIX_SYSTEM = `Sos un desarrollador senior. Te paso un archivo y una lista de problemas encontrados en una revisión.
Corregí SOLO esos problemas, con el cambio mínimo. No cambies nada más: ni formato, ni nombres, ni comentarios, ni orden.
Respetá las convenciones del proyecto si te las paso.
Para claves o contraseñas escritas en el código: en el backend, reemplazalas por process.env.NOMBRE_EN_MAYUSCULAS;
en el frontend (navegador), eliminalas y dejá un comentario // TODO explicando que no pueden ir en el frontend.
Devolvé el archivo COMPLETO corregido, dentro de un único bloque de código \`\`\` y sin ningún texto antes ni después.`;

export async function proposeFixes(
  provider: LLMProvider,
  root: string,
  report: ReviewReport,
  conventions: string | null,
  onProgress: (text: string) => void = () => {},
): Promise<{ fixes: FileFix[]; skipped: string[] }> {
  const byFile = new Map<string, Finding[]>();
  for (const finding of fixableFindings(report)) {
    byFile.set(finding.file!, [...(byFile.get(finding.file!) ?? []), finding]);
  }

  const fixes: FileFix[] = [];
  const skipped: string[] = [];
  for (const [file, findings] of byFile) {
    const path = join(root, file);
    if (!existsSync(path)) {
      skipped.push(`${file} (no existe)`);
      continue;
    }
    onProgress(`Corrigiendo ${file} (${findings.length} problema/s)…`);
    const before = readFileSync(path, "utf8");
    const problems = findings
      .map((f, i) => `${i + 1}. Línea ${f.line ?? "?"} [${f.severity}] ${f.explanation.split("\n")[0]}\n   Sugerencia: ${f.suggestion}`)
      .join("\n");
    // Los modelos chicos suelen "arreglar" una clave del frontend con process.env, que en el navegador no existe.
    const browser = /\.(html?|css)$/i.test(file) || /(^|\/)(public|static|www)\//.test(file)
      ? "\nIMPORTANTE: este archivo corre en el NAVEGADOR. Ahí NO existe process.env: una clave o contraseña no puede " +
        "estar en este archivo de ninguna forma; borrala y dejá un comentario TODO. Los montos de dinero se calculan en el servidor.\n"
      : "";
    const prompt =
      (conventions ? `## Convenciones del proyecto\n\n${conventions}\n\n` : "") +
      `## Problemas a corregir en ${file}\n${browser}\n${problems}\n\n## Archivo ${file}\n\n\`\`\`\n${before}\n\`\`\``;

    try {
      const response = await provider.complete({ system: FIX_SYSTEM, prompt, json: false });
      const after = extractCode(response.text, before);
      if (!after) {
        skipped.push(`${file} (la IA no devolvió un archivo válido)`);
      } else if (after === before) {
        skipped.push(`${file} (la IA no propuso cambios)`);
      } else {
        fixes.push({ file, before, after, findings });
      }
    } catch (error) {
      skipped.push(`${file} (${(error as Error).message})`);
    }
  }
  return { fixes, skipped };
}

/** Saca el archivo del bloque de código y descarta respuestas sospechosas (vacías o recortadas). */
export function extractCode(text: string, original: string): string | null {
  const block = /```[\w-]*\r?\n([\s\S]*?)```/.exec(text);
  let code = (block ? block[1] : text).replace(/\r\n/g, "\n");
  // Se respeta si el original terminaba (o no) con salto de línea.
  code = code.replace(/\n+$/, "") + (original.endsWith("\n") ? "\n" : "");
  // Si quedó mucho más corto que el original, la IA probablemente devolvió solo un pedazo.
  if (code.trim().length === 0 || code.length < original.length * 0.5) return null;
  return code;
}

export function applyFixes(root: string, fixes: FileFix[]): void {
  for (const fix of fixes) writeFileSync(join(root, fix.file), fix.after);
}

/** Rollback: cada archivo vuelve EXACTAMENTE a como estaba antes de la corrección automática. */
export function rollbackFixes(root: string, fixes: FileFix[]): void {
  for (const fix of fixes) writeFileSync(join(root, fix.file), fix.before);
}

/** Diff legible (con colores) de lo que cambió la corrección automática. */
export function renderFixDiff(fixes: FileFix[], maxLines = 120): string {
  const dir = mkdtempSync(join(tmpdir(), "guardian-fix-"));
  const out: string[] = [];
  try {
    for (const [i, fix] of fixes.entries()) {
      const a = join(dir, `${i}-antes`);
      const b = join(dir, `${i}-despues`);
      writeFileSync(a, fix.before);
      writeFileSync(b, fix.after);
      const result = spawnSync("git", ["diff", "--no-index", "--no-color", "-U2", a, b], { encoding: "utf8" });
      const body = result.stdout.split("\n").filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l));
      out.push(pc.bold(`\n📝 ${fix.file}`) + pc.dim(`  (${fix.findings.length} problema/s)`));
      for (const line of body.slice(0, maxLines)) {
        out.push(line.startsWith("+") ? pc.green(line) : line.startsWith("-") ? pc.red(line) : line.startsWith("@@") ? pc.cyan(line) : pc.dim(line));
      }
      if (body.length > maxLines) out.push(pc.dim(`  … ${body.length - maxLines} líneas más`));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return out.join("\n");
}

/**
 * Commit + push de los cambios revisados más las correcciones.
 * Solo agrega los archivos del cambio revisado y los corregidos (nunca un `git add -A` a ciegas).
 */
export function commitAndPush(root: string, report: ReviewReport, fixes: FileFix[]): { committed: boolean; pushed: boolean; detail: string } {
  const files = [...new Set([...report.changes.files, ...fixes.map((f) => f.file)])];
  git(["add", "--", ...files], root);

  const lines = fixes.flatMap((f) => f.findings.map((x) => `- ${f.file}:${x.line ?? "?"} ${x.category}: ${x.explanation.split("\n")[0].slice(0, 90)}`));
  const message = `Correcciones automáticas de Guardian\n\n${lines.join("\n")}\n`;
  try {
    execFileSync("git", ["commit", "-q", "-F", "-"], { cwd: root, input: message, stdio: ["pipe", "pipe", "pipe"] });
  } catch (error) {
    return { committed: false, pushed: false, detail: `No se pudo hacer el commit: ${(error as Error).message.split("\n")[0]}` };
  }

  const hasUpstream = spawnSync("git", ["rev-parse", "--abbrev-ref", "@{upstream}"], { cwd: root }).status === 0;
  const hasOrigin = spawnSync("git", ["remote", "get-url", "origin"], { cwd: root }).status === 0;
  if (!hasUpstream && !hasOrigin) return { committed: true, pushed: false, detail: "Quedó commiteado; el repo no tiene un remoto para hacer push." };

  // GUARDIAN_SKIP_HOOK evita que el hook pre-push vuelva a revisar lo que se acaba de revisar.
  const push = spawnSync("git", hasUpstream ? ["push"] : ["push", "-u", "origin", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GUARDIAN_SKIP_HOOK: "1" },
  });
  if (push.status !== 0) {
    return { committed: true, pushed: false, detail: `Quedó commiteado, pero el push falló:\n${(push.stderr || push.stdout).trim()}` };
  }
  return { committed: true, pushed: true, detail: (push.stderr || push.stdout).trim() };
}
