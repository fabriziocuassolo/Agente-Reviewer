import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * La IA que eligió la persona en el menú. Se guarda en su carpeta de usuario
 * (no en el repo): es una preferencia personal, como el tema del editor.
 * Tiene prioridad sobre el .env; `--use` en un comando tiene prioridad sobre esto.
 */
export interface Prefs {
  use: string;
  model?: string;
  /** Texto para mostrar, ej: "IA local · Ollama · qwen2.5-coder:14b". */
  label?: string;
  fecha: string;
}

export function prefsPath(): string {
  // GUARDIAN_PREFS permite usar otro archivo (tests, o varias configuraciones).
  return process.env.GUARDIAN_PREFS || join(homedir(), ".guardian-preferencias.json");
}

export function loadPrefs(): Prefs | null {
  const path = prefsPath();
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as Prefs;
    return data.use ? data : null;
  } catch {
    return null; // archivo roto: se vuelve a preguntar
  }
}

export function savePrefs(prefs: Omit<Prefs, "fecha">): Prefs {
  const full = { ...prefs, fecha: new Date().toISOString().slice(0, 10) };
  writeFileSync(prefsPath(), JSON.stringify(full, null, 2) + "\n");
  return full;
}
