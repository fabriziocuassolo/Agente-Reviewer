#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { ask } from "./ask.js";
import { loadGuardianEnv } from "./env.js";
import { getRepoRoot } from "./git.js";
import { installHook, uninstallHook } from "./hook.js";
import { dismissFinding, MEMORY_PATH } from "./memory.js";
import { renderReport } from "./report.js";
import { runReview } from "./review.js";
import { GuardianError } from "./types.js";

loadGuardianEnv();

const program = new Command();

program
  .name("guardian")
  .description("Revisión de código asistida por IA para equipos de e-commerce")
  .version("0.1.0");

program
  .command("review")
  .description("Revisa los cambios actuales y decide si están listos: APROBADO / ADVERTENCIA / BLOQUEADO")
  .option("--base <ref>", "comparar contra esta rama o commit (por defecto se detecta solo)")
  .option("--json", "salida en JSON para máquinas (CI, GitHub Action)")
  .option("--no-llm", "solo chequeos determinísticos, sin llamar al modelo")
  .option("--record", "graba las respuestas del modelo real en demo/recordings para el modo replay")
  .action(async (options: { base?: string; json?: boolean; llm: boolean; record?: boolean }) => {
    const report = await runReview({ cwd: process.cwd(), base: options.base, llm: options.llm, record: options.record });
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(renderReport(report));
    }
    // Exit code 1 si está bloqueado: así el hook pre-push y la CI pueden cortar.
    process.exitCode = report.decision === "BLOQUEADO" ? 1 : 0;
  });

program
  .command("dismiss")
  .description("Marca un hallazgo de la última revisión como falso positivo y lo guarda en la memoria del equipo")
  .argument("<id>", "ID del hallazgo (ej: G-3f2a1c)")
  .argument("<motivo>", "por qué no aplica (lo va a leer el resto del equipo)")
  .action((id: string, reason: string) => {
    const root = getRepoRoot(process.cwd());
    if (!root) throw new GuardianError("Este directorio no está dentro de un repositorio git.");
    const entry = dismissFinding(root, id, reason);
    console.log(pc.green(`✔ ${entry.id} descartado: "${entry.reason}"`));
    console.log(pc.dim(`  Guardado en ${MEMORY_PATH}. Commitealo para que lo aproveche todo el equipo.`));
  });

program
  .command("ask")
  .description("Responde preguntas sobre el código del proyecto citando archivos y líneas")
  .argument("<pregunta>", "tu pregunta sobre el código")
  .action(async (question: string) => {
    const answer = await ask(question, { cwd: process.cwd() });
    console.log(answer);
  });

program
  .command("install-hook")
  .description("Instala el hook pre-push que ejecuta guardian review antes de cada push")
  .action(() => {
    const root = getRepoRoot(process.cwd());
    if (!root) throw new GuardianError("Este directorio no está dentro de un repositorio git.");
    const path = installHook(root);
    console.log(pc.green(`✔ Hook instalado: ${path}`));
    console.log(pc.dim("  Ahora guardian review se ejecuta automáticamente antes de cada push."));
    console.log(pc.dim("  Para saltear el hook una sola vez: git push --no-verify"));
  });

program
  .command("uninstall-hook")
  .description("Desinstala el hook pre-push de guardian")
  .action(() => {
    const root = getRepoRoot(process.cwd());
    if (!root) throw new GuardianError("Este directorio no está dentro de un repositorio git.");
    uninstallHook(root);
    console.log(pc.green("✔ Hook desinstalado"));
  });

program.parseAsync().catch((error: unknown) => {
  if (error instanceof GuardianError) {
    console.error(pc.red(`✖ ${error.message}`));
  } else {
    console.error(pc.red("✖ Error inesperado:"), error);
  }
  process.exitCode = 2;
});
