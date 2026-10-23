#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { ask } from "./ask.js";
import { addFixedRule, CONFIG_PATH } from "./config.js";
import { startChat } from "./chat.js";
import { join } from "node:path";
import { GUARDIAN_HOME, loadGuardianEnv } from "./env.js";
import { getRepoRoot, git } from "./git.js";
import { COMMAND_EXAMPLES, mainGuide, otherAIGuide } from "./guide.js";
import { installHook, uninstallHook } from "./hook.js";
import { providersStatus } from "./llm/provider.js";
import { dismissFinding, forgetRule, learnRule, loadLearned, MEMORY_PATH } from "./memory.js";
import { findProject } from "./project.js";
import { renderReport } from "./report.js";
import { runReview } from "./review.js";
import { GuardianError } from "./types.js";

loadGuardianEnv();

const USE_HELP =
  "qué IA usar: replay (grabada, por defecto) · ia o gemini (nube) · local u ollama (tu máquina). " +
  "Si no está lista, te explica cómo configurarla";

// Títulos de la ayuda de commander, en castellano.
const HELP_TITLES: Record<string, string> = {
  "Usage:": "Uso:",
  "Options:": "Opciones:",
  "Arguments:": "Argumentos:",
  "Commands:": "Comandos:",
};

const program = new Command();

program
  .name("guardian")
  .description("Revisión de código asistida por IA para equipos de e-commerce")
  .version("0.1.0", "-V, --version", "muestra la versión")
  .helpOption("-h, --help", "muestra la ayuda")
  .helpCommand(false) // `guardian help` lo maneja la guía de abajo
  .configureHelp({ styleTitle: (title) => HELP_TITLES[title] ?? title });

program
  .command("review")
  .description("Revisa los cambios actuales y decide si están listos: APROBADO / ADVERTENCIA / BLOQUEADO")
  .option("--use <ia>", USE_HELP)
  .option("--model <nombre>", "modelo a usar con esa IA (ej: qwen2.5-coder:14b, gemini-3.8-flash)")
  .option("--base <ref>", "comparar contra esta rama o commit (por defecto se detecta solo)")
  .option("--json", "salida en JSON para máquinas (CI, GitHub Action)")
  .option("--no-llm", "sin IA: solo los controles automáticos (rápido, gratis, sin internet)")
  .option("--record", "graba las respuestas del modelo real en demo/recordings para el modo replay")
  .option("--pre-push", "revisa solo los commits (no los cambios sin commitear); lo usa el hook")
  .action(async (options: { base?: string; json?: boolean; llm: boolean; record?: boolean; prePush?: boolean; use?: string; model?: string }) => {
    const report = await runReview({
      cwd: process.cwd(),
      base: options.base,
      llm: options.llm,
      record: options.record,
      committedOnly: options.prePush,
      use: options.use,
      model: options.model,
    });
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
  .command("aprender")
  .description("Le enseña una regla a Guardian: se la pasa a cualquier IA en cada revisión")
  .argument("[regla]", 'la regla en tus palabras, ej: "Los precios nunca se calculan en el frontend"')
  .option("--archivos <patrones>", 'solo para estos archivos, separados por coma (ej: "public/**,*.html")')
  .option("--patron <regex>", 'regla FIJA: un patrón que se detecta siempre, sin IA (ej: "<script>")')
  .option("--severidad <nivel>", "para reglas fijas: critico | alto | medio | bajo (por defecto alto)")
  .option("--lista", "muestra las reglas aprendidas")
  .option("--borrar <numero>", "borra la regla con ese número (ver --lista)")
  .action((regla: string | undefined, options: { archivos?: string; patron?: string; severidad?: string; lista?: boolean; borrar?: string }) => {
    const root = getRepoRoot(process.cwd());
    if (!root) throw new GuardianError("Este directorio no está dentro de un repositorio git.");
    const pending = git(["status", "--porcelain"], root)
      .split("\n")
      .map((l) => l.slice(3).trim())
      .filter(Boolean);
    const project = findProject(root, process.cwd(), pending);
    const where = `${project.prefix}${MEMORY_PATH}`;

    if (options.borrar) {
      const removed = forgetRule(project.dir, Number(options.borrar));
      console.log(pc.green(`✔ Regla borrada: "${removed.regla}"`));
      return;
    }
    if (options.lista || !regla) {
      const rules = loadLearned(project.dir);
      if (rules.length === 0) {
        console.log(pc.dim(`Todavía no hay reglas aprendidas en ${where}.`));
        console.log(pc.dim('Enseñale una:  guardian aprender "Toda función nueva de precios lleva tests"'));
        return;
      }
      console.log(pc.bold(`\nReglas aprendidas (${where})\n`));
      rules.forEach((r, i) => console.log(`  ${i + 1}. ${r.regla}${r.archivos ? pc.dim(`  [${r.archivos.join(", ")}]`) : ""}`));
      console.log(pc.dim("\nPara borrar una:  guardian aprender --borrar <número>\n"));
      return;
    }
    const archivos = options.archivos?.split(",").map((p) => p.trim()).filter(Boolean);

    // Con --patron es una regla FIJA: va a config.json y se detecta siempre, sin depender de la IA.
    if (options.patron) {
      const fixed = addFixedRule(project.dir, { mensaje: regla, buscar: options.patron, archivos, severidad: options.severidad });
      console.log(pc.green(`✔ Regla fija "${fixed.nombre}": se detecta SIEMPRE, con cualquier IA o sin IA.`));
      console.log(pc.dim(`  Busca /${fixed.buscar}/ en las líneas nuevas${fixed.archivos ? ` de ${fixed.archivos.join(", ")}` : ""} · severidad ${fixed.severidad}`));
      console.log(pc.dim(`  Guardada en ${project.prefix}${CONFIG_PATH}. Commitealo para que la use todo el equipo.`));
      return;
    }

    const rule = learnRule(project.dir, regla, archivos);
    console.log(pc.green(`✔ Aprendido: "${rule.regla}"${rule.archivos ? ` (en ${rule.archivos.join(", ")})` : ""}`));
    console.log(pc.dim(`  Guardado en ${where}. Desde la próxima revisión la usa cualquier IA (Gemini, Ollama u otra).`));
    console.log(pc.dim("  Commitealo para que lo aproveche todo el equipo."));
  });

program
  .command("chat")
  .description("Charla sobre el código en la terminal: preguntás, repreguntás y cita archivo:línea")
  .option("--use <ia>", "ia (Gemini) | local (Ollama) | una IA tuya del .env")
  .option("--model <nombre>", "modelo a usar con esa IA")
  .action(async (options: { use?: string; model?: string }) => {
    await startChat({ cwd: process.cwd(), use: options.use, model: options.model });
  });

program
  .command("ask")
  .description("Una pregunta suelta sobre el código (sin pregunta abre el chat)")
  .argument("[pregunta]", "tu pregunta sobre el código; si no ponés nada, se abre el chat")
  .option("--use <ia>", "ia (Gemini) | local (Ollama) | una IA tuya del .env")
  .option("--model <nombre>", "modelo a usar con esa IA")
  .action(async (question: string | undefined, options: { use?: string; model?: string }) => {
    if (!question) {
      await startChat({ cwd: process.cwd(), use: options.use, model: options.model });
      return;
    }
    const started = Date.now();
    const result = await ask(question, { cwd: process.cwd(), use: options.use, model: options.model });
    console.log(`\n${result.answer}\n`);
    if (result.sources.length > 0) {
      console.log(pc.dim(`Archivos consultados: ${result.sources.join(", ")}`));
    }
    const tokens = result.inputTokens ? ` · ${result.inputTokens} tokens de entrada / ${result.outputTokens ?? 0} de salida` : "";
    console.log(pc.dim(`Tiempo: ${((Date.now() - started) / 1000).toFixed(1)} s${tokens}\n`));
  });

program
  .command("ia")
  .description("Muestra qué IA está activa y si cada opción (replay, gemini, ollama) está lista")
  .action(async () => {
    const statuses = await providersStatus();
    console.log(pc.bold("\nIA para las revisiones\n"));
    for (const s of statuses) {
      const icon = s.ready ? pc.green("✔") : pc.yellow("–");
      const active = s.active ? pc.cyan(" ← activa por defecto") : "";
      console.log(`  ${icon} ${pc.bold(s.name.padEnd(7))}${active}\n      ${pc.dim(s.detail)}`);
    }
    console.log(pc.dim("\nCambiala para un comando:   guardian review --use gemini   |   --use ollama   |   --use replay"));
    console.log(pc.dim("Cambiala por defecto:       LLM_PROVIDER=... en el archivo .env de Guardian\n"));
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

// Cada comando muestra ejemplos al final de `guardian <comando> --help`.
for (const command of program.commands) {
  command.helpOption("-h, --help", "muestra la ayuda de este comando");
  command.usage(command.usage().replace("[options]", "[opciones]"));
  const examples = COMMAND_EXAMPLES[command.name()];
  if (examples) command.addHelpText("after", examples);
}

// `guardian`, `guardian --help` y `guardian help` muestran la guía completa para principiantes.
// `guardian help review` muestra la ayuda de ese comando.
const args = process.argv.slice(2);
if (args.length === 0 || (args.length === 1 && ["--help", "-h", "help", "ayuda"].includes(args[0]))) {
  console.log(mainGuide());
  process.exit(0);
}
// `guardian ayuda otra-ia` (también `help otra-ia`, `--help otra-ia` o `otra-ia`): cómo agregar cualquier IA.
const OTHER_AI_TOPICS = ["otra-ia", "otras-ia", "otra", "llm", "agregar-ia"];
if (OTHER_AI_TOPICS.includes(args[0]) || (["--help", "-h", "help", "ayuda"].includes(args[0]) && OTHER_AI_TOPICS.includes(args[1]))) {
  console.log(otherAIGuide(join(GUARDIAN_HOME, ".env")));
  process.exit(0);
}
if (args[0] === "help" || args[0] === "ayuda") {
  process.argv.splice(2, 1);
  process.argv.push("--help");
}

program.parseAsync().catch((error: unknown) => {
  if (error instanceof GuardianError) {
    console.error(pc.red(`✖ ${error.message}`));
  } else {
    console.error(pc.red("✖ Error inesperado:"), error);
  }
  process.exitCode = 2;
});
