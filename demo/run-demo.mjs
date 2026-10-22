#!/usr/bin/env node
// Corre los escenarios de demo sin ensuciar el repo:
//   npm run demo -- 02-pricing-float      → un escenario
//   npm run demo -- all                   → todos, con resumen final
//   npm run demo -- all --record          → idem, grabando las respuestas del LLM real
//
// Para cada escenario: copia storefront-demo a .demo-work/<escenario> (ignorado por git),
// la convierte en un repo con un commit base, aplica el patch y ejecuta `guardian review`.
// La copia queda DENTRO del repo para que Node encuentre el node_modules de la raíz
// (ESLint, tsc y vitest funcionan sin reinstalar nada).
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(ROOT, "agent", "dist", "cli.js");
const SCENARIOS_DIR = join(ROOT, "demo", "scenarios");
const WORK_DIR = join(ROOT, ".demo-work");
const scenarios = JSON.parse(readFileSync(join(SCENARIOS_DIR, "scenarios.json"), "utf8"));

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("-"));
const reviewFlags = args.filter((a) => a.startsWith("-")); // --record, --no-llm, etc.

if (!existsSync(CLI)) {
  console.error("No encuentro agent/dist/cli.js. Corré `npm install` en la raíz (compila el CLI).");
  process.exit(2);
}
if (!target) {
  console.log("Uso: npm run demo -- <escenario|all> [--record] [--no-llm]\n\nEscenarios:");
  for (const s of scenarios) console.log(`  ${s.id.padEnd(18)} ${s.title}`);
  process.exit(0);
}

const selected = target === "all" ? scenarios : scenarios.filter((s) => s.id === target);
if (selected.length === 0) {
  console.error(`Escenario desconocido: "${target}". Opciones: ${scenarios.map((s) => s.id).join(", ")}, all`);
  process.exit(2);
}

// renderReport se reutiliza del CLI compilado para mostrar exactamente la misma salida.
const { renderReport } = await import(new URL("../agent/dist/report.js", import.meta.url));

const results = [];
for (const scenario of selected) {
  console.log(`\n━━━ Escenario ${scenario.id}: ${scenario.title} ━━━`);
  const dir = prepareWorkdir(scenario.id);
  const started = Date.now();
  const report = runGuardian(dir, scenario.id);
  if (!report) {
    results.push({ scenario, decision: "ERROR", findings: 0, ms: Date.now() - started });
    continue;
  }
  console.log(renderReport(report));
  results.push({
    scenario,
    decision: report.decision,
    findings: report.findings.length,
    ms: Date.now() - started,
    note: report.llm?.failed ? "la IA no pudo revisar" : report.llm ? "" : "sin IA",
  });
}

if (results.length > 1) printSummary(results);

// ---------------------------------------------------------------------------

function prepareWorkdir(id) {
  const dir = join(WORK_DIR, id);
  rmSync(dir, { recursive: true, force: true });
  cpSync(join(ROOT, "storefront-demo"), dir, {
    recursive: true,
    filter: (src) => basename(src) !== "node_modules",
  });

  const git = (...gitArgs) => execFileSync("git", gitArgs, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  git("config", "core.autocrlf", "false"); // los patches usan LF
  git("config", "user.name", "Guardian Demo");
  git("config", "user.email", "demo@guardian.local");
  git("add", "-A");
  git("commit", "-q", "-m", "Estado base de la tienda");
  git("apply", join(SCENARIOS_DIR, `${id}.patch`));
  return dir;
}

function runGuardian(dir, id) {
  const child = spawnSync(process.execPath, [CLI, "review", "--json", ...reviewFlags], {
    cwd: dir,
    // GUARDIAN_RECORDING le dice a replay/--record qué grabación usar.
    env: { ...process.env, GUARDIAN_RECORDING: id },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 20 * 1024 * 1024,
  });
  try {
    return JSON.parse(child.stdout);
  } catch {
    console.error(`No se pudo leer la salida de guardian (exit ${child.status}):\n${child.stdout}`);
    return null;
  }
}

function printSummary(rows) {
  console.log("\n━━━ Resumen ━━━\n");
  console.log(`  ${"Escenario".padEnd(18)} ${"Esperado".padEnd(24)} ${"Obtenido".padEnd(12)} Hallazgos  Tiempo`);
  let ok = 0;
  for (const { scenario, decision, findings, ms, note } of rows) {
    const matches = scenario.expected.includes(decision);
    if (matches) ok++;
    console.log(
      `${matches ? "✔" : "✖"} ${scenario.id.padEnd(18)} ${scenario.expected.join(" o ").padEnd(24)} ${decision.padEnd(12)} ${String(findings).padStart(9)}  ${(ms / 1000).toFixed(1).padStart(4)} s  ${note ?? ""}`,
    );
  }
  console.log(`\n${ok}/${rows.length} escenarios con la decisión esperada.`);
}
