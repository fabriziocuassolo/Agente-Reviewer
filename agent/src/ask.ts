import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { Ignore } from "ignore";
import { redactSecrets } from "./checks/secrets.js";
import { createIgnoreFilter } from "./context.js";
import { prepareProvider } from "./llm/provider.js";
import { LLMError, type LLMProvider } from "./llm/types.js";
import { GuardianError } from "./types.js";

/**
 * `guardian ask "<pregunta>"` → responde citando archivo:línea.
 * Versión simple sin base vectorial: árbol de carpetas + búsqueda por palabras
 * clave de la pregunta en el código y en docs/, y le pasa al modelo los archivos
 * más relevantes con un límite de tamaño.
 *
 * Mismas reglas de privacidad que `review`: respeta .guardianignore, nunca lee
 * .env* ni node_modules, y redacta secretos antes de enviar nada al modelo.
 */

const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".html", ".css", ".yaml", ".yml"]);
const MAX_FILE_SIZE = 100_000; // 100 KB
const MAX_CONTEXT_CHARS = 40_000; // ~10k tokens

// Palabras que no ayudan a encontrar archivos (artículos, preposiciones, palabras de pregunta).
const STOPWORDS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al", "en", "a", "con", "por", "para",
  "que", "qué", "es", "son", "se", "y", "o", "como", "cómo", "donde", "dónde", "cual", "cuál", "cuando",
  "cuándo", "hay", "esta", "está", "este", "esto",
]);

export interface AskOptions {
  cwd: string;
  provider?: LLMProvider | null;
  /** IA elegida desde la terminal (--use gemini|ollama). */
  use?: string;
  /** Modelo elegido desde la terminal (--model). */
  model?: string;
}

export interface AskResult {
  answer: string;
  /** Archivos que se le enviaron al modelo (para mostrarlos como fuentes). */
  sources: string[];
  inputTokens?: number;
  outputTokens?: number;
}

interface FileMatch {
  path: string;
  score: number;
  content: string;
}

/** Extrae palabras clave de la pregunta (sin artículos, preposiciones ni palabras de pregunta). */
export function extractKeywords(question: string): string[] {
  return question
    .toLowerCase()
    .replace(/[^\w\sáéíóúñ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Lee los archivos de texto del proyecto, respetando el filtro de privacidad. */
function readTree(root: string, filter: Ignore, relativePath = ""): FileMatch[] {
  const files: FileMatch[] = [];
  for (const entry of readdirSync(join(root, relativePath), { withFileTypes: true })) {
    const rel = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    if (entry.name === ".git" || entry.name === ".demo-work") continue;

    if (entry.isDirectory()) {
      if (!filter.ignores(`${rel}/`)) files.push(...readTree(root, filter, rel));
    } else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name)) && !filter.ignores(rel)) {
      const full = join(root, rel);
      if (statSync(full).size > MAX_FILE_SIZE) continue;
      files.push({ path: rel, score: 0, content: readFileSync(full, "utf8").replace(/\r\n/g, "\n") });
    }
  }
  return files;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Puntúa archivos según keywords: coincidencias en el nombre y en el contenido. */
export function scoreFiles(files: FileMatch[], keywords: string[]): FileMatch[] {
  for (const file of files) {
    let score = 0;
    const name = basename(file.path).toLowerCase();
    const content = file.content.toLowerCase();

    for (const kw of keywords) {
      if (name.includes(kw)) score += 10;
      const matches = content.match(new RegExp(escapeRegExp(kw), "g"))?.length ?? 0;
      score += Math.min(matches, 20); // máximo 20 puntos por keyword
    }
    // La documentación suele explicar el "por qué": tiene un pequeño bonus
    if (score > 0 && file.path.includes("docs/")) score += 5;
    file.score = score;
  }
  return files.filter((f) => f.score > 0).sort((a, b) => b.score - a.score);
}

/** Selecciona archivos por orden de relevancia hasta llenar maxChars (saltea los que no entran). */
export function selectFiles<T extends { content: string }>(ranked: T[], maxChars: number): T[] {
  const selected: T[] = [];
  let total = 0;
  for (const file of ranked) {
    if (total + file.content.length > maxChars) continue;
    selected.push(file);
    total += file.content.length;
  }
  return selected;
}

export function buildTreeView(paths: string[]): string {
  const tree: Record<string, Set<string>> = {};
  for (const path of paths) {
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const dir = parts.slice(0, i - 1).join("/") || ".";
      tree[dir] = tree[dir] || new Set();
      tree[dir].add(parts[i - 1]);
    }
  }
  const lines: string[] = [];
  const walk = (dir: string, indent: string) => {
    for (const child of Array.from(tree[dir] || []).sort()) {
      const childPath = dir === "." ? child : `${dir}/${child}`;
      const isDir = Boolean(tree[childPath]);
      lines.push(`${indent}${isDir ? "📁" : "📄"} ${child}`);
      if (isDir) walk(childPath, indent + "  ");
    }
  };
  walk(".", "");
  return lines.join("\n");
}

function addLineNumbers(content: string): string {
  return content
    .split("\n")
    .map((line, i) => `${String(i + 1).padStart(4)} | ${line}`)
    .join("\n");
}

const SYSTEM_PROMPT = `Sos un desarrollador senior que ayuda a un compañero a entender un proyecto de código.
Respondé la pregunta usando SOLO el código y la documentación que se te pasan.
Citá siempre archivo y línea cuando menciones código, con el formato ruta/archivo.ts:42.
Si con lo que tenés no alcanza para responder, decilo y sugerí dónde buscar.
Respondé en español, en texto plano (sin JSON), breve y directo: primero la respuesta, después el detalle.`;

export async function ask(question: string, options: AskOptions): Promise<AskResult> {
  if (!question.trim()) throw new GuardianError("Escribí una pregunta.");

  const { provider, reason } =
    options.provider !== undefined
      ? { provider: options.provider, reason: "proveedor no disponible" }
      : await prepareProvider(process.env, { use: options.use, model: options.model });
  if (!provider) {
    throw new GuardianError(`Para responder preguntas hace falta una IA.\n${reason}`);
  }
  if (provider.name === "replay") {
    throw new GuardianError(
      "`ask` necesita una IA real (replay solo reproduce las revisiones de la demo). Elegí una:\n" +
        `  guardian ask "${question}" --use gemini   ← en la nube, la más precisa (necesita key gratuita)\n` +
        `  guardian ask "${question}" --use ollama   ← local y privada (necesita Ollama instalado)`,
    );
  }

  const keywords = extractKeywords(question);
  if (keywords.length === 0) throw new GuardianError("La pregunta es demasiado corta o genérica.");

  // Se busca desde la carpeta actual: en un monorepo, preguntar desde storefront-demo/
  // no debería mandar al modelo el README de la raíz ni otros paquetes.
  const root = options.cwd;
  const allFiles = readTree(root, createIgnoreFilter(root));
  const ranked = scoreFiles(allFiles, keywords);
  if (ranked.length === 0) {
    return { answer: "No encontré archivos relacionados con la pregunta. Probá con otras palabras clave.", sources: [] };
  }

  const selected = selectFiles(ranked, MAX_CONTEXT_CHARS);
  const files = selected.map((f) => `## ${f.path}\n\`\`\`\n${addLineNumbers(f.content)}\n\`\`\``).join("\n\n");
  const prompt = redactSecrets(
    `# Pregunta\n\n${question}\n\n# Estructura del proyecto\n\n${buildTreeView(allFiles.map((f) => f.path))}\n\n# Archivos relevantes\n\n${files}` +
      // Se repite al final: los modelos locales chicos "pierden" la pregunta si queda solo al principio.
      `\n\n# Recordá: respondé en español esta pregunta, citando archivo:línea\n\n${question}`,
  ).text;

  try {
    const response = await provider.complete({ system: SYSTEM_PROMPT, prompt, json: false });
    return {
      answer: response.text.trim(),
      sources: selected.map((f) => f.path),
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    };
  } catch (error) {
    if (error instanceof LLMError) throw new GuardianError(`No se pudo responder: ${error.message}`);
    throw error;
  }
}
