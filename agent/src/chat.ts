import { createInterface } from "node:readline";
import pc from "picocolors";
import { ask, type ChatTurn } from "./ask.js";
import { prepareProvider } from "./llm/provider.js";
import { GuardianError } from "./types.js";

export interface ChatOptions {
  cwd: string;
  use?: string;
  model?: string;
}

const HELP = [
  pc.dim("Comandos:"),
  pc.dim("  /fuentes  qué archivos leyó para la última respuesta"),
  pc.dim("  /nuevo    empezar una charla nueva (olvida lo hablado)"),
  pc.dim("  /ayuda    ver estos comandos"),
  pc.dim("  /salir    terminar (o Ctrl+C)"),
].join("\n");

/**
 * `guardian chat` (o `guardian ask` sin pregunta): conversación sobre el código en la terminal.
 * Cada respuesta cita archivo:línea y recuerda lo hablado, así se puede repreguntar
 * ("¿y dónde se usa eso?") como con un compañero.
 */
export async function startChat(options: ChatOptions): Promise<void> {
  const { provider, reason } = await prepareProvider(process.env, { use: options.use, model: options.model });
  if (!provider) throw new GuardianError(`Para chatear hace falta una IA.\n${reason}`);
  if (provider.name === "replay") {
    throw new GuardianError(
      "El chat necesita una IA real (replay solo reproduce las revisiones de la demo). Elegí una:\n" +
        "  guardian chat --use ia      ← Gemini, en la nube\n" +
        "  guardian chat --use local   ← Ollama, en tu computadora",
    );
  }

  console.log("");
  console.log(pc.bold("💬 Guardian · chat sobre tu código"));
  console.log(pc.dim(`IA: ${provider.name} · ${provider.model} · carpeta: ${options.cwd}`));
  console.log(pc.dim('Preguntá lo que quieras, por ejemplo: "¿cómo se calcula el envío?" y después "¿y dónde se usa?"'));
  console.log(HELP);
  console.log("");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", () => rl.close()); // Ctrl+C cierra la charla prolijamente
  rl.setPrompt(pc.cyan(pc.bold("vos › ")));
  let history: ChatTurn[] = [];
  let lastSources: string[] = [];

  rl.prompt();
  // Se lee línea por línea: lo que se escribe mientras la IA piensa queda en espera, no se pierde.
  for await (const raw of rl) {
    const line = raw.trim();
    if (!process.stdin.isTTY && line) console.log(line); // si la entrada viene de un archivo, se muestra
    if (!line) {
      rl.prompt();
      continue;
    }

    const command = line.toLowerCase();
    if (["/salir", "/exit", "salir", "exit", "chau"].includes(command)) break;
    if (command === "/ayuda" || command === "/help") {
      console.log(HELP + "\n");
      rl.prompt();
      continue;
    }
    if (command === "/nuevo") {
      history = [];
      lastSources = [];
      console.log(pc.dim("Charla nueva: olvidé lo anterior.\n"));
      rl.prompt();
      continue;
    }
    if (command === "/fuentes") {
      console.log(pc.dim(lastSources.length > 0 ? `Leí: ${lastSources.join(", ")}\n` : "Todavía no respondí nada.\n"));
      rl.prompt();
      continue;
    }

    const started = Date.now();
    process.stdout.write(pc.dim("pensando…"));
    try {
      const result = await ask(line, { cwd: options.cwd, provider, history });
      clearLine();
      console.log(`${pc.green(pc.bold("guardian ›"))} ${result.answer}\n`);
      console.log(pc.dim(`(${((Date.now() - started) / 1000).toFixed(1)} s · ${result.sources.length} archivo/s leídos · /fuentes para verlos)\n`));
      history.push({ question: line, answer: result.answer });
      lastSources = result.sources;
    } catch (error) {
      clearLine();
      const message = error instanceof GuardianError ? error.message : String(error);
      console.log(pc.yellow(`No pude responder: ${message}\n`));
    }
    rl.prompt();
  }

  rl.close();
  console.log(pc.dim("\n¡Hasta luego!\n"));
}

function clearLine() {
  if (process.stdout.isTTY) {
    process.stdout.write("\r\x1b[K");
  } else {
    process.stdout.write("\n");
  }
}
