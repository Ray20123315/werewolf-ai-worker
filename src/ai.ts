import type { AIConfig, AIProvider } from "./types";

export type AIEnv = Env & Partial<{
  OPENAI_API_KEY: string;
  GEMINI_API_KEY: string;
  DEEPSEEK_API_KEY: string;
  CUSTOM_OPENAI_API_KEY: string;
}>;

export interface AIRequest {
  config: AIConfig;
  system: string;
  prompt: string;
}

export interface AIResult {
  text: string;
  provider: AIProvider;
  model: string;
}

export async function callAI(env: AIEnv, request: AIRequest): Promise<AIResult> {
  const { provider, model } = request.config;
  switch (provider) {
    case "openai":
      return callOpenAI(env.OPENAI_API_KEY, model, request.system, request.prompt);
    case "gemini":
      return callGemini(env.GEMINI_API_KEY, model, request.system, request.prompt);
    case "deepseek":
      return callDeepSeek(env.DEEPSEEK_API_KEY, model, request.system, request.prompt);
    case "openai-compatible":
      return callOpenAICompatible(
        env.CUSTOM_OPENAI_API_KEY,
        env.CUSTOM_OPENAI_BASE_URL,
        model,
        request.system,
        request.prompt
      );
    default:
      return assertNever(provider);
  }
}

async function callOpenAI(
  apiKey: string | undefined,
  model: string,
  system: string,
  prompt: string
): Promise<AIResult> {
  requireSecret(apiKey, "OPENAI_API_KEY");
  const response = await fetchJson("https://api.openai.com/v1/responses", {
    headers: { Authorization: `Bearer ${apiKey}` },
    body: {
      model,
      store: false,
      instructions: system,
      input: prompt
    }
  });
  return { text: extractOpenAIText(response), provider: "openai", model };
}

async function callGemini(
  apiKey: string | undefined,
  model: string,
  system: string,
  prompt: string
): Promise<AIResult> {
  requireSecret(apiKey, "GEMINI_API_KEY");
  const encodedModel = encodeURIComponent(model);
  const response = await fetchJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodedModel}:generateContent`,
    {
      headers: { "x-goog-api-key": apiKey },
      body: {
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      }
    }
  );
  const candidates = asArray(asRecord(response).candidates);
  const first = asRecord(candidates[0]);
  const content = asRecord(first.content);
  const parts = asArray(content.parts);
  const text = parts.map((part) => String(asRecord(part).text ?? "")).join("").trim();
  if (!text) throw new Error("Gemini 回傳空白內容");
  return { text, provider: "gemini", model };
}

async function callDeepSeek(
  apiKey: string | undefined,
  model: string,
  system: string,
  prompt: string
): Promise<AIResult> {
  requireSecret(apiKey, "DEEPSEEK_API_KEY");
  const response = await fetchJson("https://api.deepseek.com/chat/completions", {
    headers: { Authorization: `Bearer ${apiKey}` },
    body: {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.7
    }
  });
  return { text: extractChatCompletionText(response), provider: "deepseek", model };
}

async function callOpenAICompatible(
  apiKey: string | undefined,
  baseUrl: string | undefined,
  model: string,
  system: string,
  prompt: string
): Promise<AIResult> {
  requireSecret(apiKey, "CUSTOM_OPENAI_API_KEY");
  if (!baseUrl?.trim()) throw new Error("CUSTOM_OPENAI_BASE_URL 尚未設定");
  const response = await fetchJson(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    body: {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.7
    }
  });
  return { text: extractChatCompletionText(response), provider: "openai-compatible", model };
}

async function fetchJson(
  url: string,
  options: { headers?: Record<string, string>; body: unknown }
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {})
    },
    body: JSON.stringify(options.body),
    signal: AbortSignal.timeout(25_000)
  });
  const payload = await response.json().catch(() => undefined) as unknown;
  if (!response.ok) {
    const detail = safeErrorDetail(payload);
    throw new Error(`AI provider HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return payload;
}

function extractOpenAIText(payload: unknown): string {
  const root = asRecord(payload);
  if (typeof root.output_text === "string" && root.output_text.trim()) return root.output_text.trim();
  const output = asArray(root.output);
  const text = output
    .flatMap((item) => asArray(asRecord(item).content))
    .map((part) => {
      const record = asRecord(part);
      return typeof record.text === "string" ? record.text : "";
    })
    .join("")
    .trim();
  if (!text) throw new Error("OpenAI 回傳空白內容");
  return text;
}

function extractChatCompletionText(payload: unknown): string {
  const choices = asArray(asRecord(payload).choices);
  const content = asRecord(asRecord(choices[0]).message).content;
  if (typeof content !== "string" || !content.trim()) throw new Error("AI 回傳空白內容");
  return content.trim();
}

function safeErrorDetail(payload: unknown): string {
  const root = asRecord(payload);
  const error = asRecord(root.error);
  const message = error.message ?? root.message;
  return typeof message === "string" ? message.slice(0, 300) : "";
}

function requireSecret(value: string | undefined, name: string): asserts value is string {
  if (!value?.trim()) throw new Error(`${name} 尚未設定；此 AI 將改用本地規則模式`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function assertNever(value: never): never {
  throw new Error(`未知 AI provider: ${String(value)}`);
}

export function parseJSONObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return asRecord(JSON.parse(trimmed.slice(start, end + 1)));
    }
    throw new Error("AI 回應不是有效 JSON");
  }
}
