import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig } from "../src/config.js";

function repoWithConfig(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "guardian-config-"));
  mkdirSync(join(dir, ".guardian"));
  writeFileSync(join(dir, ".guardian", "config.json"), content);
  return dir;
}

describe("loadConfig", () => {
  it("usa los valores por defecto si no hay config", () => {
    expect(loadConfig(mkdtempSync(join(tmpdir(), "guardian-empty-")))).toEqual(DEFAULT_CONFIG);
  });

  it("combina la config del usuario con los defaults", () => {
    const config = loadConfig(repoWithConfig(JSON.stringify({ checks: { lint: null, test: "npm run test:unit" } })));
    expect(config.checks).toEqual({ timeoutMs: 180_000, lint: null, test: "npm run test:unit" });
    expect(config.gate.rules).toEqual(DEFAULT_CONFIG.gate.rules);
  });

  it("rechaza reglas inválidas con un mensaje claro", () => {
    const dir = repoWithConfig(JSON.stringify({ gate: { rules: [{ name: "x", severity: "grave", min: 1, decision: "BLOQUEADO" }] } }));
    expect(() => loadConfig(dir)).toThrow(/gate\.rules\.0\.severity/);
  });

  it("rechaza JSON mal formado", () => {
    expect(() => loadConfig(repoWithConfig("{ nope"))).toThrow(/no es un JSON válido/);
  });
});
