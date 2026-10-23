import { describe, expect, it } from "vitest";
import { extractKeywords, scoreFiles, selectFiles, buildTreeView } from "../src/ask.js";

// Para poder testear funciones privadas las exporto solo en modo test
declare module "../src/ask.js" {
  export function extractKeywords(question: string): string[];
  export function scoreFiles(files: Array<{ path: string; score: number; content: string }>, keywords: string[]): typeof files;
  export function selectFiles(ranked: Array<{ path: string; content: string }>, maxChars: number): typeof ranked;
  export function buildTreeView(paths: string[]): string;
}

describe("ask - keyword extraction", () => {
  it("extrae palabras clave ignorando stopwords", () => {
    expect(extractKeywords("¿Cómo funciona el carrito de compras?")).toEqual(["cómo", "funciona", "carrito", "compras"]);
  });

  it("filtra palabras muy cortas", () => {
    expect(extractKeywords("¿Qué es un API?")).toEqual(["qué", "api"]);
  });

  it("devuelve vacío si la pregunta es solo stopwords", () => {
    expect(extractKeywords("el la los")).toEqual([]);
  });
});

describe("ask - file scoring", () => {
  it("puntúa más alto archivos cuyo nombre contiene keywords", () => {
    const files = [
      { path: "src/cart.ts", score: 0, content: "export function addToCart() {}" },
      { path: "src/pricing.ts", score: 0, content: "function calculateCart() {}" },
    ];
    const ranked = scoreFiles(files, ["cart"]);
    expect(ranked[0].path).toBe("src/cart.ts");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("puntúa también por contenido", () => {
    const files = [
      { path: "a.ts", score: 0, content: "pricing pricing pricing" },
      { path: "b.ts", score: 0, content: "hello" },
    ];
    const ranked = scoreFiles(files, ["pricing"]);
    expect(ranked.length).toBe(1);
    expect(ranked[0].path).toBe("a.ts");
  });

  it("da prioridad a docs/", () => {
    const files = [
      { path: "docs/CONVENTIONS.md", score: 0, content: "pricing" },
      { path: "src/other.ts", score: 0, content: "pricing" },
    ];
    const ranked = scoreFiles(files, ["pricing"]);
    expect(ranked[0].path).toBe("docs/CONVENTIONS.md");
  });
});

describe("ask - file selection", () => {
  it("selecciona archivos hasta llenar el presupuesto", () => {
    const ranked = [
      { path: "a.ts", content: "a".repeat(100) },
      { path: "b.ts", content: "b".repeat(100) },
      { path: "c.ts", content: "c".repeat(100) },
    ];
    const selected = selectFiles(ranked, 250);
    expect(selected.length).toBe(2);
    expect(selected.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
  });

  it("no selecciona ninguno si el primero ya excede el límite", () => {
    const ranked = [{ path: "huge.ts", content: "x".repeat(1000) }];
    const selected = selectFiles(ranked, 500);
    expect(selected).toEqual([]);
  });
});

describe("ask - tree view", () => {
  it("construye un árbol visual de carpetas y archivos", () => {
    const paths = ["src/services/pricing.ts", "src/routes/products.ts", "docs/CONVENTIONS.md"];
    const tree = buildTreeView(paths);
    expect(tree).toContain("📁 src");
    expect(tree).toContain("📁 services");
    expect(tree).toContain("📄 pricing.ts");
    expect(tree).toContain("📁 docs");
    expect(tree).toContain("📄 CONVENTIONS.md");
  });
});
