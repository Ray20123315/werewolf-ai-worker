import type { AIConfig, AIProvider } from "./types";

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

export async function callAI(apiKey: string, request: AIRequest): Promise<AIResult> {
  const key = requireCredential(apiKey);
  const { provider, model } = request.config;
  switch (provider) {
    case "openai":
      return callOpenAI(key, model, request.system, request.prompt);
    case "gemini":
      return callGemini(key, model, request.system, request.prompt);
    case "deepseek":
      return callDeepSeek(key, model, request.system, request.prompt);
    case "openai-compatible":
      return callOpenAICompatible(key, requireBaseUrl(request.config.baseUrl), model, request.system, request.prompt);
    default:
      return assertNever(provider);
  }
}

async function callOpenAI(apiKey: string, model: string, system: string, prompt: string): Promise<AIResult> {
  const response = await fetchJson("https://api.openai.com/v1/responses", {
    headers: { Authorization: `Bearer ${apiKey}` },
    body: { model, store: false, instructions: system, input: prompt }
  });
  return { text: extractOpenAIText(response), provider: "openai", model };
}

async function callGemini(apiKey: string, model: string, system: string, prompt: string): Promise<AIResult> {
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

async function callDeepSeek(apiKey: string, model: string, system: string, prompt: string): Promise<AIResult> {
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
  apiKey: string,
  baseUrl: string,
  model: string,
  system: string,
  prompt: string
): Promise<AIResult> {
  const response = await fetchJson(`${baseUrl}/chat/completions`, {
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

async function fetchJson(url: string, options: { headers?: Record<string, string>; body: unknown }): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {})
    },
    body: JSON.stringify(options.body),
    signal: AbortSignal.timeout(30_000)
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

function requireCredential(value: string): string {
  const key = value.trim();
  if (!key || key.length > 1024) throw new Error("請輸入有效的 API Key");
  return key;
}

function requireBaseUrl(value: string | undefined): string {
  if (!value?.trim()) throw new Error("OpenAI-compatible Provider 必須設定 Base URL");
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "https:") throw new Error("自訂 API Base URL 必須使用 HTTPS");
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) {
    throw new Error("自訂 API Base URL 不可指向本機位址");
  }
  return parsed.toString().replace(/\/$/, "");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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
    if (start >= 0 && end > start) return asRecord(JSON.parse(trimmed.slice(start, end + 1)));
    throw new Error("AI 回應不是有效 JSON");
  }
}
