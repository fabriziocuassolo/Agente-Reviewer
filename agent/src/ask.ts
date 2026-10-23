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
  /** Preguntas y respuestas anteriores (modo chat): permiten repreguntar "¿y eso dónde se usa?". */
  history?: ChatTurn[];
}

export interface ChatTurn {
  question: string;
  answer: string;
}

// Cuántos intercambios anteriores se le recuerdan al modelo (más = más contexto, pero más tokens).
const HISTORY_TURNS = 4;
const HISTORY_ANSWER_CHARS = 1500;

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
Si hay una "Búsqueda exacta", usala para decir dónde está o dónde se usa algo: no menciones ubicaciones que no aparezcan ahí ni en los archivos.
Citá siempre archivo y línea cuando menciones código, con el formato ruta/archivo.ts:42.
Si con lo que tenés no alcanza para responder, decilo y sugerí dónde buscar.
Respondé en español, en texto plano (sin JSON), breve y directo: primero la respuesta, después el detalle.`;

/** ¿La pregunta se refiere a lo anterior? ("¿y eso?", "¿dónde se usa esa función?") */
export function isFollowUp(question: string, keywords: string[]): boolean {
  return keywords.length < 2 || /\b(eso|esa|ese|esto|esta|este|esos|esas|ah[ií]|lo mismo|la misma|el mismo|anterior)\b/i.test(question);
}

/** Nombres de código escritos en la pregunta: camelCase (calculateShipping) o entre `backticks`. */
export function codeNamesInQuestion(question: string): string[] {
  const names = new Set<string>();
  const pattern = /`([^`]{3,})`|\b([a-z]+[A-Z][A-Za-z0-9]*)\b/g;
  for (const match of question.matchAll(pattern)) names.add((match[1] ?? match[2]).toLowerCase());
  return [...names].slice(0, 6);
}

/**
 * Nombres de FUNCIONES de una respuesta (camelCase que empieza en minúscula, ej: calculateShipping).
 * Son el tema típico de una repregunta; las constantes (SHIPPING_COST_CENTS) solo meterían ruido.
 */
export function functionNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/`([a-z][a-z0-9]*[A-Z][A-Za-z0-9]*)(?:())?`/g)) names.add(match[1].toLowerCase());
  return [...names].slice(0, 2);
}

/** Nombres de código mencionados entre `backticks` (funciones, constantes), sin rutas de archivo. */
export function codeNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/`([A-Za-z_][\w.]{2,})(?:\(\))?`/g)) {
    const name = match[1];
    if (/\.(ts|js|md|json|html|css)$/i.test(name)) continue; // es un archivo, no un nombre de código
    names.add(name.split(".").pop()!.toLowerCase());
  }
  return [...names].slice(0, 6);
}

/**
 * Búsqueda exacta (sin IA) de dónde aparece cada nombre de código: le da al modelo las
 * ubicaciones reales, así no tiene que adivinarlas (los modelos chicos inventan líneas).
 */
export function exactOccurrences(files: { path: string; content: string }[], names: string[], max = 25): string {
  if (names.length === 0) return "";
  const lines: string[] = [];
  for (const name of names) {
    const needle = name.toLowerCase();
    for (const file of files) {
      file.content.split("\n").forEach((text, i) => {
        if (lines.length < max && text.toLowerCase().includes(needle)) {
          lines.push(`${file.path}:${i + 1}  ${text.trim().slice(0, 120)}`);
        }
      });
    }
  }
  if (lines.length === 0) return "";
  return (
    `# Búsqueda exacta en el código (datos reales, usalos para decir DÓNDE está algo)\n\n` +
    `Nombres buscados: ${names.join(", ")}\n${lines.join("\n")}\n\n`
  );
}

/** Lo hablado antes, para que el modelo entienda las repreguntas. */
function conversation(history: ChatTurn[]): string {
  if (history.length === 0) return "";
  const turns = history
    .map((t) => `Pregunta: ${t.question}\nRespuesta: ${t.answer.slice(0, HISTORY_ANSWER_CHARS)}`)
    .join("\n\n");
  return `# Conversación anterior (para entender la pregunta nueva)\n\n${turns}\n\n`;
}

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

  // En una charla, "¿y dónde se usa esa función?" no dice de qué habla: se buscan también los nombres
  // de código (entre `backticks`) de la respuesta anterior y las palabras de la pregunta anterior.
  const history = (options.history ?? []).slice(-HISTORY_TURNS);
  const last = history.at(-1);
  let keywords = extractKeywords(question);
  const followUp = Boolean(last && isFollowUp(question, keywords));
  if (last && followUp) {
    keywords = [...new Set([...codeNames(last.answer), ...keywords, ...extractKeywords(last.question)])];
  }
  // Nombres de código a ubicar con búsqueda exacta: los de la pregunta y, si es repregunta, los de la respuesta anterior.
  const names = [...new Set([...codeNamesInQuestion(question), ...(last && followUp ? functionNames(last.answer) : [])])];
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
    conversation(history) +
      exactOccurrences(allFiles, names) +
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
