import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GuardianError } from "./types.js";

/** Ejecuta un comando git y devuelve stdout. Lanza si git termina con error. */
export function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 50 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

function gitOk(args: string[], cwd: string): boolean {
  try {
    git(args, cwd);
    return true;
  } catch {
    return false;
  }
}

export function getRepoRoot(cwd: string): string | null {
  try {
    return git(["rev-parse", "--show-toplevel"], cwd).trim();
  } catch {
    return null;
  }
}

export interface ChangeSet {
  /** Texto legible: contra qué se comparó. */
  description: string;
  /** Diff unificado (incluye archivos nuevos sin trackear). */
  diff: string;
  /** Archivos modificados o agregados que existen en disco (no incluye borrados). */
  files: string[];
}

const DIFF_FLAGS = ["--no-color", "--no-ext-diff", "-U3"];

/**
 * Obtiene los cambios a revisar.
 *
 * Orden de decisión:
 * 1. `--base <ref>`: todo lo que cambió desde el merge-base con esa ref (commits + sin commitear).
 * 2. Si hay cambios sin commitear: diff contra HEAD (el caso típico mientras se programa).
 * 3. Si el árbol está limpio: commits de la rama actual contra la rama base
 *    (el caso del hook pre-push). En la propia rama base se compara contra su upstream.
 */
export function collectChanges(root: string, baseBranch: string, baseRef?: string): ChangeSet {
  if (!gitOk(["rev-parse", "--verify", "--quiet", "HEAD"], root)) {
    throw new GuardianError("El repositorio todavía no tiene commits: no hay contra qué comparar.");
  }

  if (baseRef) {
    if (!gitOk(["rev-parse", "--verify", "--quiet", baseRef], root)) {
      throw new GuardianError(`No existe la referencia "${baseRef}".`);
    }
    const mergeBase = git(["merge-base", baseRef, "HEAD"], root).trim();
    return withUntracked(root, `cambios desde ${baseRef}`, mergeBase);
  }

  const dirty = git(["status", "--porcelain"], root).trim() !== "";
  if (dirty) {
    return withUntracked(root, "cambios sin commitear contra HEAD", "HEAD");
  }

  const base = findBaseRef(root, baseBranch);
  if (!base) {
    return { description: "sin cambios (no hay rama base con la cual comparar)", diff: "", files: [] };
  }
  const mergeBase = git(["merge-base", base, "HEAD"], root).trim();
  return {
    description: `commits de la rama actual contra ${base}`,
    diff: git(["diff", ...DIFF_FLAGS, mergeBase, "HEAD"], root),
    files: splitLines(git(["diff", "--name-only", "--diff-filter=d", mergeBase, "HEAD"], root)),
  };
}

function findBaseRef(root: string, baseBranch: string): string | null {
  const current = git(["rev-parse", "--abbrev-ref", "HEAD"], root).trim();
  const candidates =
    current === baseBranch ? ["@{upstream}"] : [baseBranch, `origin/${baseBranch}`, "main", "master", "origin/main", "origin/master"];
  return candidates.find((ref) => gitOk(["rev-parse", "--verify", "--quiet", ref], root)) ?? null;
}

/** Diff del árbol de trabajo contra `against`, sumando los archivos nuevos que git todavía no trackea. */
function withUntracked(root: string, description: string, against: string): ChangeSet {
  let diff = git(["diff", ...DIFF_FLAGS, against], root);
  const files = splitLines(git(["diff", "--name-only", "--diff-filter=d", against], root));

  const untracked = splitLines(git(["ls-files", "--others", "--exclude-standard"], root));
  for (const file of untracked) {
    files.push(file);
    diff += syntheticNewFileDiff(root, file);
  }
  return { description, diff, files };
}

/** `git diff` no muestra archivos sin trackear: armamos a mano su diff de "archivo nuevo". */
function syntheticNewFileDiff(root: string, file: string): string {
  const content = readFileSync(join(root, file));
  if (isBinary(content)) return `diff --git a/${file} b/${file}\nnew file\nBinary files /dev/null and b/${file} differ\n`;

  const lines = content.toString("utf8").replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const body = lines.map((l) => `+${l}`).join("\n");
  return `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${body}\n`;
}

/** Heurística estándar (la misma que usa git): si hay un byte nulo al principio, es binario. */
export function isBinary(content: Buffer): boolean {
  return content.subarray(0, 8000).includes(0);
}

function splitLines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}
