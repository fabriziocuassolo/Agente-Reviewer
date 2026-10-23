import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { git } from "./git.js";
import { GuardianError } from "./types.js";

const HOOK_NAME = "pre-push";
// Marca para reconocer un hook instalado por Guardian (y no tocar hooks ajenos).
const HOOK_MARKER = "# guardian-hook";

/**
 * Script del hook. Usa rutas absolutas a node y al CLI (grabadas al instalar) para
 * no depender del PATH con el que git ejecuta los hooks (en Windows suele ser distinto).
 *
 * Si Guardian no está disponible, AVISA y deja pushear (fail-open): una herramienta de
 * apoyo no debería trabar al equipo por estar mal instalada. Si el resultado es BLOQUEADO
 * (exit 1), el push se cancela.
 */
function hookScript(nodePath: string, cliPath: string): string {
  const node = nodePath.replace(/\\/g, "/");
  const cli = cliPath.replace(/\\/g, "/");
  return `#!/bin/sh
${HOOK_MARKER}
# Instalado con \`guardian install-hook\`. Para saltearlo una vez: git push --no-verify
NODE="${node}"
CLI="${cli}"

if [ ! -f "$CLI" ] || [ ! -f "$NODE" ]; then
  echo "guardian: no encuentro el CLI en $CLI; se pushea sin revisar (reinstalá el hook)." >&2
  exit 0
fi

"$NODE" "$CLI" review --pre-push
status=$?
if [ $status -eq 1 ]; then
  echo "" >&2
  echo "guardian: push cancelado porque el cambio está BLOQUEADO." >&2
  echo "Corregí los hallazgos o, si es un falso positivo, usá guardian dismiss <id> \\"<motivo>\\"." >&2
  exit 1
fi
if [ $status -ne 0 ]; then
  echo "guardian: la revisión falló (código $status); se pushea igual." >&2
fi
exit 0
`;
}

/** Carpeta de hooks real (funciona también con worktrees y core.hooksPath). */
function hooksDir(repoRoot: string): string {
  const dir = git(["rev-parse", "--git-path", "hooks"], repoRoot).trim();
  return isAbsolute(dir) ? dir : join(repoRoot, dir);
}

export function installHook(repoRoot: string): string {
  const dir = hooksDir(repoRoot);
  const hookPath = join(dir, HOOK_NAME);

  if (existsSync(hookPath)) {
    const content = readFileSync(hookPath, "utf8");
    if (content.includes(HOOK_MARKER)) throw new GuardianError(`El hook ${HOOK_NAME} ya está instalado (${hookPath}).`);
    throw new GuardianError(
      `Ya existe un hook ${HOOK_NAME} que no es de Guardian (${hookPath}). No lo piso: agregá a mano la línea \`guardian review --pre-push\`.`,
    );
  }

  const cliPath = fileURLToPath(new URL("./cli.js", import.meta.url));
  mkdirSync(dir, { recursive: true });
  writeFileSync(hookPath, hookScript(process.execPath, cliPath), { mode: 0o755 });
  return hookPath;
}

export function uninstallHook(repoRoot: string): string {
  const hookPath = join(hooksDir(repoRoot), HOOK_NAME);
  if (!existsSync(hookPath)) throw new GuardianError(`No hay un hook ${HOOK_NAME} instalado.`);

  if (!readFileSync(hookPath, "utf8").includes(HOOK_MARKER)) {
    throw new GuardianError(`El hook ${HOOK_NAME} no lo instaló Guardian: no lo borro (${hookPath}).`);
  }
  unlinkSync(hookPath);
  return hookPath;
}
