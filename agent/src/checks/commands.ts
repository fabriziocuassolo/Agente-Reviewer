import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GuardianConfig } from "../config.js";
import { makeFindingId, type CheckResult, type Finding, type Severity } from "../types.js";

interface CommandCheck {
  name: string;
  command: string;
  /** Severidad del hallazgo si el comando falla. */
  severity: Severity;
  category: string;
}

/**
 * Decide qué comandos correr en el repo revisado.
 * Si config.json no dice nada, se autodetectan desde los scripts de package.json.
 */
export function resolveCommandChecks(
  root: string,
  config: GuardianConfig,
): { checks: CommandCheck[]; skipped: CheckResult[] } {
  const scripts = readScripts(root);
  const hasTsconfig = existsSync(join(root, "tsconfig.json"));

  const autodetected = {
    lint: scripts.lint ? "npm run lint --silent" : null,
    typecheck: scripts.typecheck ? "npm run typecheck --silent" : hasTsconfig ? "npx --no-install tsc --noEmit" : null,
    test: scripts.test && !scripts.test.includes("no test specified") ? "npm test --silent" : null,
  };

  // Severidades: código que no compila o tests rotos bloquean; el lint advierte.
  const definitions = [
    { key: "lint", name: "ESLint", severity: "alto", category: "lint" },
    { key: "typecheck", name: "Tipos (TypeScript)", severity: "critico", category: "tipos" },
    { key: "test", name: "Tests", severity: "critico", category: "tests" },
  ] as const;

  const checks: CommandCheck[] = [];
  const skipped: CheckResult[] = [];
  for (const def of definitions) {
    const configured = config.checks[def.key];
    const command = configured === undefined ? autodetected[def.key] : configured;
    if (command) {
      checks.push({ name: def.name, command, severity: def.severity, category: def.category });
    } else {
      const reason = configured === null ? "desactivado en config.json" : "no se encontró configuración en el proyecto";
      skipped.push({ name: def.name, status: "omitido", durationMs: 0, detail: reason });
    }
  }
  return { checks, skipped };
}

function readScripts(root: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

/** Ejecuta todos los chequeos EN PARALELO (el total tarda lo que el más lento). */
export async function runCommandChecks(
  root: string,
  checks: CommandCheck[],
  timeoutMs: number,
): Promise<{ results: CheckResult[]; findings: Finding[] }> {
  const outcomes = await Promise.all(checks.map((check) => runOne(root, check, timeoutMs)));
  return {
    results: outcomes.map((o) => o.result),
    findings: outcomes.flatMap((o) => (o.finding ? [o.finding] : [])),
  };
}

async function runOne(root: string, check: CommandCheck, timeoutMs: number) {
  const started = Date.now();
  const { exitCode, output, timedOut } = await runCommand(check.command, root, timeoutMs);
  const durationMs = Date.now() - started;

  if (exitCode === 0) {
    return { result: { name: check.name, status: "ok", durationMs, detail: check.command } as CheckResult };
  }

  const excerpt = lastLines(output, 20);
  const finding: Finding = {
    id: makeFindingId("comando", check.category),
    file: null,
    line: null,
    severity: check.severity,
    category: check.category,
    explanation: timedOut
      ? `\`${check.command}\` superó el tiempo máximo (${Math.round(timeoutMs / 1000)} s).`
      : `\`${check.command}\` terminó con errores:\n${excerpt}`,
    suggestion: `Corré \`${check.command}\` localmente y corregí los errores antes de pushear.`,
    source: "deterministico",
  };
  return { result: { name: check.name, status: "fallo", durationMs, detail: check.command } as CheckResult, finding };
}

/** Corre un comando de shell y junta stdout + stderr. */
function runCommand(command: string, cwd: string, timeoutMs: number) {
  return new Promise<{ exitCode: number; output: string; timedOut: boolean }>((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      // CI=true evita modos interactivos/watch; sin colores para poder leer la salida.
      env: { ...process.env, CI: "true", FORCE_COLOR: "0", NO_COLOR: "1" },
    });
    let output = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, output, timedOut });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, output: error.message, timedOut });
    });
  });
}

/** Con shell: true hay que matar también los procesos hijos (en Windows, con taskkill). */
function killTree(pid: number | undefined) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"]);
  } else {
    process.kill(pid, "SIGKILL");
  }
}

function lastLines(text: string, count: number): string {
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
  return clean.split(/\r?\n/).filter((l) => l.trim() !== "").slice(-count).join("\n");
}
