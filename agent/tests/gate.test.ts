import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, type GateRule } from "../src/config.js";
import { decide } from "../src/gate.js";
import type { Finding, Severity } from "../src/types.js";

function findings(...severities: Severity[]): Finding[] {
  return severities.map((severity, i) => ({
    id: `G-${i}`,
    file: "a.ts",
    line: i + 1,
    severity,
    category: "test",
    explanation: "",
    suggestion: "",
    source: "llm",
  }));
}

describe("decide (reglas por defecto)", () => {
  it("aprueba sin hallazgos", () => {
    expect(decide([], DEFAULT_RULES)).toMatchObject({ decision: "APROBADO", rule: null });
  });

  it("aprueba si solo hay hallazgos bajos", () => {
    expect(decide(findings("bajo", "bajo"), DEFAULT_RULES).decision).toBe("APROBADO");
  });

  it("bloquea con un crítico", () => {
    expect(decide(findings("critico"), DEFAULT_RULES)).toMatchObject({ decision: "BLOQUEADO", rule: "critico-bloquea" });
  });

  it("bloquea con 3 altos", () => {
    expect(decide(findings("alto", "alto", "alto"), DEFAULT_RULES)).toMatchObject({
      decision: "BLOQUEADO",
      rule: "muchos-altos-bloquean",
    });
  });

  it("advierte con 2 altos", () => {
    expect(decide(findings("alto", "alto"), DEFAULT_RULES)).toMatchObject({ decision: "ADVERTENCIA", rule: "alto-advierte" });
  });

  it("advierte con un medio", () => {
    expect(decide(findings("medio", "bajo"), DEFAULT_RULES)).toMatchObject({ decision: "ADVERTENCIA", rule: "medio-advierte" });
  });

  it("explica la regla aplicada", () => {
    expect(decide(findings("critico", "critico"), DEFAULT_RULES).reason).toBe(
      "2 hallazgos críticos (la regla exige 1 o más)",
    );
  });
});

describe("decide (reglas personalizadas)", () => {
  it("BLOQUEADO gana aunque esté después en la lista", () => {
    const rules: GateRule[] = [
      { name: "medio-advierte", severity: "medio", min: 1, decision: "ADVERTENCIA" },
      { name: "medios-bloquean", severity: "medio", min: 2, decision: "BLOQUEADO" },
    ];
    expect(decide(findings("medio", "medio"), rules).rule).toBe("medios-bloquean");
  });
});
