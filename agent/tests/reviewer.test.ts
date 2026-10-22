import { describe, expect, it } from "vitest";
import type { ReviewContext } from "../src/context.js";
import { LLMError, type LLMProvider, type LLMResponse } from "../src/llm/types.js";
import { parseResponse, reviewWithLLM } from "../src/reviewer.js";

const context: ReviewContext = {
  diff: "diff --git a/src/a.ts b/src/a.ts\n+const x = 1;",
  files: [{ path: "src/a.ts", content: "   1 | const x = 1;", reason: "modificado" }],
  conventions: "Precios en centavos.",
  omitted: [],
  redactions: 0,
  changedFiles: ["src/a.ts"],
};

/** Proveedor falso que devuelve respuestas predefinidas, en orden. */
function fakeProvider(...responses: (string | Error)[]): LLMProvider & { calls: number } {
  return {
    name: "fake",
    model: "fake-1",
    calls: 0,
    async complete(): Promise<LLMResponse> {
      const next = responses[this.calls++];
      if (next instanceof Error) throw next;
      return { text: next, inputTokens: 100, outputTokens: 10 };
    },
  };
}

const VALID = JSON.stringify({
  findings: [
    {
      file: "src/a.ts",
      line: 1,
      severity: "alto",
      category: "Precios",
      explanation: "Usa flotantes",
      suggestion: "Usá centavos",
    },
  ],
});

describe("parseResponse", () => {
  it("acepta JSON envuelto en bloque de código markdown", () => {
    expect(parseResponse("```json\n" + VALID + "\n```").ok).toBe(true);
  });

  it("convierte líneas que vienen como string", () => {
    const result = parseResponse(VALID.replace('"line":1', '"line":"7"'));
    expect(result.ok && result.data.findings[0].line).toBe(7);
  });

  it("rechaza severidades desconocidas indicando el campo", () => {
    const result = parseResponse(VALID.replace('"alto"', '"grave"'));
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.error).toContain("findings.0.severity");
  });
});

describe("reviewWithLLM", () => {
  it("devuelve hallazgos válidos con ID estable y categoría normalizada", async () => {
    const result = await reviewWithLLM(fakeProvider(VALID), context);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ file: "src/a.ts", category: "precios", source: "llm" });
    expect(result.findings[0].id).toMatch(/^G-[0-9a-f]{6}$/);
    expect(result.attempts).toBe(1);
  });

  it("reintenta una vez si el JSON es inválido", async () => {
    const provider = fakeProvider("no es json", VALID);
    const result = await reviewWithLLM(provider, context);
    expect(provider.calls).toBe(2);
    expect(result.findings).toHaveLength(1);
    expect(result.inputTokens).toBe(200);
  });

  it("degrada con un aviso si falla dos veces", async () => {
    const result = await reviewWithLLM(fakeProvider("{}", "{}"), context);
    expect(result.findings).toEqual([]);
    expect(result.warnings[0]).toMatch(/respuesta inválida dos veces/);
    expect(result.degraded).toBe(true);
  });

  it("degrada con un aviso si el proveedor falla", async () => {
    const result = await reviewWithLLM(fakeProvider(new LLMError("timeout")), context);
    expect(result.findings).toEqual([]);
    expect(result.warnings[0]).toContain("timeout");
  });

  it("descarta hallazgos sobre archivos que no están en el cambio", async () => {
    const hallucinated = VALID.replace("src/a.ts", "src/otro.ts");
    const result = await reviewWithLLM(fakeProvider(hallucinated), context);
    expect(result.findings).toEqual([]);
    expect(result.warnings[0]).toMatch(/descartaron 1/);
  });
});
