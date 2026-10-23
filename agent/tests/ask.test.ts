import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ask, buildTreeView, extractKeywords, scoreFiles, selectFiles } from "../src/ask.js";
import type { LLMProvider, LLMRequest } from "../src/llm/types.js";

const FAKE_KEY = "AIza" + "Sy" + "C".repeat(33);

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "guardian-ask-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

/** Proveedor falso que guarda el request para inspeccionarlo. */
function spyProvider(answer = "Se calcula en src/pricing.ts:3") {
  const requests: LLMRequest[] = [];
  const provider: LLMProvider = {
    name: "fake",
    model: "fake-1",
    complete: async (request) => {
      requests.push(request);
      return { text: answer, inputTokens: 100, outputTokens: 20 };
    },
  };
  return { provider, requests };
}

describe("extractKeywords", () => {
  it("descarta artículos y palabras de pregunta", () => {
    expect(extractKeywords("¿Cómo funciona el carrito de compras?")).toEqual(["funciona", "carrito", "compras"]);
    expect(extractKeywords("¿Dónde se validan los datos de la API?")).toEqual(["validan", "datos", "api"]);
  });

  it("devuelve vacío si solo hay palabras vacías", () => {
    expect(extractKeywords("¿qué es esto?")).toEqual([]);
  });
});

describe("scoreFiles", () => {
  it("prioriza archivos cuyo nombre contiene la keyword", () => {
    const ranked = scoreFiles(
      [
        { path: "src/pricing.ts", score: 0, content: "export function cart() {}" },
        { path: "src/cart.ts", score: 0, content: "export function addToCart() {}" },
      ],
      ["cart"],
    );
    expect(ranked.map((f) => f.path)).toEqual(["src/cart.ts", "src/pricing.ts"]);
  });

  it("descarta archivos sin coincidencias", () => {
    const ranked = scoreFiles([{ path: "b.ts", score: 0, content: "hola" }], ["pricing"]);
    expect(ranked).toEqual([]);
  });

  it("no se rompe con caracteres especiales de regex", () => {
    expect(() => scoreFiles([{ path: "a.ts", score: 0, content: "c++" }], ["c++("])).not.toThrow();
  });
});

describe("selectFiles", () => {
  it("llena el presupuesto salteando los archivos que no entran", () => {
    const ranked = [
      { path: "a", content: "a".repeat(100) },
      { path: "grande", content: "g".repeat(1000) },
      { path: "b", content: "b".repeat(100) },
    ];
    expect(selectFiles(ranked, 250).map((f) => f.path)).toEqual(["a", "b"]);
  });
});

describe("buildTreeView", () => {
  it("muestra carpetas y archivos", () => {
    const tree = buildTreeView(["src/services/pricing.ts", "docs/CONVENTIONS.md"]);
    expect(tree).toContain("📁 src");
    expect(tree).toContain("    📄 pricing.ts");
    expect(tree).toContain("📄 CONVENTIONS.md");
  });
});

describe("ask", () => {
  it("pide texto libre y devuelve la respuesta con las fuentes", async () => {
    const root = makeRepo({ "src/pricing.ts": "export const descuento = 10;" });
    const { provider, requests } = spyProvider();
    const result = await ask("¿Cómo se calcula el descuento?", { cwd: root, provider });
    expect(result.answer).toBe("Se calcula en src/pricing.ts:3");
    expect(result.sources).toEqual(["src/pricing.ts"]);
    expect(requests[0].json).toBe(false);
  });

  it("no envía .env ni lo ignorado y redacta secretos", async () => {
    const root = makeRepo({
      ".env": "DESCUENTO_KEY=secreto",
      ".guardianignore": "privado/\n",
      "privado/descuento.ts": "descuento interno",
      "src/descuento.ts": `const descuentoApiKey = "${FAKE_KEY}";`,
    });
    const { provider, requests } = spyProvider();
    const result = await ask("¿Dónde está el descuento?", { cwd: root, provider });
    expect(result.sources).toEqual(["src/descuento.ts"]);
    expect(requests[0].prompt).not.toContain(FAKE_KEY);
    expect(requests[0].prompt).not.toContain("descuento interno");
    expect(requests[0].prompt).toContain("[SECRETO REDACTADO]");
  });

  it("explica que replay no sirve para preguntas", async () => {
    const { provider } = spyProvider();
    await expect(ask("¿Cómo funciona el carrito?", { cwd: ".", provider: { ...provider, name: "replay" } })).rejects.toThrow(
      /modelo real/,
    );
  });
});
