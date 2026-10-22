import type { AddedLine } from "../diff.js";
import { makeFindingId, type Finding } from "../types.js";

/**
 * Detector de secretos simple basado en expresiones regulares.
 * Solo mira las líneas agregadas en el diff. No reemplaza a herramientas
 * dedicadas (gitleaks, trufflehog) pero cubre los casos más comunes sin dependencias.
 */
const PATTERNS: { name: string; regex: RegExp }[] = [
  { name: "API key de Google", regex: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "Access key de AWS", regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "Clave secreta de Stripe", regex: /\b[sr]k_(?:live|test)_[0-9A-Za-z]{16,}\b/ },
  { name: "Token de GitHub", regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "Token de Slack", regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Clave privada", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  // Genérico: un nombre sospechoso (apiKey, password, token, secret...) asignado
  // con = o : a un string literal de 8 o más caracteres sin espacios.
  {
    name: "Credencial hardcodeada",
    regex: /(?:api[_-]?key|apikey|secret|token|passw(?:or)?d|pwd)\w*["']?\s*[:=]\s*["'`]([^"'`\s]{8,})["'`]/i,
  },
];

// Valores que claramente son de ejemplo y no deben bloquear.
const PLACEHOLDER = /^(?:x{4,}|\*{4,}|your[_-]|example|changeme|placeholder|<.*>|\$\{)/i;

export interface SecretMatch {
  file: string;
  line: number;
  kind: string;
  /** Valor detectado; se usa después para redactarlo antes de enviar código al LLM. */
  value: string;
}

export function findSecrets(addedLines: Map<string, AddedLine[]>): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const [file, lines] of addedLines) {
    for (const { line, text } of lines) {
      for (const pattern of PATTERNS) {
        const match = pattern.regex.exec(text);
        if (!match) continue;
        const value = match[1] ?? match[0];
        if (PLACEHOLDER.test(value)) continue;
        matches.push({ file, line, kind: pattern.name, value });
        break; // un hallazgo por línea alcanza
      }
    }
  }
  return matches;
}

export const REDACTED = "[SECRETO REDACTADO]";

/**
 * Reemplaza en un texto todo lo que parezca un secreto, antes de enviarlo al LLM.
 * Se aplica a TODO el contexto (no solo a las líneas nuevas): un archivo viejo
 * también puede tener una key que no queremos mandar a un tercero.
 */
export function redactSecrets(text: string): { text: string; count: number } {
  let count = 0;
  let result = text;
  for (const pattern of PATTERNS) {
    const global = new RegExp(pattern.regex.source, pattern.regex.flags + "g");
    result = result.replace(global, (match: string, group?: string) => {
      const value = typeof group === "string" ? group : match;
      if (PLACEHOLDER.test(value)) return match;
      count++;
      return match.replace(value, REDACTED);
    });
  }
  return { text: result, count };
}

/** Muestra solo el principio del secreto para que el reporte no lo vuelva a filtrar. */
export function maskSecret(value: string): string {
  return `${value.slice(0, 4)}… (${value.length} caracteres)`;
}

export function secretFindings(matches: SecretMatch[]): Finding[] {
  return matches.map((m) => ({
    id: makeFindingId("secreto", m.file, m.kind, m.value),
    file: m.file,
    line: m.line,
    severity: "critico",
    category: "secretos",
    explanation: `${m.kind} escrita en el código: ${maskSecret(m.value)}. Cualquiera con acceso al repo (o a su historial) puede usarla.`,
    suggestion:
      "Mové el valor a una variable de entorno (process.env) y agregala a .env.example sin el valor real. " +
      "Si ya se pusheó, considerá la clave comprometida y rotala.",
    source: "deterministico",
  }));
}
