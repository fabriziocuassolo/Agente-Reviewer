import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProvider } from "../src/llm/provider.js";
import { RecordingProvider, ReplayProvider } from "../src/llm/replay.js";
import type { LLMProvider } from "../src/llm/types.js";

const request = { system: "sos un revisor", prompt: "revisá esto" };

function fakeProvider(...texts: string[]): LLMProvider {
  let i = 0;
  return { name: "fake", model: "fake-1", complete: async () => ({ text: texts[i++], inputTokens: 10, outputTokens: 2 }) };
}

describe("grabar y reproducir", () => {
  it("reproduce exactamente lo que se grabó, en orden", async () => {
    const dir = mkdtempSync(join(tmpdir(), "guardian-rec-"));
    const recorder = new RecordingProvider(fakeProvider("primera", "segunda"), dir, "escenario-x");
    await recorder.complete(request);
    await recorder.complete(request);
    expect(recorder.savedTo).toBe(join(dir, "escenario-x.json"));

    const replay = new ReplayProvider(dir, "escenario-x");
    expect((await replay.complete(request)).text).toBe("primera");
    expect((await replay.complete(request)).text).toBe("segunda");
    expect(replay.model).toContain("fake-1");
  });

  it("sin nombre de escenario usa el hash del prompt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "guardian-rec-"));
    await new RecordingProvider(fakeProvider("hola"), dir).complete(request);
    expect((await new ReplayProvider(dir).complete(request)).text).toBe("hola");
    await expect(new ReplayProvider(dir).complete({ ...request, prompt: "otro" })).rejects.toThrow(/--use gemini o --use ollama/);
  });

  it("avisa si el prompt cambió desde que se grabó", async () => {
    const dir = mkdtempSync(join(tmpdir(), "guardian-rec-"));
    await new RecordingProvider(fakeProvider("hola"), dir, "esc").complete(request);
    const response = await new ReplayProvider(dir, "esc").complete({ ...request, prompt: "código nuevo" });
    expect(response.text).toBe("hola");
    expect(response.notice).toMatch(/contexto distinto/);
  });
});

describe("createProvider", () => {
  it("elige el proveedor según LLM_PROVIDER", () => {
    expect(createProvider({ LLM_PROVIDER: "replay" }).provider?.name).toBe("replay");
    expect(createProvider({ LLM_PROVIDER: "ollama" }).provider?.model).toBe("qwen2.5-coder:7b");
    expect(createProvider({ LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" }).provider?.model).toBe("gemini-3.6-flash");
  });

  it("explica qué falta en vez de fallar", () => {
    expect(createProvider({ LLM_PROVIDER: "gemini" }).reason).toMatch(/GEMINI_API_KEY/);
    expect(createProvider({ LLM_PROVIDER: "openai" }).reason).toMatch(/No conozco la IA/);
    expect(createProvider({ LLM_PROVIDER: "replay" }, { record: true }).reason).toMatch(/IA real/);
  });

  it("--record envuelve al proveedor real", () => {
    const { provider } = createProvider({ LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" }, { record: true });
    expect(provider).toBeInstanceOf(RecordingProvider);
    expect(provider?.name).toBe("gemini");
  });
});
