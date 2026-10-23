/**
 * Lenguaje natural: `guardian "revisá mis cambios con la IA local"` → `guardian review --use ollama`.
 * Es un enrutador por palabras clave (sin IA): rápido, gratis, predecible y fácil de explicar.
 * Si no reconoce una intención, lo trata como una pregunta sobre el código.
 */

const strip = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Qué IA nombró la persona ("con la IA local", "usando gemini"...). */
function mentionedAI(t: string): string[] {
  if (/\b(ia |modelo )?local\b|\bollama\b|\bprivad/.test(t)) return ["--use", "ollama"];
  if (/\bgemini\b|\bgoogle\b/.test(t)) return ["--use", "gemini"];
  if (/\bclaude\b|\banthropic\b/.test(t)) return ["--use", "claude"];
  if (/\bgpt\b|\bchatgpt\b|\bopenai\b/.test(t)) return ["--use", "chatgpt"];
  if (/\bgrok\b/.test(t)) return ["--use", "grok"];
  if (/\breplay\b|\bgrabad/.test(t)) return ["--use", "replay"];
  return [];
}

/** Devuelve los argumentos equivalentes, como si se hubiera escrito el comando. */
export function routeNaturalLanguage(text: string): string[] {
  const t = strip(text.trim());
  const ai = mentionedAI(t);

  // "ayuda", "¿cómo se usa?"
  if (/^(ayuda|help)\b|como (se usa|uso|funciona) guardian|que (podes|puedo) hacer/.test(t)) return ["--help"];

  // "corregí mis cambios", "arreglalo"
  if (/\b(correg|corregi|arregl|fix|solucion)/.test(t)) return ["review", "--corregir", ...ai];

  // "revisá mis cambios", "¿está listo para subir?"
  if (/\b(revis|review|chequea|analiz|esta listo|puedo (subir|pushear)|mira mis cambios)/.test(t)) return ["review", ...ai];

  // "aprendé que ...", "acordate de que ...", "regla: ..."
  const learn = /\b(aprende|aprender|acordate|recorda|ensena|regla)\b(?:\s+(?:que|de que|:))?\s*(.*)$/.exec(t);
  if (learn) {
    // Se usa el texto original (con mayúsculas y acentos) a partir de la misma posición.
    const rule = text.trim().slice(text.trim().length - learn[2].length).trim();
    return rule ? ["aprender", rule] : ["aprender", "--lista"];
  }

  // "cambiá la IA", "quiero usar gemini"
  if (/\b(cambia|cambiar|elegi|elegir|configura)\b.*\b(ia|modelo|proveedor)\b|\bque ia\b/.test(t)) return ["ia"];

  // "charlemos", "abrí el chat"
  if (/\b(chat|charl|conversa|hablemos)\b/.test(t)) return ["chat", ...ai];

  // Cualquier otra cosa: es una pregunta sobre el código.
  return ["ask", text.trim(), ...ai];
}
