export type TranslationLocale = "zh-TW" | "zh-CN" | "en";

export const GOOGLE_TRANSLATE_ENDPOINT = "https://translation.googleapis.com/language/translate/v2";
export const MAX_TRANSLATION_TEXTS = 40;
export const MAX_TRANSLATION_TEXT_LENGTH = 1200;
export const MAX_TRANSLATION_TOTAL_LENGTH = 12000;
export const MAX_TRANSLATION_KEYS = 8;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

class GoogleTranslateError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: string
  ) {
    super(message);
    this.name = "GoogleTranslateError";
  }
}

export function normalizeTranslationLocale(value: unknown): TranslationLocale | undefined {
  if (value === "zh-TW" || value === "zh-CN" || value === "en") return value;
  return undefined;
}

export function parseGoogleTranslateApiKeys(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const out: string[] = [];
  for (const item of raw.split(/[\n,;]+/g)) {
    const key = item.trim();
    if (!key || key.length > 1024 || out.includes(key)) continue;
    out.push(key);
    if (out.length >= MAX_TRANSLATION_KEYS) break;
  }
  return out;
}

export function validateTranslationTexts(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TRANSLATION_TEXTS) {
    throw new Error(`翻譯文字必須是 1~${MAX_TRANSLATION_TEXTS} 筆字串`);
  }
  const texts = value.map((item) => {
    if (typeof item !== "string") throw new Error("翻譯文字必須是字串");
    const text = item.trim();
    if (!text) throw new Error("翻譯文字不能為空白");
    if (text.length > MAX_TRANSLATION_TEXT_LENGTH) throw new Error(`單筆翻譯文字不可超過 ${MAX_TRANSLATION_TEXT_LENGTH} 字元`);
    return text;
  });
  if (texts.reduce((sum, text) => sum + text.length, 0) > MAX_TRANSLATION_TOTAL_LENGTH) {
    throw new Error(`單次翻譯總長度不可超過 ${MAX_TRANSLATION_TOTAL_LENGTH} 字元`);
  }
  return texts;
}

export async function translateTexts(
  fetcher: FetchLike,
  apiKeys: readonly string[],
  texts: string[],
  targetLocale: TranslationLocale,
  sourceLocale?: TranslationLocale
): Promise<string[]> {
  if (sourceLocale && sourceLocale === targetLocale) return [...texts];
  if (!texts.length) return [];
  if (!apiKeys.length) throw new Error("Google 翻譯尚未設定 API Key");

  let lastError: unknown;
  for (let index = 0; index < apiKeys.length; index += 1) {
    const key = apiKeys[index]?.trim();
    if (!key) continue;
    try {
      return await translateWithKey(fetcher, key, texts, targetLocale, sourceLocale);
    } catch (error) {
      lastError = error;
      if (index >= apiKeys.length - 1 || !isRetryableGoogleKeyFailure(error)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Google 翻譯呼叫失敗");
}

async function translateWithKey(
  fetcher: FetchLike,
  apiKey: string,
  texts: string[],
  targetLocale: TranslationLocale,
  sourceLocale?: TranslationLocale
): Promise<string[]> {
  const url = `${GOOGLE_TRANSLATE_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      q: texts,
      target: targetLocale,
      ...(sourceLocale ? { source: sourceLocale } : {}),
      format: "text"
    }),
    signal: AbortSignal.timeout(12_000)
  });
  const payload = await response.json().catch(() => undefined) as unknown;
  if (!response.ok) {
    const detail = googleErrorDetail(payload);
    throw new GoogleTranslateError(`Google Translation HTTP ${response.status}${detail ? `: ${detail}` : ""}`, response.status, detail);
  }

  const root = asRecord(payload);
  const data = asRecord(root.data);
  const rows = Array.isArray(data.translations) ? data.translations : [];
  if (rows.length !== texts.length) throw new Error("Google 翻譯回傳筆數不一致");
  return rows.map((row, index) => {
    const translated = asRecord(row).translatedText;
    if (typeof translated !== "string" || !translated.trim()) return texts[index]!;
    return decodeHtmlEntities(translated.trim()).slice(0, Math.max(MAX_TRANSLATION_TEXT_LENGTH * 3, texts[index]!.length * 4));
  });
}

function isRetryableGoogleKeyFailure(error: unknown): boolean {
  if (!(error instanceof GoogleTranslateError)) return false;
  if ([401, 403, 408, 409, 429].includes(error.status) || error.status >= 500) return true;
  if (error.status !== 400) return false;
  const detail = error.detail.toLowerCase();
  return ["api key", "keyinvalid", "key not valid", "quota", "rate limit", "resource exhausted", "daily limit"].some((needle) => detail.includes(needle));
}

function googleErrorDetail(payload: unknown): string {
  const root = asRecord(payload);
  const error = asRecord(root.error);
  const message = error.message ?? root.message;
  return typeof message === "string" ? message.slice(0, 300) : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|quot|apos|#39|amp|lt|gt);/gi, (full, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === "quot") return '"';
    if (lower === "apos" || lower === "#39") return "'";
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower.startsWith("#x")) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    if (lower.startsWith("#")) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    return full;
  });
}
