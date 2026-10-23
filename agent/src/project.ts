import { existsSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";

/**
 * En un monorepo (varios proyectos en un mismo repositorio git), cada proyecto puede tener
 * su propia configuración de Guardian: `.guardian/`, `docs/CONVENTIONS.md`, `.guardianignore`.
 * Este módulo decide cuál usar, para que las convenciones y skills de la tienda se apliquen
 * aunque Guardian se ejecute desde la raíz del repo.
 */
export interface Project {
  /** Carpeta absoluta del proyecto. */
  dir: string;
  /** Ruta del proyecto relativa a la raíz del repo, con "/" final ("" si es la raíz). */
  prefix: string;
}

/** Una carpeta es "proyecto de Guardian" si tiene configuración, skills o convenciones. */
export function isGuardianProject(dir: string): boolean {
  return (
    existsSync(join(dir, ".guardian", "config.json")) ||
    existsSync(join(dir, ".guardian", "skills")) ||
    existsSync(join(dir, "docs", "CONVENTIONS.md"))
  );
}

function toProject(root: string, dir: string): Project {
  const rel = relative(root, dir).replace(/\\/g, "/");
  return { dir, prefix: rel ? `${rel}/` : "" };
}

/**
 * Elige el proyecto:
 * 1. Si estás parado dentro de un proyecto (o de una subcarpeta suya), ese.
 * 2. Si no (por ejemplo, en la raíz del repo), el proyecto que contiene más archivos cambiados.
 * 3. Si ninguno tiene configuración, la raíz del repo.
 */
export function findProject(root: string, cwd: string, changedFiles: string[] = []): Project {
  const absRoot = resolve(root);

  for (let dir = resolve(cwd); dir.startsWith(absRoot); dir = dirname(dir)) {
    if (dir !== absRoot && isGuardianProject(dir)) return toProject(absRoot, dir);
    if (dir === absRoot || dirname(dir) === dir) break;
  }

  const votes = new Map<string, number>();
  for (const file of changedFiles) {
    for (let dir = dirname(join(absRoot, file)); dir.startsWith(absRoot) && dir !== absRoot; dir = dirname(dir)) {
      if (isGuardianProject(dir)) {
        votes.set(dir, (votes.get(dir) ?? 0) + 1);
        break; // el proyecto más cercano al archivo
      }
    }
  }
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0];
  return toProject(absRoot, best ? best[0] : absRoot);
}

/** Ruta relativa a la raíz del repo → relativa al proyecto (para patrones de skills e ignore). */
export function inProject(project: Project, file: string): string {
  return project.prefix && file.startsWith(project.prefix) ? file.slice(project.prefix.length) : file;
}

/** ¿El archivo pertenece al proyecto? */
export function belongsTo(project: Project, file: string): boolean {
  return !project.prefix || file.startsWith(project.prefix);
}

export const posixJoin = posix.join;
