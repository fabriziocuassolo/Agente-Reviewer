import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { createProvider } from "./llm/provider.js";
import type { LLMProvider } from "./llm/types.js";
import { GuardianError } from "./types.js";

/**
 * `guardian ask "<pregunta>"` → responde citando archivo:línea.
 * Versión simple sin base vectorial: árbol de carpetas + búsqueda por palabras
 * clave de la pregunta en el código y en docs/, y le pasa al modelo los archivos
 * más relevantes con un límite de tokens.
 */

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".yaml", ".yml"]);
const IGNORE = new Set(["node_modules", "dist", "build", "coverage", ".git", ".demo-work"]);
const MAX_FILE_SIZE = 100_000; // 100 KB

export interface AskOptions {
  cwd: string;
  provider?: LLMProvider | null;
}

interface FileMatch {
  path: string;
  score: number;
  content: string;
}

/** Extrae palabras clave de la pregunta (sin artículos ni preposiciones cortas). */
export function extractKeywords(question: string): string[] {
  const stopwords = new Set(["el", "la", "los", "las", "un", "una", "de", "en", "a", "con", "por", "para", "que", "es"]);
  return question
    .toLowerCase()
    .replace(/[^\w\sáéíóúñ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopwords.has(w));
}

/** Lee el árbol de carpetas y archivos de texto, excluyendo binarios e ignorados. */
function readTree(root: string, relativePath = ""): FileMatch[] {
  const files: FileMatch[] = [];
  const fullPath = join(root, relativePath);
  const entries = readdirSync(fullPath, { withFileTypes: true });

  for (const entry of entries) {
    if (IGNORE.has(entry.name) || entry.name.startsWith(".")) continue;
    const rel = join(relativePath, entry.name);
    const full = join(root, rel);

    if (entry.isDirectory()) {
      files.push(...readTree(root, rel));
    } else if (entry.isFile() && CODE_EXTENSIONS.has(extname(entry.name))) {
      try {
        const stat = statSync(full);
        if (stat.size > MAX_FILE_SIZE) continue;
        const content = readFileSync(full, "utf8");
        files.push({ path: rel.replace(/\\/g, "/"), score: 0, content });
      } catch {
        // archivos binarios o sin acceso se omiten
      }
    }
  }
  return files;
}

/** Puntúa archivos según keywords: coincidencias en el nombre y en el contenido. */
export function scoreFiles(files: FileMatch[], keywords: string[]): FileMatch[] {
  for (const file of files) {
    let score = 0;
    const name = basename(file.path).toLowerCase();
    const content = file.content.toLowerCase();

    for (const kw of keywords) {
      if (name.includes(kw)) score += 10;
      const matches = (content.match(new RegExp(kw, "g")) || []).length;
      score += Math.min(matches, 20); // máximo 20 puntos por keyword
    }
    // Prioridad extra para docs/
    if (file.path.startsWith("docs/")) score += 5;
    file.score = score;
  }
  return files.filter((f) => f.score > 0).sort((a, b) => b.score - a.score);
}

/** Selecciona archivos hasta llenar maxChars, priorizando por score. */
export function selectFiles(ranked: FileMatch[], maxChars: number): FileMatch[] {
  const selected: FileMatch[] = [];
  let total = 0;
  for (const file of ranked) {
    if (total + file.content.length > maxChars) break;
    selected.push(file);
    total += file.content.length;
  }
  return selected;
}

/** Construye el prompt con el árbol de carpetas y los archivos seleccionados. */
function buildAskPrompt(root: string, question: string, allFiles: FileMatch[], selected: FileMatch[]): string {
  const tree = buildTreeView(allFiles.map((f) => f.path));
  const files = selected.map((f) => `## ${f.path}\n\`\`\`\n${addLineNumbers(f.content)}\n\`\`\``).join("\n\n");
  return `# Pregunta del desarrollador\n\n${question}\n\n# Estructura del proyecto\n\n${tree}\n\n# Archivos relevantes\n\n${files}`;
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
    const children = Array.from(tree[dir] || []).sort();
    for (const child of children) {
      const childPath = dir === "." ? child : `${dir}/${child}`;
      const isDir = tree[childPath];
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
    .map((line, i) => `${String(i + 1).padStart(4)} ${line}`)
    .join("\n");
}

const SYSTEM_PROMPT = `Sos un asistente experto que ayuda a desarrolladores a entender un proyecto de código.
Respondé la pregunta del desarrollador citando SIEMPRE archivo y línea cuando menciones código (formato: archivo:línea).
Si la respuesta requiere ver varios archivos, mencioná todos los relevantes.
Si no tenés suficiente información, decilo claramente. Respondé en español, claro y conciso.`;

export async function ask(question: string, options: AskOptions): Promise<string> {
  if (!question.trim()) throw new GuardianError("Escribí una pregunta.");

  const { provider, reason } =
    options.provider !== undefined ? { provider: options.provider, reason: "proveedor no disponible" } : createProvider();

  if (!provider) {
    throw new GuardianError(`No se puede responder sin un modelo configurado: ${reason}. Configurá LLM_PROVIDER en .env.`);
  }

  const keywords = extractKeywords(question);
  if (keywords.length === 0) throw new GuardianError("La pregunta es demasiado corta o genérica.");

  const allFiles = readTree(options.cwd);
  const ranked = scoreFiles(allFiles, keywords);
  if (ranked.length === 0) {
    return "No encontré archivos relacionados con tu pregunta. Probá con otras palabras clave.";
  }

  const selected = selectFiles(ranked, 40_000); // ~10k tokens
  const prompt = buildAskPrompt(options.cwd, question, allFiles, selected);

  const response = await provider.complete({ system: SYSTEM_PROMPT, prompt });
  return response.text;
}
