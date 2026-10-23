import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GuardianError } from "./types.js";

const HOOK_NAME = "pre-push";
const HOOK_MARKER = "# guardian-hook";

const HOOK_SCRIPT = `#!/bin/sh
${HOOK_MARKER}
# Ejecuta guardian review antes de cada push.
# Si está bloqueado (exit code 1), el push se cancela.
# Para saltear el hook una sola vez: git push --no-verify

set -e
guardian review
`;

export function installHook(repoRoot: string): string {
  const hooksDir = join(repoRoot, ".git", "hooks");
  const hookPath = join(hooksDir, HOOK_NAME);

  if (!existsSync(join(repoRoot, ".git"))) {
    throw new GuardianError("Este directorio no es la raíz de un repositorio git.");
  }

  if (existsSync(hookPath)) {
    const content = readFileSync(hookPath, "utf8");
    if (content.includes(HOOK_MARKER)) {
      throw new GuardianError(`El hook ${HOOK_NAME} ya está instalado.`);
    }
    throw new GuardianError(
      `Ya existe un hook ${HOOK_NAME} en este repo. Si querés reemplazarlo, borralo primero con guardian uninstall-hook.`,
    );
  }

  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(hookPath, HOOK_SCRIPT, { mode: 0o755 });
  return hookPath;
}

export function uninstallHook(repoRoot: string): string {
  const hookPath = join(repoRoot, ".git", "hooks", HOOK_NAME);

  if (!existsSync(hookPath)) {
    throw new GuardianError(`No hay un hook ${HOOK_NAME} instalado.`);
  }

  const content = readFileSync(hookPath, "utf8");
  if (!content.includes(HOOK_MARKER)) {
    throw new GuardianError(
      `El hook ${HOOK_NAME} existe pero no fue instalado por guardian. No lo borro por seguridad; hacelo manualmente si es necesario.`,
    );
  }

  writeFileSync(hookPath, "");
  return hookPath;
}
