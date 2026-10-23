#!/usr/bin/env node
import { Command } from "commander";
import { join } from "node:path";
import pc from "picocolors";
import { askCommand, iaCommand, reviewCommand, type ReviewCliOptions } from "./actions.js";
import { addFixedRule, CONFIG_PATH } from "./config.js";
import { GUARDIAN_HOME, loadGuardianEnv } from "./env.js";
import { getRepoRoot, git } from "./git.js";
import { COMMAND_EXAMPLES, mainGuide, otherAIGuide } from "./guide.js";
import { installHook, uninstallHook } from "./hook.js";
import { dismissFinding, forgetRule, learnRule, loadLearned, MEMORY_PATH } from "./memory.js";
import { choose, isInteractive, terminalAsker } from "./menu.js";
import { routeNaturalLanguage } from "./nl.js";
import { findProject } from "./project.js";
import { GuardianError } from "./types.js";

loadGuardianEnv();

const USE_HELP =
  "qué IA usar: replay · ia o gemini (nube) · local u ollama (tu máquina) · claude, chatgpt, grok u otra tuya. " +
  "Si no ponés nada, usa la que elegiste en el menú";

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
  .option("--corregir", "intenta corregir automáticamente los problemas (te muestra los cambios y decidís)")
  .option("--base <ref>", "comparar contra esta rama o commit (por defecto se detecta solo)")
  .option("--json", "salida en JSON para máquinas (CI, GitHub Action)")
  .option("--no-llm", "sin IA: solo los controles automáticos (rápido, gratis, sin internet)")
  .option("--record", "graba las respuestas del modelo real en demo/recordings para el modo replay")
  .option("--pre-push", "revisa solo los commits (no los cambios sin commitear); lo usa el hook")
  .action(async (options: ReviewCliOptions) => {
    await reviewCommand(options);
  });

program
  .command("chat")
  .description("Charla sobre el código en la terminal: preguntás, repreguntás y cita archivo:línea")
  .option("--use <ia>", USE_HELP)
  .option("--model <nombre>", "modelo a usar con esa IA")
  .action(async (options: { use?: string; model?: string }) => {
    await askCommand(undefined, options);
  });

program
  .command("ask")
  .description("Una pregunta suelta sobre el código (sin pregunta abre el chat)")
  .argument("[pregunta]", "tu pregunta sobre el código; si no ponés nada, se abre el chat")
  .option("--use <ia>", USE_HELP)
  .option("--model <nombre>", "modelo a usar con esa IA")
  .action(async (question: string | undefined, options: { use?: string; model?: string }) => {
    await askCommand(question, options);
  });

program
  .command("ia")
  .description("Muestra la IA elegida y el estado de cada opción; te deja elegir otra con un menú")
  .option("--estado", "solo mostrar el estado, sin preguntar")
  .action(async (options: { estado?: boolean }) => {
    await iaCommand(options);
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

/** Saca un "--use X" de una lista de argumentos. */
function stripUse(args: string[]): string[] {
  const i = args.indexOf("--use");
  return i === -1 ? args : [...args.slice(0, i), ...args.slice(i + 2)];
}

/** Menú principal de `guardian` (sin argumentos). Devuelve los argumentos del comando elegido. */
async function mainMenu(): Promise<string[]> {
  const asker = terminalAsker();
  try {
    console.log(pc.bold("\n🛡  Guardian · tu revisor de código"));
    console.log(pc.dim('También podés escribirme en tus palabras, ej: guardian "revisá mis cambios con la IA local"'));
    const pick = await choose(
      asker,
      "¿Qué querés hacer?",
      [
        { label: "Revisar mis cambios", hint: "da el veredicto y te ofrece corregir" },
        { label: "Revisar y corregir automáticamente", hint: "te muestra los cambios antes de subir nada" },
        { label: "Preguntar sobre el código", hint: "chat: preguntás y repreguntás" },
        { label: "Elegir o cambiar la IA" },
        { label: "Ver la ayuda completa" },
      ],
      0,
    );
    if (pick === 2) {
      const question = (await asker.question(pc.cyan("Escribí tu pregunta (o Enter para abrir el chat): "))).trim();
      return question ? ["ask", question] : ["chat"];
    }
    return [["review"], ["review", "--corregir"], [], ["ia"], ["--help"]][pick];
  } finally {
    asker.close();
  }
}

async function main() {
  let args = process.argv.slice(2);

  // `guardian` solo, con una persona en la terminal: menú principal (lo más simple para empezar).
  if (args.length === 0 && isInteractive()) {
    args = await mainMenu();
    process.argv.splice(2, process.argv.length, ...args);
  }

  // Lenguaje natural: `guardian "revisá mis cambios con la IA local"` → `guardian review --use ollama`.
  const known = new Set([...program.commands.map((c) => c.name()), "help", "ayuda", "otra-ia", "otras-ia", "otra", "llm", "agregar-ia"]);
  if (args.length > 0 && !args[0].startsWith("-") && !known.has(args[0])) {
    // Lo que viene después del texto (ej: --use local) se mantiene como opción.
    const firstFlag = args.findIndex((a) => a.startsWith("-"));
    const words = firstFlag === -1 ? args : args.slice(0, firstFlag);
    const flags = firstFlag === -1 ? [] : args.slice(firstFlag);
    const routed = routeNaturalLanguage(words.join(" "));
    // Si la persona pasó --use, manda sobre la IA que se haya deducido del texto.
    args = flags.includes("--use") ? [...stripUse(routed), ...flags] : [...routed, ...flags];
    console.log(pc.dim(`→ guardian ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`));
    process.argv.splice(2, process.argv.length, ...args);
  }

  // `guardian --help` / `guardian help` / `guardian ayuda`: guía completa para principiantes.
  if (args.length === 0 || (args.length === 1 && ["--help", "-h", "help", "ayuda"].includes(args[0]))) {
    console.log(mainGuide());
    return;
  }
  // `guardian ayuda otra-ia`: cómo agregar cualquier IA.
  const otherAI = ["otra-ia", "otras-ia", "otra", "llm", "agregar-ia"];
  if (otherAI.includes(args[0]) || (["--help", "-h", "help", "ayuda"].includes(args[0]) && otherAI.includes(args[1]))) {
    console.log(otherAIGuide(join(GUARDIAN_HOME, ".env")));
    return;
  }
  // `guardian help review` → ayuda de ese comando.
  if (args[0] === "help" || args[0] === "ayuda") {
    process.argv.splice(2, 1);
    process.argv.push("--help");
  }
  await program.parseAsync();
}

main().catch((error: unknown) => {
  if (error instanceof GuardianError) {
    console.error(pc.red(`✖ ${error.message}`));
  } else {
    console.error(pc.red("✖ Error inesperado:"), error);
  }
  process.exitCode = 2;
});
