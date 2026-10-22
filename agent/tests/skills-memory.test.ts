import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import {
  applyMemory,
  dismissFinding,
  LAST_REVIEW_PATH,
  loadMemory,
  relevantExceptions,
  saveLastReview,
  type MemoryEntry,
} from "../src/memory.js";
import { buildPrompt } from "../src/reviewer.js";
import { loadSkills } from "../src/skills.js";
import type { Finding, ReviewReport } from "../src/types.js";

function makeRepo(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "guardian-sm-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function finding(overrides: Partial<Finding>): Finding {
  return {
    id: "G-aaaaaa",
    file: "src/a.ts",
    line: 1,
    severity: "medio",
    category: "tests",
    explanation: "Falta un test",
    suggestion: "Agregalo",
    source: "llm",
    ...overrides,
  };
}

function reportWith(findings: Finding[]): ReviewReport {
  return {
    decision: "ADVERTENCIA",
    gate: { decision: "ADVERTENCIA", rule: null, reason: "" },
    changes: { description: "", files: [] },
    checks: [],
    findings,
    dismissed: [],
    warnings: [],
    timings: [],
  };
}

describe("loadSkills", () => {
  const files = {
    ".guardian/skills/pricing.md": "reglas de precios",
    ".guardian/skills/frontend.md": "reglas de frontend",
  };

  it("carga solo las skills cuyos patrones coinciden con los archivos cambiados", () => {
    const root = makeRepo(files);
    const config = { ...DEFAULT_CONFIG, skills: { pricing: ["src/services/pricing.ts"], frontend: ["public/**"] } };
    const { skills } = loadSkills(root, config, ["src/services/pricing.ts", "README.md"]);
    expect(skills.map((s) => s.name)).toEqual(["pricing"]);
    expect(skills[0]).toMatchObject({ content: "reglas de precios", matchedFiles: ["src/services/pricing.ts"] });
  });

  it("sin mapeo en config carga todas las skills", () => {
    const { skills } = loadSkills(makeRepo(files), DEFAULT_CONFIG, ["x.ts"]);
    expect(skills.map((s) => s.name).sort()).toEqual(["frontend", "pricing"]);
  });

  it("avisa si el config menciona una skill que no existe", () => {
    const config = { ...DEFAULT_CONFIG, skills: { inexistente: ["**/*"] } };
    expect(loadSkills(makeRepo(files), config, ["a.ts"]).warnings[0]).toMatch(/inexistente/);
  });
});

describe("dismiss y memoria", () => {
  it("guarda el hallazgo descartado con su motivo", () => {
    const root = makeRepo();
    saveLastReview(root, reportWith([finding({ id: "G-111111" })]));
    const entry = dismissFinding(root, "G-111111", "Los tests llegan en el próximo PR");
    expect(entry).toMatchObject({ id: "G-111111", file: "src/a.ts", category: "tests", reason: "Los tests llegan en el próximo PR" });
    expect(loadMemory(root)).toEqual([entry]);
  });

  it("falla con un mensaje claro si el ID no está en la última revisión", () => {
    const root = makeRepo();
    saveLastReview(root, reportWith([finding({ id: "G-111111" })]));
    expect(() => dismissFinding(root, "G-999999", "motivo largo")).toThrow(/G-111111/);
  });

  it("no permite descartar tests o tipos rotos", () => {
    const root = makeRepo();
    saveLastReview(root, reportWith([finding({ id: "G-222222", source: "deterministico", category: "tests" })]));
    expect(() => dismissFinding(root, "G-222222", "no me importa")).toThrow(/no se descartan/);
  });

  it("exige un motivo", () => {
    const root = makeRepo();
    saveLastReview(root, reportWith([finding({ id: "G-111111" })]));
    expect(() => dismissFinding(root, "G-111111", "ok")).toThrow(/motivo/);
  });

  it("pide correr review primero si no hay revisión previa", () => {
    const root = makeRepo();
    expect(existsSync(join(root, LAST_REVIEW_PATH))).toBe(false);
    expect(() => dismissFinding(root, "G-1", "motivo largo")).toThrow(/guardian review/);
  });

  it("applyMemory oculta los hallazgos descartados", () => {
    const memory = [{ id: "G-111111" }] as MemoryEntry[];
    const { kept, hidden } = applyMemory([finding({ id: "G-111111" }), finding({ id: "G-333333" })], memory);
    expect(kept.map((f) => f.id)).toEqual(["G-333333"]);
    expect(hidden.map((f) => f.id)).toEqual(["G-111111"]);
  });

  it("solo pasa al prompt las excepciones de los archivos del cambio", () => {
    const memory = [
      { id: "1", file: "src/a.ts" },
      { id: "2", file: "src/b.ts" },
      { id: "3", file: null },
    ] as MemoryEntry[];
    expect(relevantExceptions(memory, ["src/a.ts"]).map((m) => m.id)).toEqual(["1", "3"]);
  });

  it("el prompt incluye skills y excepciones conocidas", () => {
    const root = makeRepo();
    saveLastReview(root, reportWith([finding({ id: "G-111111" })]));
    const entry = dismissFinding(root, "G-111111", "Se testea en integración");
    const prompt = buildPrompt(
      { diff: "", files: [], conventions: null, omitted: [], redactions: 0, changedFiles: ["src/a.ts"] },
      { skills: [{ name: "pricing", content: "usar centavos", matchedFiles: ["src/a.ts"] }], exceptions: [entry] },
    );
    expect(prompt).toContain("## Criterios de revisión: pricing");
    expect(prompt).toContain("usar centavos");
    expect(prompt).toContain("## Excepciones conocidas");
    expect(prompt).toContain("Se testea en integración");
  });

  it("memory.json se escribe como JSON legible", () => {
    const root = makeRepo();
    saveLastReview(root, reportWith([finding({ id: "G-111111" })]));
    dismissFinding(root, "G-111111", "motivo de prueba");
    const raw = readFileSync(join(root, ".guardian/memory.json"), "utf8");
    expect(JSON.parse(raw).dismissed).toHaveLength(1);
    expect(raw).toContain('\n  "dismissed"');
  });
});
