import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mainGuide } from "../src/guide.js";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const run = (...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });

describe("ayuda para principiantes", () => {
  it("explica comandos, cómo elegir cada IA y qué hacer si algo falla", () => {
    const guide = mainGuide();
    for (const text of [
      "LO ÚNICO QUE NECESITÁS SABER",
      "CORRECCIÓN AUTOMÁTICA",
      "guardian \"revisá mis cambios\"",
      "guardian review",
      "guardian ask",
      "guardian dismiss",
      "--use replay",
      "--use ia",
      "--use local",
      "aistudio.google.com/apikey",
      "winget install Ollama.Ollama",
      "CÓMO LEER EL RESULTADO",
      "SI ALGO NO FUNCIONA",
    ]) {
      expect(guide).toContain(text);
    }
  });

  it("se muestra con guardian, --help, -h, help y ayuda", () => {
    for (const args of [[], ["--help"], ["-h"], ["help"], ["ayuda"]]) {
      const result = run(...args);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("ELEGIR LA INTELIGENCIA ARTIFICIAL");
    }
  });

  it("guardian help <comando> muestra la ayuda de ese comando con ejemplos en castellano", () => {
    const result = run("help", "review");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Uso: guardian review [opciones]");
    expect(result.stdout).toContain("Ejemplos");
    expect(result.stdout).toContain("--use local --model qwen2.5-coder:14b");
  });
});
