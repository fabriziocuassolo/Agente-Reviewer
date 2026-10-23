import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyFixes, commitAndPush, extractCode, fixableFindings, proposeFixes, rollbackFixes } from "../src/fixer.js";
import type { LLMProvider } from "../src/llm/types.js";
import { chooseAI, setEnvVars, type Asker } from "../src/menu.js";
import { routeNaturalLanguage } from "../src/nl.js";
import { loadPrefs, savePrefs } from "../src/prefs.js";
import type { Finding, ReviewReport } from "../src/types.js";

const fake = (answers: string[]): Asker => ({ question: async () => answers.shift() ?? "", close() {} });
const finding = (over: Partial<Finding>): Finding => ({
  id: "G-1",
  file: "a.js",
  line: 2,
  severity: "critico",
  category: "seguridad",
  explanation: "innerHTML con datos",
  suggestion: "usá textContent",
  source: "llm",
  ...over,
});
const report = (findings: Finding[], files = ["a.js"]): ReviewReport => ({
  decision: "BLOQUEADO",
  gate: { decision: "BLOQUEADO", rule: null, reason: "" },
  changes: { description: "", files },
  checks: [],
  findings,
  dismissed: [],
  warnings: [],
  timings: [],
});

let env: NodeJS.ProcessEnv;
beforeEach(() => {
  env = { ...process.env };
  process.env.GUARDIAN_PREFS = join(mkdtempSync(join(tmpdir(), "guardian-prefs-")), "prefs.json");
});
afterEach(() => {
  process.env = env;
});

describe("preferencia guardada", () => {
  it("guarda y lee la IA elegida", () => {
    expect(loadPrefs()).toBeNull();
    savePrefs({ use: "ollama", model: "qwen2.5-coder:14b", label: "IA local" });
    expect(loadPrefs()).toMatchObject({ use: "ollama", model: "qwen2.5-coder:14b" });
  });
});

describe("menú de IA", () => {
  it("1 = replay", async () => {
    expect(await chooseAI(fake(["1"]), {})).toMatchObject({ use: "replay" });
  });

  it("vuelve a preguntar si el número no es válido", async () => {
    expect(await chooseAI(fake(["7", "abc", "1"]), {})).toMatchObject({ use: "replay" });
  });

  it("IA local sin Ollama: explica cómo instalarlo y no elige nada", async () => {
    expect(await chooseAI(fake(["2"]), { OLLAMA_HOST: "http://127.0.0.1:9" })).toBeNull();
  });

  it("Gemini configurada: la usa directo", async () => {
    expect(await chooseAI(fake(["3", "1"]), { GEMINI_API_KEY: "k" })).toMatchObject({ use: "gemini" });
  });

  it("Claude sin configurar: si no pega clave, no elige nada", async () => {
    expect(await chooseAI(fake(["3", "2", ""]), {})).toBeNull();
  });

  it("GPT ya configurada en el .env: la usa directo", async () => {
    const choice = await chooseAI(fake(["3", "4"]), { IA_CHATGPT_URL: "https://api.openai.com/v1", IA_CHATGPT_KEY: "k", IA_CHATGPT_MODEL: "m" });
    expect(choice).toMatchObject({ use: "chatgpt" });
  });

  it("setEnvVars agrega o reemplaza líneas en el .env", () => {
    const path = join(mkdtempSync(join(tmpdir(), "guardian-env-")), ".env");
    writeFileSync(path, "LLM_PROVIDER=replay\nGEMINI_API_KEY=vieja\n");
    setEnvVars({ GEMINI_API_KEY: "nueva", IA_CLAUDE_KEY: "k" }, path);
    expect(readFileSync(path, "utf8")).toBe("LLM_PROVIDER=replay\nGEMINI_API_KEY=nueva\nIA_CLAUDE_KEY=k\n");
  });
});

describe("lenguaje natural", () => {
  it.each([
    ["revisá mis cambios", ["review"]],
    ["revisá mis cambios con la IA local", ["review", "--use", "ollama"]],
    ["¿está listo para subir?", ["review"]],
    ["corregí los errores con gemini", ["review", "--corregir", "--use", "gemini"]],
    ["quiero cambiar la IA", ["ia"]],
    ["abrí el chat", ["chat"]],
    ["ayuda", ["--help"]],
    ["aprendé que los precios van en centavos", ["aprender", "los precios van en centavos"]],
    ["¿dónde se calcula el envío?", ["ask", "¿dónde se calcula el envío?"]],
  ])('"%s"', (text, expected) => {
    expect(routeNaturalLanguage(text)).toEqual(expected);
  });
});

describe("corrección automática", () => {
  it("solo intenta corregir hallazgos con archivo (no 'fallan los tests')", () => {
    const r = report([finding({}), finding({ file: null, category: "tests", source: "deterministico" })]);
    expect(fixableFindings(r)).toHaveLength(1);
  });

  it("extractCode saca el archivo del bloque y rechaza respuestas recortadas", () => {
    const original = "linea1\nlinea2\nlinea3\n";
    expect(extractCode("Acá está:\n```js\nlinea1\nLINEA2\nlinea3\n```\n", original)).toBe("linea1\nLINEA2\nlinea3\n");
    expect(extractCode("```\nx\n```", original)).toBeNull();
  });

  it("propone, aplica y hace rollback exacto", async () => {
    const root = mkdtempSync(join(tmpdir(), "guardian-fix-"));
    const original = 'const a = 1;\nel.innerHTML = "hola " + nombre;\nconst b = 2;\n';
    writeFileSync(join(root, "a.js"), original);
    const provider: LLMProvider = {
      name: "fake",
      model: "fake",
      complete: async () => ({ text: '```js\nconst a = 1;\nel.textContent = "hola " + nombre;\nconst b = 2;\n```' }),
    };
    const { fixes } = await proposeFixes(provider, root, report([finding({})]), null);
    expect(fixes).toHaveLength(1);
    applyFixes(root, fixes);
    expect(readFileSync(join(root, "a.js"), "utf8")).toContain("textContent");
    rollbackFixes(root, fixes);
    expect(readFileSync(join(root, "a.js"), "utf8")).toBe(original);
  });

  it("commit + push al remoto con un mensaje que lista lo corregido", () => {
    const base = mkdtempSync(join(tmpdir(), "guardian-push-"));
    const run = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString();
    run(base, "init", "-q", "--bare", "remote.git");
    const work = join(base, "work");
    execFileSync("git", ["clone", "-q", join(base, "remote.git"), work], { stdio: "pipe" });
    run(work, "config", "user.name", "t");
    run(work, "config", "user.email", "t@t");
    writeFileSync(join(work, "a.js"), "inicial\n");
    run(work, "add", ".");
    run(work, "commit", "-qm", "base");
    run(work, "push", "-q", "origin", "HEAD");

    writeFileSync(join(work, "a.js"), "corregido\n");
    const fixes = [{ file: "a.js", before: "inicial\n", after: "corregido\n", findings: [finding({})] }];
    const result = commitAndPush(work, report([finding({})]), fixes);
    expect(result).toMatchObject({ committed: true, pushed: true });
    expect(run(join(base, "remote.git"), "log", "--format=%s", "-1", "HEAD")).toContain("Correcciones automáticas de Guardian");
  });
});
