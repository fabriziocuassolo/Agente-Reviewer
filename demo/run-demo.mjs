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

// Primer argumento suelto = escenario; el resto se le pasa a `guardian review`
// (--record, --no-llm, --use ollama, --model qwen2.5-coder:14b...).
const FLAGS_WITH_VALUE = new Set(["--use", "--model", "--base"]);
const args = process.argv.slice(2);
let target;
const reviewFlags = [];
for (let i = 0; i < args.length; i++) {
  if (FLAGS_WITH_VALUE.has(args[i])) {
    reviewFlags.push(args[i], args[++i]);
  } else if (args[i].startsWith("-")) {
    reviewFlags.push(args[i]);
  } else if (!target) {
    target = args[i];
  }
}
// La demo es reproducible: usa replay salvo que pidas otra IA con --use
// (aunque tengas guardada otra IA como preferencia personal).
if (!reviewFlags.includes("--use")) reviewFlags.push("--use", process.env.LLM_PROVIDER || "replay");

if (!existsSync(CLI)) {
  console.error("No encuentro agent/dist/cli.js. Corré `npm install` en la raíz (compila el CLI).");
  process.exit(2);
}
if (!target) {
  console.log(
    "Uso: npm run demo -- <escenario|all|sandbox> [--use replay|gemini|ollama] [--model <nombre>] [--record] [--no-llm]\n\nEscenarios:",
  );
  for (const s of scenarios) console.log(`  ${s.id.padEnd(18)} ${s.title}`);
  console.log(`  ${"sandbox".padEnd(18)} Copia limpia de la tienda para probar tus propios cambios`);
  process.exit(0);
}

// sandbox: copia limpia (sin patch) para experimentar a mano con guardian review.
if (target === "sandbox") {
  const dir = prepareWorkdir("sandbox", null);
  console.log(`Copia limpia lista en: ${dir}`);
  console.log("Editá cualquier archivo ahí y después corré, dentro de esa carpeta: guardian review");
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

function prepareWorkdir(id, patch = `${id}.patch`) {
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
  if (patch) git("apply", join(SCENARIOS_DIR, patch));
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
