import { describe, expect, it } from "vitest";
import { findSecrets, maskSecret } from "../src/checks/secrets.js";

// Los secretos de prueba se arman concatenando para que este mismo archivo
// no dispare el detector cuando Guardian revisa este repo.
const GOOGLE_KEY = "AIza" + "Sy" + "A".repeat(33);
const STRIPE_KEY = "sk_" + "live_" + "4eC39HqLyjWDarjtT1zdp7dc";

function scan(...lines: string[]) {
  return findSecrets(new Map([["src/x.ts", lines.map((text, i) => ({ line: i + 1, text }))]]));
}

describe("findSecrets", () => {
  it("detecta una API key de Google", () => {
    const [match] = scan(`const key = "${GOOGLE_KEY}";`);
    expect(match).toMatchObject({ file: "src/x.ts", line: 1, kind: "API key de Google", value: GOOGLE_KEY });
  });

  it("detecta claves de Stripe", () => {
    expect(scan(`stripe(${JSON.stringify(STRIPE_KEY)})`)[0]?.kind).toBe("Clave secreta de Stripe");
  });

  it("detecta contraseñas hardcodeadas", () => {
    const [match] = scan(`const dbPass` + `word = "s3cr3t-v4lue";`);
    expect(match?.kind).toBe("Credencial hardcodeada");
    expect(match?.value).toBe("s3cr3t-v4lue");
  });

  it("no marca variables de entorno ni valores de ejemplo", () => {
    expect(scan("const apiKey = process.env.GEMINI_API_KEY;", 'apiKey: "your-api-key-here"', 'token = "xxxxxxxxxx"')).toEqual([]);
  });

  it("no marca strings cortos", () => {
    expect(scan('const token = "abc";')).toEqual([]);
  });
});

describe("maskSecret", () => {
  it("muestra solo los primeros caracteres", () => {
    expect(maskSecret(GOOGLE_KEY)).toBe("AIza… (39 caracteres)");
  });
});
