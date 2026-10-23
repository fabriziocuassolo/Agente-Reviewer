import { describe, expect, it } from "vitest";
import { createProvider, prepareProvider, resolveProviderName } from "../src/llm/provider.js";

describe("elegir la IA (--use)", () => {
  it("por defecto usa replay", () => {
    expect(resolveProviderName(undefined, {})).toBe("replay");
    expect(createProvider({}).provider?.name).toBe("replay");
  });

  it("--use tiene prioridad sobre el .env", () => {
    expect(resolveProviderName("ollama", { LLM_PROVIDER: "gemini" })).toBe("ollama");
    expect(resolveProviderName(undefined, { LLM_PROVIDER: "gemini" })).toBe("gemini");
  });

  it("acepta alias en castellano: ia = gemini, local = ollama", () => {
    expect(resolveProviderName("ia", {})).toBe("gemini");
    expect(resolveProviderName("LOCAL", {})).toBe("ollama");
  });

  it("--model cambia el modelo", () => {
    expect(createProvider({}, { use: "ollama", model: "qwen2.5-coder:14b" }).provider?.model).toBe("qwen2.5-coder:14b");
    expect(createProvider({ GEMINI_API_KEY: "k" }, { use: "gemini", model: "gemini-3.8-flash" }).provider?.model).toBe(
      "gemini-3.8-flash",
    );
  });

  it("sin key de Gemini explica cómo conseguirla y ofrece la IA local", () => {
    const choice = createProvider({}, { use: "gemini" });
    expect(choice.provider).toBeNull();
    expect(choice.reason).toContain("aistudio.google.com/apikey");
    expect(choice.reason).toContain("GEMINI_API_KEY=");
    expect(choice.reason).toContain("--use ollama");
  });

  it("si se pidió con --use y no está lista, corta con las instrucciones", async () => {
    await expect(prepareProvider({}, { use: "gemini" })).rejects.toThrow(/aistudio/);
  });

  it("si Ollama no responde, explica cómo instalarlo", async () => {
    // Puerto donde no hay nada escuchando
    const env = { OLLAMA_HOST: "http://127.0.0.1:9" };
    await expect(prepareProvider(env, { use: "ollama" })).rejects.toThrow(/winget install Ollama.Ollama/);
  });

  it("si la IA viene del .env y no está lista, no corta: devuelve el motivo", async () => {
    const choice = await prepareProvider({ LLM_PROVIDER: "gemini" }, {});
    expect(choice.provider).toBeNull();
    expect(choice.reason).toContain("aistudio");
  });
});
