import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import ignore from "ignore";
import type { GuardianConfig } from "./config.js";

export const SKILLS_DIR = ".guardian/skills";

export interface Skill {
  name: string;
  content: string;
  /** Archivos del cambio que hicieron que esta skill se cargara. */
  matchedFiles: string[];
}

/**
 * Carga SOLO las skills relevantes para los archivos modificados.
 *
 * config.json → "skills": { "ecommerce-pricing": ["src/services/pricing.ts", "**\/checkout*"], ... }
 * Los patrones usan sintaxis de .gitignore (la misma librería que .guardianignore).
 * Si no hay mapeo en config, se cargan todas las skills de la carpeta.
 *
 * Por qué selectivo: cada skill suma tokens (costo y latencia) y ruido al prompt.
 * Un cambio de CSS no necesita las reglas de precios.
 */
export function loadSkills(root: string, config: GuardianConfig, changedFiles: string[]): { skills: Skill[]; warnings: string[] } {
  const dir = join(root, SKILLS_DIR);
  const warnings: string[] = [];
  if (!existsSync(dir)) return { skills: [], warnings };

  const available = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => basename(f, ".md"));

  const mapping = config.skills;
  const selected: Skill[] = [];

  if (!mapping) {
    for (const name of available) {
      selected.push({ name, content: readFileSync(join(dir, `${name}.md`), "utf8"), matchedFiles: changedFiles });
    }
    return { skills: selected, warnings };
  }

  for (const [name, patterns] of Object.entries(mapping)) {
    const matcher = ignore().add(patterns);
    const matchedFiles = changedFiles.filter((file) => matcher.ignores(file));
    if (matchedFiles.length === 0) continue;

    if (!available.includes(name)) {
      warnings.push(`La skill "${name}" está en config.json pero no existe ${SKILLS_DIR}/${name}.md`);
      continue;
    }
    selected.push({ name, content: readFileSync(join(dir, `${name}.md`), "utf8"), matchedFiles });
  }
  return { skills: selected, warnings };
}
