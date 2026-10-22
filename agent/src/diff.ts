export interface AddedLine {
  line: number;
  text: string;
}

/**
 * Extrae las líneas AGREGADAS de un diff unificado, con su número de línea
 * en el archivo nuevo. Sirve para analizar solo lo que el desarrollador escribió,
 * no el código que ya existía.
 */
export function parseAddedLines(diff: string): Map<string, AddedLine[]> {
  const result = new Map<string, AddedLine[]>();
  let currentFile: string | null = null;
  let newLine = 0;

  for (const raw of diff.split("\n")) {
    const line = raw.replace(/\r$/, "");

    if (line.startsWith("+++ ")) {
      // "+++ b/ruta" o "+++ /dev/null" (archivo borrado)
      const target = line.slice(4);
      currentFile = target === "/dev/null" ? null : target.replace(/^b\//, "");
      if (currentFile && !result.has(currentFile)) result.set(currentFile, []);
      continue;
    }

    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }

    if (!currentFile || line.startsWith("--- ") || line.startsWith("diff --git")) continue;

    if (line.startsWith("+")) {
      result.get(currentFile)!.push({ line: newLine, text: line.slice(1) });
      newLine++;
    } else if (line.startsWith(" ")) {
      newLine++;
    }
    // Las líneas "-" (borradas) y "\ No newline" no avanzan el contador del archivo nuevo.
  }
  return result;
}
