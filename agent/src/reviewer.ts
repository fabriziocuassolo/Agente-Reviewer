import { z } from "zod";
import type { ReviewContext } from "./context.js";
import type { MemoryEntry } from "./memory.js";
import type { Skill } from "./skills.js";
import { LLMError, type LLMProvider } from "./llm/types.js";
import { makeFindingId, SEVERITIES, type Finding } from "./types.js";

// ---------- Esquema de la respuesta del modelo ----------

const llmFindingSchema = z.object({
  file: z.string().min(1).nullable(),
  // Algunos modelos devuelven la línea como string: se acepta "12" y se convierte a 12.
  line: z.union([z.null(), z.coerce.number().int().positive()]),
  severity: z.enum(SEVERITIES),
  category: z.string().min(1),
  explanation: z.string().min(1),
  suggestion: z.string().min(1),
});

const responseSchema = z.object({ findings: z.array(llmFindingSchema) });

// ---------- Prompt ----------

const SYSTEM_PROMPT = `Sos un revisor de código senior en un equipo que mantiene tiendas online (e-commerce).
Tu trabajo es revisar UN cambio (diff) y reportar problemas reales, con feedback concreto y accionable.

Reglas:
- Reportá SOLO problemas introducidos o tocados por el diff. El código que no cambió es contexto.
- Usá las convenciones del proyecto como criterio obligatorio; si el cambio viola una, decí cuál.
- Citá el archivo y la línea del archivo NUEVO (los números que aparecen a la izquierda en "Archivos").
- No reportes formato o estilo que resuelve un linter. No inventes problemas: si no hay, devolvé una lista vacía.
- Máximo 10 hallazgos, los más importantes primero. Escribí en español rioplatense, claro y directo.
- La sugerencia debe decir QUÉ cambiar, idealmente con el código corregido en una línea.

Severidades:
- "critico": rompe dinero, seguridad o datos en producción (precio o total mal calculado, descuento duplicado,
  XSS, inyección, secretos expuestos, vender sin stock, pérdida de datos).
- "alto": bug probable o violación clara de una convención obligatoria.
- "medio": riesgo moderado: falta validación, manejo de errores o tests para lógica de negocio.
- "bajo": mejora menor de legibilidad o mantenibilidad.

Respondé SOLO con JSON, sin texto adicional, con este formato exacto:
{"findings":[{"file":"src/ruta.ts","line":42,"severity":"alto","category":"precios","explanation":"...","suggestion":"..."}]}`;

/** Conocimiento extra del equipo: skills aplicables y falsos positivos ya descartados. */
export interface ReviewGuidance {
  skills: Skill[];
  exceptions: MemoryEntry[];
}

const NO_GUIDANCE: ReviewGuidance = { skills: [], exceptions: [] };

export function buildPrompt(context: ReviewContext, guidance: ReviewGuidance = NO_GUIDANCE): string {
  const parts: string[] = [];
  if (context.conventions) parts.push(`## Convenciones del proyecto\n\n${context.conventions}`);
  for (const skill of guidance.skills) {
    parts.push(`## Criterios de revisión: ${skill.name}\n(aplica a: ${skill.matchedFiles.join(", ")})\n\n${skill.content}`);
  }
  if (guidance.exceptions.length > 0) {
    const list = guidance.exceptions
      .map((e) => `- [${e.category}] ${e.file ?? "(general)"}: "${e.pattern}" → descartado por el equipo: ${e.reason}`)
      .join("\n");
    parts.push(
      "## Excepciones conocidas\nEl equipo ya marcó estos hallazgos como falsos positivos. " +
        `NO los vuelvas a reportar, aunque los redactes distinto:\n${list}`,
    );
  }
  parts.push(`## Diff a revisar\n\n\`\`\`diff\n${context.diff}\n\`\`\``);
  for (const file of context.files) {
    parts.push(`## Archivo (${file.reason}): ${file.path}\n\n\`\`\`\n${file.content}\n\`\`\``);
  }
  parts.push(
    `## Archivos modificados (los únicos que podés citar)\n\n${context.changedFiles.map((f) => `- ${f}`).join("\n")}`,
  );
  return parts.join("\n\n");
}

// ---------- Revisión ----------

export interface ReviewerResult {
  findings: Finding[];
  warnings: string[];
  inputTokens: number;
  outputTokens: number;
  attempts: number;
  /** true si la IA no pudo revisar (error del proveedor o respuesta inválida). */
  degraded: boolean;
}

/**
 * Llama al modelo y valida su respuesta con zod.
 * - JSON inválido → se reintenta UNA vez, diciéndole al modelo qué estuvo mal.
 * - Si vuelve a fallar (o el proveedor falla) → se degrada: sin hallazgos de IA y con un aviso claro.
 *   La revisión nunca se cae por culpa del LLM.
 */
export async function reviewWithLLM(
  provider: LLMProvider,
  context: ReviewContext,
  guidance: ReviewGuidance = NO_GUIDANCE,
): Promise<ReviewerResult> {
  const result: ReviewerResult = { findings: [], warnings: [], inputTokens: 0, outputTokens: 0, attempts: 0, degraded: false };
  let prompt = buildPrompt(context, guidance);

  for (let attempt = 1; attempt <= 2; attempt++) {
    result.attempts = attempt;
    let text: string;
    try {
      const response = await provider.complete({ system: SYSTEM_PROMPT, prompt });
      text = response.text;
      if (response.notice) result.warnings.push(response.notice);
      result.inputTokens += response.inputTokens ?? 0;
      result.outputTokens += response.outputTokens ?? 0;
    } catch (error) {
      const message = (error instanceof LLMError ? error.message : String(error)).replace(/\.+$/, "");
      result.warnings.push(`Revisión con IA no disponible: ${message}.`);
      result.degraded = true;
      return result;
    }

    const parsed = parseResponse(text);
    if (parsed.ok) {
      const { findings, discarded } = toFindings(parsed.data, context.changedFiles);
      result.findings = findings;
      if (discarded > 0) {
        result.warnings.push(`Se descartaron ${discarded} hallazgo(s) de la IA que citaban archivos fuera del cambio.`);
      }
      return result;
    }

    // Reintento: le devolvemos el error de validación para que se corrija.
    prompt = `${buildPrompt(context, guidance)}\n\n## Atención\nTu respuesta anterior no cumplía el formato (${parsed.error}). Respondé SOLO el JSON pedido.`;
  }

  result.warnings.push("La IA devolvió una respuesta inválida dos veces.");
  result.degraded = true;
  return result;
}

export function parseResponse(text: string): { ok: true; data: z.infer<typeof responseSchema> } | { ok: false; error: string } {
  // Algunos modelos envuelven el JSON en ```json ... ``` aunque se les pida que no.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    return { ok: false, error: "no es JSON válido" };
  }
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue.path.join(".") || "raíz"}: ${issue.message}` };
  }
  return { ok: true, data: parsed.data };
}

/** Convierte la respuesta en Findings y descarta los que apuntan a archivos que no cambiaron. */
function toFindings(data: z.infer<typeof responseSchema>, changedFiles: string[]) {
  const normalize = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^[ab]\//, "");
  const changed = new Set(changedFiles.map(normalize));

  const findings: Finding[] = [];
  let discarded = 0;
  for (const f of data.findings) {
    const file = f.file ? normalize(f.file) : null;
    if (file && !changed.has(file)) {
      discarded++;
      continue;
    }
    findings.push({
      // El ID lo generamos nosotros (no el modelo) para que sea estable y único.
      id: makeFindingId("llm", file, f.category.toLowerCase(), f.explanation.slice(0, 120)),
      file,
      line: f.line,
      severity: f.severity,
      category: f.category.toLowerCase(),
      explanation: f.explanation,
      suggestion: f.suggestion,
      source: "llm",
    });
  }
  return { findings, discarded };
}
