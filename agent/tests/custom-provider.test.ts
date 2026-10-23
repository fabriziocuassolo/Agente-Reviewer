import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { missingConfig, readCustomProviders } from "../src/llm/custom.js";
import { createProvider, providersStatus } from "../src/llm/provider.js";

// Servidor falso que imita /chat/completions (formato OpenAI) y /v1/messages (formato Anthropic).
const received: { path: string; headers: IncomingMessage["headers"]; body: Record<string, unknown> }[] = [];
let server: Server;
let base = "";
let rejectJsonMode = false;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      received.push({ path: req.url ?? "", headers: req.headers, body });
      res.setHeader("Content-Type", "application/json");

      if (req.url === "/chat/completions") {
        if (rejectJsonMode && body.response_format) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: { message: "response_format is not supported" } }));
          return;
        }
        res.end(JSON.stringify({ choices: [{ message: { content: '{"findings":[]}' } }], usage: { prompt_tokens: 11, completion_tokens: 3 } }));
        return;
      }
      if (req.url?.startsWith("/v1/messages")) {
        res.end(
          JSON.stringify({
            id: "msg_1",
            type: "message",
            role: "assistant",
            model: body.model,
            content: [{ type: "text", text: '{"findings":[]}' }],
            stop_reason: "end_turn",
            usage: { input_tokens: 21, output_tokens: 4 },
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

const request = { system: "sos un revisor", prompt: "revisá esto" };

describe("IAs agregadas por el usuario en el .env", () => {
  it("lee IA_<NOMBRE>_URL/KEY/MODEL/FORMATO y usa el nombre en minúsculas", () => {
    const customs = readCustomProviders({
      IA_CHATGPT_URL: "https://api.openai.com/v1/",
      IA_CHATGPT_KEY: "k",
      IA_CHATGPT_MODEL: "m",
      IA_MI_CLAUDE_FORMATO: "anthropic",
      IA_MI_CLAUDE_KEY: "k2",
      IA_MI_CLAUDE_MODEL: "claude-haiku-5-5",
      OTRA_VARIABLE: "x",
    });
    expect([...customs.keys()].sort()).toEqual(["chatgpt", "mi_claude"]);
    expect(customs.get("chatgpt")).toMatchObject({ url: "https://api.openai.com/v1", format: "openai" });
    expect(customs.get("mi_claude")).toMatchObject({ format: "anthropic", model: "claude-haiku-5-5" });
  });

  it("no deja pisar los nombres de Guardian", () => {
    expect(readCustomProviders({ IA_GEMINI_URL: "x", IA_GEMINI_MODEL: "y", IA_LOCAL_MODEL: "z" }).size).toBe(0);
  });

  it("explica qué línea falta", () => {
    const [config] = readCustomProviders({ IA_CHATGPT_KEY: "k" }).values();
    const missing = missingConfig(config)!;
    expect(missing).toContain("IA_CHATGPT_MODEL=");
    expect(missing).toContain("IA_CHATGPT_URL=");
    expect(missing).toContain("guardian ayuda otra-ia");
  });

  it("--use <nombre> la reconoce y --model completa el modelo", () => {
    const env = { IA_GROQ_URL: "https://api.groq.com/openai/v1", IA_GROQ_KEY: "k" };
    expect(createProvider(env, { use: "groq" }).provider).toBeNull();
    expect(createProvider(env, { use: "groq", model: "modelo-x" }).provider).toMatchObject({ name: "groq", model: "modelo-x" });
  });

  it("también puede ser la IA por defecto (LLM_PROVIDER)", () => {
    const env = { LLM_PROVIDER: "deepseek", IA_DEEPSEEK_URL: "https://api.deepseek.com", IA_DEEPSEEK_MODEL: "deepseek-chat" };
    expect(createProvider(env).provider?.name).toBe("deepseek");
  });

  it("si el nombre no existe, lista las disponibles (incluidas las propias)", () => {
    const reason = createProvider({ IA_CHATGPT_URL: "u", IA_CHATGPT_MODEL: "m" }, { use: "grok" }).reason!;
    expect(reason).toContain("--use chatgpt");
    expect(reason).toContain("guardian ayuda otra-ia");
  });

  it("guardian ia muestra las IAs propias y si están completas", async () => {
    const statuses = await providersStatus({
      OLLAMA_HOST: "http://127.0.0.1:9",
      IA_CHATGPT_URL: "u",
      IA_LISTA_URL: base,
      IA_LISTA_MODEL: "m",
    });
    expect(statuses.find((s) => s.name === "chatgpt")).toMatchObject({ ready: false });
    expect(statuses.find((s) => s.name === "lista")).toMatchObject({ ready: true });
  });
});

describe("formato OpenAI (/chat/completions)", () => {
  it("manda la clave en el header, pide JSON y lee la respuesta y los tokens", async () => {
    received.length = 0;
    const { provider } = createProvider({ IA_PRUEBA_URL: base, IA_PRUEBA_KEY: "secreta", IA_PRUEBA_MODEL: "m1" }, { use: "prueba" });
    const response = await provider!.complete(request);
    expect(response).toMatchObject({ text: '{"findings":[]}', inputTokens: 11, outputTokens: 3 });
    expect(received[0].headers.authorization).toBe("Bearer secreta");
    expect(received[0].body).toMatchObject({ model: "m1", response_format: { type: "json_object" } });
  });

  it("si el proveedor no soporta el modo JSON, reintenta sin él", async () => {
    received.length = 0;
    rejectJsonMode = true;
    const { provider } = createProvider({ IA_PRUEBA_URL: base, IA_PRUEBA_MODEL: "m1" }, { use: "prueba" });
    const response = await provider!.complete(request);
    rejectJsonMode = false;
    expect(response.text).toBe('{"findings":[]}');
    expect(received.map((r) => Boolean(r.body.response_format))).toEqual([true, false]);
  });

  it("para ask (texto libre) no pide JSON", async () => {
    received.length = 0;
    const { provider } = createProvider({ IA_PRUEBA_URL: base, IA_PRUEBA_MODEL: "m1" }, { use: "prueba" });
    await provider!.complete({ ...request, json: false });
    expect(received[0].body.response_format).toBeUndefined();
  });
});

describe("formato Anthropic (Claude, con el SDK oficial)", () => {
  it("llama a /v1/messages con el modelo, el system y la clave", async () => {
    received.length = 0;
    const env = { IA_CLAUDE_FORMATO: "anthropic", IA_CLAUDE_KEY: "sk-prueba", IA_CLAUDE_MODEL: "claude-haiku-5-5", IA_CLAUDE_URL: base };
    const { provider } = createProvider(env, { use: "claude" });
    const response = await provider!.complete(request);
    expect(response).toMatchObject({ text: '{"findings":[]}', inputTokens: 21, outputTokens: 4 });
    expect(received[0].path).toBe("/v1/messages");
    expect(received[0].headers.authorization).toBe("Bearer sk-prueba");
    expect(received[0].body).toMatchObject({ model: "claude-haiku-5-5", system: "sos un revisor" });
  });

  it("en los modelos que lo admiten, activa el respaldo automático ante rechazos", async () => {
    received.length = 0;
    const env = { IA_CLAUDE_FORMATO: "anthropic", IA_CLAUDE_KEY: "sk-prueba", IA_CLAUDE_MODEL: "claude-opus-5-5", IA_CLAUDE_URL: base };
    await createProvider(env, { use: "claude" }).provider!.complete(request);
    expect(received[0].body.fallbacks).toBe("default");
    expect(String(received[0].headers["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");
  });

  it("sin clave, explica qué falta", () => {
    const reason = createProvider({ IA_CLAUDE_FORMATO: "anthropic", IA_CLAUDE_MODEL: "claude-opus-5-5" }, { use: "claude" }).reason!;
    expect(reason).toContain("IA_CLAUDE_KEY=");
  });
});
