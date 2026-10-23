import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectChanges } from "../src/git.js";
import { installHook, uninstallHook } from "../src/hook.js";

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "guardian-git-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "t");
  git("config", "user.email", "t@t");
  writeFileSync(join(root, "a.js"), "uno\n");
  git("add", ".");
  git("commit", "-qm", "base");
  git("checkout", "-qb", "feature");
  writeFileSync(join(root, "b.js"), "commiteado\n");
  git("add", ".");
  git("commit", "-qm", "feature");
  return root;
}

describe("collectChanges con committedOnly (modo pre-push)", () => {
  it("revisa los commits e ignora lo que no está commiteado", () => {
    const root = makeRepo();
    writeFileSync(join(root, "borrador.js"), "sin commitear\n");

    expect(collectChanges(root, "main").files).toEqual(["borrador.js"]);
    const pushed = collectChanges(root, "main", undefined, true);
    expect(pushed.files).toEqual(["b.js"]);
    expect(pushed.description).toContain("contra main");
  });
});

describe("install-hook / uninstall-hook", () => {
  it("instala un hook que llama a review --pre-push y lo desinstala borrando el archivo", () => {
    const root = makeRepo();
    const path = installHook(root);
    const script = readFileSync(path, "utf8");
    expect(script).toContain("# guardian-hook");
    expect(script).toContain("review --pre-push");

    expect(() => installHook(root)).toThrow(/ya está instalado/);
    uninstallHook(root);
    expect(existsSync(path)).toBe(false);
  });

  it("no pisa ni borra un hook que no es de Guardian", () => {
    const root = makeRepo();
    const path = join(root, ".git", "hooks", "pre-push");
    writeFileSync(path, "#!/bin/sh\necho propio\n");
    expect(() => installHook(root)).toThrow(/no es de Guardian/);
    expect(() => uninstallHook(root)).toThrow(/no lo instaló Guardian/);
    expect(readFileSync(path, "utf8")).toContain("propio");
  });
});
