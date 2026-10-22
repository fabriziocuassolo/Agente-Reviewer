import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import ignore, { type Ignore } from "ignore";
import { redactSecrets } from "./checks/secrets.js";
import { isBinary, type ChangeSet } from "./git.js";

/**
 * Lo que NUNCA se envía al modelo, aunque el .guardianignore no lo diga.
 * Los lockfiles se suman por ser enormes y sin valor para la revisión.
 */
const ALWAYS_IGNORED = [".env", ".env.*", "node_modules/", "dist/", ".git/", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"];

export interface ContextFile {
  path: string;
  content: string;
  reason: "modificado" | "importado";
}

export interface ReviewContext {
  diff: string;
  files: ContextFile[];
  conventions: string | null;
  /** Archivos que no entraron (ignorados, binarios o por límite de tamaño). */
  omitted: string[];
  /** Cantidad de secretos reemplazados por [SECRETO REDACTADO]. */
  redactions: number;
  /** Archivos modificados que el revisor puede citar. */
  changedFiles: string[];
}

export function createIgnoreFilter(root: string): Ignore {
  const filter = ignore().add(ALWAYS_IGNORED);
  const custom = join(root, ".guardianignore");
  if (existsSync(custom)) filter.add(readFileSync(custom, "utf8"));
  return filter;
}

/**
 * Arma el contexto del revisor, en orden de prioridad hasta llenar `maxChars`:
 * convenciones → diff → archivos modificados → archivos que estos importan.
 * Todo pasa por la redacción de secretos antes de salir de la máquina.
 */
export function buildContext(root: string, changes: ChangeSet, maxChars: number): ReviewContext {
  const filter = createIgnoreFilter(root);
  const omitted: string[] = [];
  let redactions = 0;
  let budget = maxChars;

  const redact = (text: string) => {
    const result = redactSecrets(text);
    redactions += result.count;
    return result.text;
  };

  // 1. Convenciones del proyecto
  const conventionsPath = join(root, "docs", "CONVENTIONS.md");
  const conventions = existsSync(conventionsPath) ? redact(readFileSync(conventionsPath, "utf8")) : null;
  budget -= conventions?.length ?? 0;

  // 2. Diff (sin las secciones de archivos ignorados)
  let diff = redact(filterDiff(changes.diff, filter));
  if (diff.length > budget) {
    diff = diff.slice(0, Math.max(budget, 0)) + "\n[... diff truncado por tamaño ...]";
    omitted.push("(parte del diff)");
  }
  budget -= diff.length;

  // 3 y 4. Archivos modificados y luego sus imports directos
  const changedFiles = changes.files.filter((f) => !filter.ignores(f));
  omitted.push(...changes.files.filter((f) => filter.ignores(f)));

  const files: ContextFile[] = [];
  const included = new Set<string>();
  const tryAdd = (path: string, reason: ContextFile["reason"]) => {
    if (included.has(path)) return;
    included.add(path);
    const content = readText(root, path);
    if (content === null) {
      omitted.push(path);
      return;
    }
    const numbered = redact(withLineNumbers(content));
    if (numbered.length > budget) {
      omitted.push(path);
      return;
    }
    budget -= numbered.length;
    files.push({ path, content: numbered, reason });
  };

  for (const path of changedFiles) tryAdd(path, "modificado");
  for (const path of changedFiles) {
    const content = readText(root, path);
    if (!content) continue;
    for (const imported of findRelativeImports(root, path, content)) {
      if (!filter.ignores(imported)) tryAdd(imported, "importado");
    }
  }

  return { diff, files, conventions, omitted, redactions, changedFiles };
}

/** Saca del diff las secciones de archivos ignorados. */
function filterDiff(diff: string, filter: Ignore): string {
  return diff
    .split(/(?=^diff --git )/m)
    .filter((section) => {
      const match = /^diff --git a\/(.+?) b\//.exec(section);
      return !match || !filter.ignores(match[1]);
    })
    .join("");
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function readText(root: string, path: string): string | null {
  const full = join(root, path);
  if (!existsSync(full)) return null;
  const buffer = readFileSync(full);
  return isBinary(buffer) ? null : buffer.toString("utf8").replace(/\r\n/g, "\n");
}

/** Numera las líneas para que el modelo pueda citar archivo:línea con precisión. */
function withLineNumbers(content: string): string {
  return content
    .split("\n")
    .map((line, i) => `${String(i + 1).padStart(4)} | ${line}`)
    .join("\n");
}

/**
 * Imports relativos de un archivo JS/TS ("./x", "../y"), resueltos a rutas reales.
 * Solo un nivel de profundidad: suficiente para ver las funciones que usa el cambio.
 */
export function findRelativeImports(root: string, file: string, content: string): string[] {
  const specifiers = new Set<string>();
  const regex = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;
  for (const match of content.matchAll(regex)) specifiers.add(match[1]);

  const result: string[] = [];
  for (const spec of specifiers) {
    const base = posix.join(dirname(file).replace(/\\/g, "/"), spec);
    // En proyectos TS con NodeNext se importa "./x.js" aunque el archivo sea x.ts
    const candidates = [base, base.replace(/\.js$/, ".ts"), `${base}.ts`, `${base}.js`, `${base}/index.ts`, `${base}/index.js`];
    const found = candidates.find((c) => isFile(join(root, c)));
    if (found && found !== file) result.push(found);
  }
  return result;
}
