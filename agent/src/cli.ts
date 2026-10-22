#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { loadGuardianEnv } from "./env.js";
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
  .action(async (options: { base?: string; json?: boolean; llm: boolean }) => {
    const report = await runReview({ cwd: process.cwd(), base: options.base, llm: options.llm });
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(renderReport(report));
    }
    // Exit code 1 si está bloqueado: así el hook pre-push y la CI pueden cortar.
    process.exitCode = report.decision === "BLOQUEADO" ? 1 : 0;
  });

program.parseAsync().catch((error: unknown) => {
  if (error instanceof GuardianError) {
    console.error(pc.red(`✖ ${error.message}`));
  } else {
    console.error(pc.red("✖ Error inesperado:"), error);
  }
  process.exitCode = 2;
});
