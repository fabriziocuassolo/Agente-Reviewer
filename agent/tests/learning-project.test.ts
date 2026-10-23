import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { codeNamesInQuestion, exactOccurrences, functionNames, isFollowUp } from "../src/ask.js";
import { addFixedRule, loadConfig } from "../src/config.js";
import { customRuleFindings } from "../src/checks/rules.js";
import { buildContext } from "../src/context.js";
import { forgetRule, learnRule, loadLearned, loadMemory, relevantLearned } from "../src/memory.js";
import { findProject } from "../src/project.js";
import { buildPrompt } from "../src/reviewer.js";

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "guardian-lp-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

describe("monorepo: elegir el proyecto correcto", () => {
  const files = {
    "tienda/.guardian/config.json": "{}",
    "tienda/docs/CONVENTIONS.md": "convenciones de la tienda",
    "tienda/public/index.html": "<p>hola</p>",
    "otra/readme.md": "x",
  };

  it("desde la raíz, elige el proyecto que contiene los archivos cambiados", () => {
    const root = makeRepo(files);
    expect(findProject(root, root, ["tienda/public/index.html"]).prefix).toBe("tienda/");
  });

  it("desde dentro de una subcarpeta del proyecto, elige ese proyecto", () => {
    const root = makeRepo(files);
    expect(findProject(root, join(root, "tienda", "public"), []).prefix).toBe("tienda/");
  });

  it("si nada tiene configuración, usa la raíz", () => {
    const root = makeRepo({ "otra/readme.md": "x" });
    expect(findProject(root, root, ["otra/readme.md"]).prefix).toBe("");
  });

  it("el contexto usa las convenciones del proyecto y no manda archivos internos ni binarios", () => {
    const root = makeRepo({ ...files, ".guardian/memory.json": '{"dismissed":[]}', "docs/guia.pdf": "%PDF\u0000binario" });
    const project = findProject(root, root, ["tienda/public/index.html"]);
    const diff = ["tienda/public/index.html", ".guardian/memory.json", "docs/guia.pdf"]
      .map((f) => `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -1 +1 @@\n+x\n`)
      .join("");
    const ctx = buildContext(root, { description: "", diff, files: ["tienda/public/index.html", ".guardian/memory.json", "docs/guia.pdf"] }, 50_000, project);
    expect(ctx.conventions).toBe("convenciones de la tienda");
    expect(ctx.changedFiles).toEqual(["tienda/public/index.html"]);
    expect(ctx.omitted).toEqual(expect.arrayContaining([".guardian/memory.json", "docs/guia.pdf"]));
  });
});

describe("reglas fijas del equipo (sin IA)", () => {
  const project = { dir: "/x", prefix: "tienda/" };
  const added = new Map([
    ["tienda/public/app.js", [{ line: 7, text: 'el.innerHTML = "Hola " + nombre;' }]],
    ["tienda/src/server.ts", [{ line: 3, text: "div.innerHTML = x" }]],
  ]);

  it("detecta el patrón solo en los archivos indicados, con la severidad configurada", () => {
    const findings = customRuleFindings(
      added,
      [{ nombre: "sin-innerHTML", buscar: "\\.innerHTML\\s*=", archivos: ["public/**"], severidad: "alto", mensaje: "XSS" }],
      project,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: "tienda/public/app.js", line: 7, severity: "alto", category: "regla: sin-innerHTML", source: "deterministico" });
  });

  it("sin archivos indicados, aplica a todo el proyecto", () => {
    const findings = customRuleFindings(added, [{ nombre: "r", buscar: "innerhtml", severidad: "medio", mensaje: "m" }], project);
    expect(findings).toHaveLength(2);
  });
});

describe("reglas fijas desde la terminal (guardian aprender --patron)", () => {
  it("las agrega a config.json sin borrar el resto, y loadConfig las lee", () => {
    const root = makeRepo({ ".guardian/config.json": JSON.stringify({ baseBranch: "develop" }) });
    const rule = addFixedRule(root, { mensaje: "Sin scripts inline en el HTML", buscar: "<script>", archivos: ["public/**/*.html"] });
    expect(rule).toMatchObject({ nombre: "sin-scripts-inline-en-el-html-1", severidad: "alto" });
    const config = loadConfig(root);
    expect(config.baseBranch).toBe("develop");
    expect(config.rules).toHaveLength(1);
  });

  it("rechaza un patrón inválido", () => {
    expect(() => addFixedRule(makeRepo({}), { mensaje: "regla rota", buscar: "(" })).toThrow(/expresión regular/);
  });
});

describe("aprendizaje: guardian aprender", () => {
  it("guarda, lista y borra reglas sin perder los descartes", () => {
    const root = makeRepo({ ".guardian/memory.json": JSON.stringify({ dismissed: [{ id: "G-1", file: null, category: "c", pattern: "p", reason: "r", date: "d" }] }) });
    learnRule(root, "Los precios nunca se calculan en el frontend", ["public/**"]);
    learnRule(root, "Toda función nueva de precios lleva tests");
    expect(loadLearned(root).map((r) => r.regla)).toEqual([
      "Los precios nunca se calculan en el frontend",
      "Toda función nueva de precios lleva tests",
    ]);
    expect(loadMemory(root)).toHaveLength(1); // los descartes siguen ahí

    forgetRule(root, 1);
    expect(loadLearned(root).map((r) => r.regla)).toEqual(["Toda función nueva de precios lleva tests"]);
  });

  it("exige una regla con algo de detalle", () => {
    expect(() => learnRule(makeRepo({}), "corto")).toThrow(/detalle/);
  });

  it("solo pasa al prompt las reglas que aplican a los archivos cambiados", () => {
    const rules = [
      { regla: "general", fecha: "d" },
      { regla: "solo frontend", archivos: ["public/**"], fecha: "d" },
    ];
    expect(relevantLearned(rules, ["src/a.ts"]).map((r) => r.regla)).toEqual(["general"]);
    expect(relevantLearned(rules, ["public/app.js"]).map((r) => r.regla)).toEqual(["general", "solo frontend"]);
  });

  it("el prompt de revisión incluye las reglas aprendidas y pide TODOS los problemas", () => {
    const prompt = buildPrompt(
      { diff: "", files: [], conventions: null, omitted: [], redactions: 0, changedFiles: ["a.ts"] },
      { skills: [], exceptions: [], learned: [{ regla: "Nada de console.log en producción", fecha: "d" }] },
    );
    expect(prompt).toContain("## Reglas que enseñó el equipo (obligatorias)");
    expect(prompt).toContain("Nada de console.log en producción");
  });
});

describe("chat: repreguntas", () => {
  it("reconoce una repregunta", () => {
    expect(isFollowUp("¿y dónde se usa esa función?", ["usa", "función"])).toBe(true);
    expect(isFollowUp("¿Qué cupones existen en la tienda?", ["cupones", "existen", "tienda"])).toBe(false);
  });

  it("toma de la respuesta anterior los nombres de funciones, no las constantes", () => {
    const answer = "Se calcula con `calculateShipping` usando `SHIPPING_COST_CENTS` en `src/services/pricing.ts`.";
    expect(functionNames(answer)).toEqual(["calculateshipping"]);
  });

  it("detecta nombres de código escritos en la pregunta", () => {
    expect(codeNamesInQuestion("¿Dónde se llama a calculateTotals?")).toEqual(["calculatetotals"]);
  });

  it("la búsqueda exacta devuelve archivo:línea reales", () => {
    const text = exactOccurrences([{ path: "src/p.ts", content: "a\nconst x = calculateShipping(1);" }], ["calculateshipping"]);
    expect(text).toContain("src/p.ts:2  const x = calculateShipping(1);");
  });
});
