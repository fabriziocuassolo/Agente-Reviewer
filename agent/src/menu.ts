import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import pc from "picocolors";
import { GUARDIAN_HOME } from "./env.js";
import { readCustomProviders, type CustomProviderConfig } from "./llm/custom.js";
import { geminiSetupHelp, ollamaSetupHelp } from "./llm/help.js";
import { DEFAULT_GEMINI_MODEL } from "./llm/provider.js";
import { OllamaProvider } from "./llm/ollama.js";
import type { LLMProvider } from "./llm/types.js";
import { loadPrefs, savePrefs, type Prefs } from "./prefs.js";

/**
 * Menús interactivos en la terminal: elegir la IA (y recordarla), confirmar acciones.
 * Todo pasa por un "Asker" para poder probarlo sin una terminal real.
 */
export interface Asker {
  question(text: string): Promise<string>;
  close(): void;
}

export function terminalAsker(): Asker {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return { question: (text) => rl.question(text), close: () => rl.close() };
}

/** ¿Se puede preguntar? (hay una persona en la terminal; no es CI, ni un hook, ni --json) */
export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && !process.env.CI);
}

export interface Option {
  label: string;
  hint?: string;
}

/** Menú numerado. Enter elige la opción por defecto (si hay). Devuelve el índice (0 = primera). */
export async function choose(asker: Asker, title: string, options: Option[], defaultIndex?: number): Promise<number> {
  console.log(`\n${pc.bold(title)}`);
  options.forEach((option, i) => {
    const mark = i === defaultIndex ? pc.cyan(" ← Enter") : "";
    const hint = option.hint ? pc.dim(`  ${option.hint}`) : "";
    console.log(`  ${pc.bold(String(i + 1))}. ${option.label}${hint}${mark}`);
  });
  for (;;) {
    const answer = (await asker.question(pc.cyan("Elegí un número: "))).trim();
    if (!answer && defaultIndex !== undefined) return defaultIndex;
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return n - 1;
    console.log(pc.yellow(`Escribí un número del 1 al ${options.length}.`));
  }
}

export async function confirm(asker: Asker, text: string, defaultYes = false): Promise<boolean> {
  const answer = (await asker.question(`${text} ${pc.dim(defaultYes ? "(S/n)" : "(s/N)")} `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return ["s", "si", "sí", "y", "yes"].includes(answer);
}

// ---------------------------------------------------------------------------
// Qué IA se está usando (se muestra SIEMPRE al empezar)

export function describeProvider(provider: LLMProvider | null, reason?: string): string {
  if (!provider) return `${pc.bold("Usando:")} sin IA (solo controles automáticos)${reason ? pc.dim(` · ${reason.split("\n")[0]}`) : ""}`;
  const what =
    provider.name === "replay"
      ? `replay · respuestas grabadas de antes ${pc.dim("(no es una IA en vivo; solo sirve para la demo)")}`
      : provider.name === "ollama"
        ? `IA local · Ollama · ${provider.model} ${pc.dim("(privada: el código no sale de tu máquina)")}`
        : provider.name === "gemini"
          ? `IA en la nube · Gemini · ${provider.model} ${pc.dim("(el código se envía a Google)")}`
          : `IA en la nube · ${provider.name} · ${provider.model} ${pc.dim(`(el código se envía a ese proveedor)`)}`;
  return `🤖 ${pc.bold("Usando:")} ${what}`;
}

// ---------------------------------------------------------------------------
// Elegir la IA

export interface AIChoice {
  use: string;
  model?: string;
  label: string;
}

/** Proveedores en la nube que ofrece el menú. Los que no son Gemini se guardan como IA propia en el .env. */
interface CloudOption {
  label: string;
  envName: string; // nombre en el .env: IA_<ENVNAME>_...
  matches: (c: CustomProviderConfig) => boolean;
  url?: string;
  format?: "anthropic";
  keyUrl: string;
  modelHint: string;
  defaultModel?: string;
}

const CLOUD: CloudOption[] = [
  {
    label: "Claude (Anthropic)",
    envName: "CLAUDE",
    matches: (c) => c.format === "anthropic",
    format: "anthropic",
    keyUrl: "https://console.anthropic.com/settings/keys",
    modelHint: "claude-opus-5-5 (o claude-sonnet-5-5 / claude-haiku-5-5, más baratos)",
    defaultModel: "claude-opus-5-5",
  },
  {
    label: "Grok (xAI)",
    envName: "GROK",
    matches: (c) => c.name.includes("grok") || Boolean(c.url?.includes("x.ai")),
    url: "https://api.x.ai/v1",
    keyUrl: "https://console.x.ai",
    modelHint: "el nombre exacto está en https://docs.x.ai/docs/models",
  },
  {
    label: "GPT (OpenAI / ChatGPT)",
    envName: "CHATGPT",
    matches: (c) => /gpt|openai/.test(c.name) || Boolean(c.url?.includes("api.openai.com")),
    url: "https://api.openai.com/v1",
    keyUrl: "https://platform.openai.com/api-keys",
    modelHint: "el nombre exacto está en https://platform.openai.com/docs/models",
  },
];

const ENV_PATH = join(GUARDIAN_HOME, ".env");

/** Escribe (o reemplaza) variables en el .env de Guardian y las activa en este proceso. */
export function setEnvVars(vars: Record<string, string>, path = ENV_PATH): void {
  let text = existsSync(path) ? readFileSync(path, "utf8") : "";
  for (const [key, value] of Object.entries(vars)) {
    const line = `${key}=${value}`;
    const regex = new RegExp(`^${key}=.*$`, "m");
    text = regex.test(text) ? text.replace(regex, line) : `${text.replace(/\n?$/, "\n")}${line}\n`;
    process.env[key] = value;
  }
  writeFileSync(path, text);
}

/**
 * El menú de la IA: 1) replay 2) local (Ollama, modelo chico o grande) 3) en la nube.
 * Si la opción elegida no está configurada, explica cómo hacerlo (y ofrece hacerlo ahí mismo).
 * Devuelve null si la persona no puede usar la opción todavía.
 */
export async function chooseAI(asker: Asker, env: NodeJS.ProcessEnv = process.env): Promise<AIChoice | null> {
  const previous = loadPrefs();
  const level1 = await choose(
    asker,
    "¿Con qué IA querés trabajar?",
    [
      { label: "Modo replay", hint: "respuestas grabadas · sin instalar nada · solo para la demo" },
      { label: "IA local (Ollama)", hint: "gratis y privada: el código no sale de tu máquina" },
      { label: "IA de un proveedor", hint: "Gemini, Claude, Grok, GPT u otra · en la nube" },
    ],
    previous ? ({ replay: 0, ollama: 1 } as Record<string, number>)[previous.use] ?? 2 : undefined,
  );

  if (level1 === 0) return { use: "replay", label: "replay (respuestas grabadas)" };
  if (level1 === 1) return chooseLocal(asker, env);
  return chooseCloud(asker, env);
}

async function chooseLocal(asker: Asker, env: NodeJS.ProcessEnv): Promise<AIChoice | null> {
  const host = env.OLLAMA_HOST?.trim() || "http://localhost:11434";
  const models = await new OllamaProvider(host, "", 5_000).listModelsWithSize();
  if (models === null) {
    console.log(`\n${ollamaSetupHelp("qwen2.5-coder:7b", "no-server", host)}`);
    return null;
  }
  if (models.length === 0) {
    console.log(`\n${ollamaSetupHelp("qwen2.5-coder:7b", "no-model", host)}`);
    return null;
  }
  const sorted = [...models].sort((a, b) => a.size - b.size);
  const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;
  const smallest = sorted[0];
  const largest = sorted[sorted.length - 1];
  if (smallest.name === largest.name) {
    console.log(pc.dim(`\nTenés un solo modelo instalado: ${smallest.name}. Para sumar uno más grande: ollama pull qwen2.5-coder:14b`));
    return { use: "ollama", model: smallest.name, label: `IA local · Ollama · ${smallest.name}` };
  }
  const pick = await choose(asker, "¿Qué modelo local?", [
    { label: `Modelo más chico: ${smallest.name}`, hint: `${gb(smallest.size)} · más rápido, menos preciso` },
    { label: `Modelo más grande: ${largest.name}`, hint: `${gb(largest.size)} · más preciso, necesita más memoria` },
  ]);
  const model = pick === 0 ? smallest.name : largest.name;
  return { use: "ollama", model, label: `IA local · Ollama · ${model}` };
}

async function chooseCloud(asker: Asker, env: NodeJS.ProcessEnv): Promise<AIChoice | null> {
  const customs = [...readCustomProviders(env).values()];
  const pick = await choose(asker, "¿Qué proveedor?", [
    { label: "Gemini (Google)", hint: env.GEMINI_API_KEY?.trim() ? "configurada ✔" : "capa gratuita · falta configurar" },
    ...CLOUD.map((c) => ({ label: c.label, hint: customs.some(c.matches) ? "configurada ✔" : "falta configurar" })),
    { label: "Otra", hint: "DeepSeek, Mistral, Groq, OpenRouter… o una que ya agregaste" },
  ]);

  // Gemini
  if (pick === 0) {
    if (env.GEMINI_API_KEY?.trim()) {
      const model = env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
      return { use: "gemini", label: `IA en la nube · Gemini · ${model}` };
    }
    console.log(`\n${geminiSetupHelp()}`);
    const key = (await asker.question(pc.cyan("\nSi ya tenés la clave, pegala acá (o Enter para salir): "))).trim();
    if (!key) return null;
    setEnvVars({ GEMINI_API_KEY: key });
    console.log(pc.green(`✔ Clave guardada en ${ENV_PATH}`));
    return { use: "gemini", label: `IA en la nube · Gemini · ${DEFAULT_GEMINI_MODEL}` };
  }

  // Claude, Grok, GPT
  if (pick <= CLOUD.length) {
    const option = CLOUD[pick - 1];
    const existing = customs.find((c) => option.matches(c) && c.model && (c.key || c.url));
    if (existing) return { use: existing.name, label: `IA en la nube · ${option.label} · ${existing.model}` };
    return setupCloud(asker, option);
  }

  // Otra
  const others = customs.filter((c) => !CLOUD.some((o) => o.matches(c)) && c.model);
  if (others.length > 0) {
    const which = await choose(asker, "¿Cuál?", [
      ...others.map((c) => ({ label: c.name, hint: `${c.url ?? "Anthropic"} · ${c.model}` })),
      { label: "Agregar una nueva" },
    ]);
    if (which < others.length) return { use: others[which].name, label: `IA en la nube · ${others[which].name} · ${others[which].model}` };
  }
  console.log(
    `\nPara agregar otra IA (DeepSeek, Mistral, Groq, OpenRouter, LM Studio...) son 3 líneas en ${ENV_PATH}.\n` +
      `Paso a paso, con la dirección de cada proveedor:  ${pc.green("guardian ayuda otra-ia")}`,
  );
  return null;
}

/** Explica cómo configurar Claude / Grok / GPT y ofrece hacerlo ahí mismo. */
async function setupCloud(asker: Asker, option: CloudOption): Promise<AIChoice | null> {
  const prefix = `IA_${option.envName}`;
  console.log(
    [
      "",
      pc.bold(`Para usar ${option.label} falta configurarla:`),
      `  1. Sacá una clave de API en ${option.keyUrl}`,
      pc.dim("     Ojo: una suscripción al chat (ChatGPT Plus, Claude Pro...) no incluye la API; la API se paga por uso."),
      `  2. Agregá estas líneas en ${ENV_PATH}:`,
      ...(option.format ? [`       ${prefix}_FORMATO=${option.format}`] : [`       ${prefix}_URL=${option.url}`]),
      `       ${prefix}_KEY=tu-clave`,
      `       ${prefix}_MODEL=${option.defaultModel ?? "nombre-del-modelo"}   ${pc.dim(`← ${option.modelHint}`)}`,
      "",
      "Si querés, lo hago yo ahora:",
    ].join("\n"),
  );
  const key = (await asker.question(pc.cyan("Pegá la clave (o Enter para salir): "))).trim();
  if (!key) return null;
  const modelAnswer = (
    await asker.question(pc.cyan(`Modelo${option.defaultModel ? ` (Enter = ${option.defaultModel})` : ""}: `))
  ).trim();
  const model = modelAnswer || option.defaultModel;
  if (!model) {
    console.log(pc.yellow(`Falta el modelo. Buscá el nombre en: ${option.modelHint}`));
    return null;
  }
  setEnvVars({
    ...(option.format ? { [`${prefix}_FORMATO`]: option.format } : { [`${prefix}_URL`]: option.url! }),
    [`${prefix}_KEY`]: key,
    [`${prefix}_MODEL`]: model,
  });
  console.log(pc.green(`✔ ${option.label} configurada en ${ENV_PATH}`));
  return { use: option.envName.toLowerCase(), model, label: `IA en la nube · ${option.label} · ${model}` };
}

/**
 * Decide qué IA usar en un comando:
 *   --use  >  la que elegiste antes (guardada)  >  menú (la primera vez, si hay alguien en la terminal)  >  .env / replay
 */
export async function resolveAIChoice(
  options: { use?: string; model?: string },
  interactive: boolean,
): Promise<{ use?: string; model?: string; saved?: Prefs }> {
  if (options.use) return options;
  const saved = loadPrefs();
  if (saved) return { use: saved.use, model: options.model ?? saved.model, saved };
  if (!interactive) return options;

  const asker = terminalAsker();
  try {
    console.log(pc.dim("\nEs la primera vez: elegí con qué IA trabajar. Se guarda y la próxima vez arranca directo."));
    const choice = await chooseAI(asker);
    if (!choice) process.exit(0);
    const prefs = savePrefs({ use: choice.use, model: choice.model, label: choice.label });
    console.log(pc.green(`✔ Listo: voy a usar ${choice.label}. Para cambiarla: guardian ia`));
    return { use: prefs.use, model: options.model ?? prefs.model, saved: prefs };
  } finally {
    asker.close();
  }
}
