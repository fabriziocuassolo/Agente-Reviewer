import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { REDACTED, redactSecrets } from "../src/checks/secrets.js";
import { buildContext, findRelativeImports } from "../src/context.js";

const FAKE_KEY = "AIza" + "Sy" + "B".repeat(33);

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "guardian-ctx-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

describe("redactSecrets", () => {
  it("reemplaza el secreto y cuenta cuántos hubo", () => {
    const result = redactSecrets(`const a = "${FAKE_KEY}";\nconst dbPass` + `word = "s3cr3t-v4lue";`);
    expect(result.count).toBe(2);
    expect(result.text).not.toContain(FAKE_KEY);
    expect(result.text).not.toContain("s3cr3t-v4lue");
    expect(result.text).toContain(REDACTED);
  });

  it("no toca código sin secretos", () => {
    const code = "const apiKey = process.env.KEY;";
    expect(redactSecrets(code)).toEqual({ text: code, count: 0 });
  });
});

describe("findRelativeImports", () => {
  it("resuelve imports .js de TypeScript a archivos .ts", () => {
    const root = makeRepo({ "src/a.ts": "", "src/lib/b.ts": "", "src/c/index.ts": "" });
    const content = `import { b } from "./lib/b.js";\nimport c from "./c";\nimport express from "express";`;
    expect(findRelativeImports(root, "src/a.ts", content).sort()).toEqual(["src/c/index.ts", "src/lib/b.ts"]);
  });
});

describe("buildContext", () => {
  const diff = (file: string) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n+x\n`;

  it("incluye convenciones, archivos modificados numerados e imports directos", () => {
    const root = makeRepo({
      "docs/CONVENTIONS.md": "Usar centavos",
      "src/a.ts": 'import { b } from "./b.js";\nb();',
      "src/b.ts": "export function b() {}",
    });
    const ctx = buildContext(root, { description: "", diff: diff("src/a.ts"), files: ["src/a.ts"] }, 50_000);
    expect(ctx.conventions).toBe("Usar centavos");
    expect(ctx.files.map((f) => [f.path, f.reason])).toEqual([
      ["src/a.ts", "modificado"],
      ["src/b.ts", "importado"],
    ]);
    expect(ctx.files[0].content).toContain("   2 | b();");
  });

  it("nunca envía .env y respeta .guardianignore", () => {
    const root = makeRepo({ ".env": "KEY=1", ".guardianignore": "legacy/\n", "legacy/x.ts": "x", "src/a.ts": "a" });
    const files = [".env", "legacy/x.ts", "src/a.ts"];
    const ctx = buildContext(root, { description: "", diff: files.map(diff).join(""), files }, 50_000);
    expect(ctx.files.map((f) => f.path)).toEqual(["src/a.ts"]);
    expect(ctx.omitted).toEqual(expect.arrayContaining([".env", "legacy/x.ts"]));
    expect(ctx.diff).not.toContain(".env");
    expect(ctx.changedFiles).toEqual(["src/a.ts"]);
  });

  it("redacta secretos de los archivos antes de enviarlos", () => {
    const root = makeRepo({ "src/a.ts": `const k = "${FAKE_KEY}";` });
    const ctx = buildContext(root, { description: "", diff: diff("src/a.ts"), files: ["src/a.ts"] }, 50_000);
    expect(ctx.files[0].content).not.toContain(FAKE_KEY);
    expect(ctx.redactions).toBe(1);
  });

  it("omite archivos que no entran en el presupuesto", () => {
    const root = makeRepo({ "src/a.ts": "a".repeat(5000) });
    const ctx = buildContext(root, { description: "", diff: diff("src/a.ts"), files: ["src/a.ts"] }, 1000);
    expect(ctx.files).toEqual([]);
    expect(ctx.omitted).toContain("src/a.ts");
  });
});
