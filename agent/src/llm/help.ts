import { join } from "node:path";
import { GUARDIAN_HOME } from "../env.js";

// Textos que ve el usuario cuando una IA no está lista: qué falta y cómo resolverlo.

export const DEFAULT_OLLAMA_HOST = "http://localhost:11434";
const ENV_PATH = join(GUARDIAN_HOME, ".env");

export function geminiSetupHelp(): string {
  return [
    "Para usar Gemini falta tu API key (es gratis):",
    "  1. Entrá a https://aistudio.google.com/apikey e iniciá sesión con Google.",
    '  2. Tocá "Create API key" y copiala.',
    `  3. Pegala en ${ENV_PATH} así:  GEMINI_API_KEY=tu-key`,
    '     (o solo para esta terminal, en PowerShell:  $env:GEMINI_API_KEY="tu-key")',
    "  4. Volvé a correr el comando con --use gemini.",
    "¿Preferís que el código no salga de tu máquina? Usá la IA local: --use ollama",
    "Ojo: en la capa gratuita, Google puede usar lo que envíes para mejorar sus productos.",
  ].join("\n");
}

export function ollamaSetupHelp(model: string, problem: "no-server" | "no-model", host = DEFAULT_OLLAMA_HOST): string {
  if (problem === "no-model") {
    return [
      `Ollama está andando, pero falta el modelo "${model}". Descargalo con:`,
      `  ollama pull ${model}`,
      "(qwen2.5-coder:7b pesa ~4,7 GB; qwen2.5-coder:14b ~9 GB y es más preciso si tenés 12 GB de VRAM o más)",
      "Después volvé a correr el comando con --use ollama.",
    ].join("\n");
  }
  return [
    `No encuentro Ollama en ${host}. Para usar la IA local:`,
    "  1. Instalalo:",
    "       Windows:  winget install Ollama.Ollama   (o https://ollama.com/download)",
    "       macOS:    brew install ollama            (o https://ollama.com/download)",
    "       Linux:    curl -fsSL https://ollama.com/install.sh | sh",
    "  2. Abrí la app Ollama (o corré: ollama serve).",
    `  3. Descargá el modelo:  ollama pull ${model}`,
    "  4. Volvé a correr el comando con --use ollama.",
    "Si no querés instalar nada, probá la demo con replay o usá Gemini: --use gemini",
  ].join("\n");
}

