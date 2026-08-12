import type { AIConfig, AIProvider } from "./types";

export interface AIRequest {
  config: AIConfig | undefined;
  system: string;
  prompt: string;
}

export interface AIResult {
  text: string;
  provider: AIProvider;
  model: string;
}

export const MAX_AI_KEYS = 8;

class AIProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: string
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}

export function normalizeCredentialPool(values: readonly string[]): string[] {
  const unique: string[] = [];
  for (const raw of values) {
    const key = requireCredential(raw);
    if (!unique.includes(key)) unique.push(key);
    if (unique.length >= MAX_AI_KEYS) break;
  }
  if (unique.length === 0) throw new Error("請輸入至少 1 組有效的 API Key");
  return unique;
}

export async function callAIWithKeys(apiKeys: readonly string[], request: AIRequest): Promise<AIResult> {
  const keys = normalizeCredentialPool(apiKeys);
  let lastError: unknown;
  for (let index = 0; index < keys.length; index += 1) {
    try {
      return await callAI(keys[index]!, request);
    } catch (error) {
      lastError = error;
      if (index >= keys.length - 1 || !isRetryableKeyFailure(error)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("AI provider 呼叫失敗");
}

export async function callAI(apiKey: string, request: AIRequest): Promise<AIResult> {
  const key = requireCredential(apiKey);
  const config = request.config;
  if (!config) throw new Error("AI 玩家設定遺失");
  const { provider, model } = config;
  switch (provider) {
    case "openai":
      return callOpenAI(key, model, request.system, request.prompt);
    case "gemini":
      return callGemini(key, model, request.system, request.prompt);
    case "deepseek":
      return callDeepSeek(key, model, request.system, request.prompt);
    case "openai-compatible":
      return callOpenAICompatible(key, requireBaseUrl(config.baseUrl), model, request.system, request.prompt);
    default:
      return assertNever(provider);
  }
}

function isRetryableKeyFailure(error: unknown): boolean {
  if (!(error instanceof AIProviderError)) return false;
  if (error.status === 401 || error.status === 403 || error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500) return true;
  if (error.status !== 400) return false;
  const detail = error.detail.toLowerCase();
  return ["api key", "api_key", "keyinvalid", "invalid key", "quota", "rate limit", "resource exhausted"].some((needle) => detail.includes(needle));
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

async function fetchJson(url: string, options: { headers: Record<string, string>; body: unknown }): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...options.headers },
    body: JSON.stringify(options.body)
  });
  const text = await response.text();
  if (!response.ok) throw new AIProviderError(`AI provider HTTP ${response.status}`, response.status, text.slice(0, 1000));
  try { return JSON.parse(text); }
  catch { throw new Error("AI provider 回傳非 JSON 內容"); }
}

function extractOpenAIText(data: unknown): string {
  const root = asRecord(data);
  const output = asArray(root.output);
  const chunks: string[] = [];
  for (const item of output) {
    const content = asArray(asRecord(item).content);
    for (const part of content) {
      const record = asRecord(part);
      if (record.type === "output_text" && typeof record.text === "string") chunks.push(record.text);
    }
  }
  const text = chunks.join("\n").trim();
  if (!text) throw new Error("OpenAI 回傳空白內容");
  return text;
}

function extractChatCompletionText(data: unknown): string {
  const choices = asArray(asRecord(data).choices);
  const first = asRecord(choices[0]);
  const message = asRecord(first.message);
  const text = typeof message.content === "string" ? message.content.trim() : "";
  if (!text) throw new Error("AI provider 回傳空白內容");
  return text;
}

function requireCredential(value: string): string {
  const key = value.trim();
  if (!key) throw new Error("API Key 不可為空");
  return key;
}

function requireBaseUrl(value: string | undefined): string {
  const url = (value || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(url)) throw new Error("OpenAI Compatible Base URL 必須使用 https://");
  return url;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function assertNever(value: never): never {
  throw new Error(`不支援的 AI provider：${String(value)}`);
}
