export type TranslationLocale = "zh-TW" | "zh-CN" | "en";

export const GOOGLE_TRANSLATE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";
export const MYMEMORY_TRANSLATE_ENDPOINT = "https://api.mymemory.translated.net/get";
export const MAX_TRANSLATION_TEXTS = 40;
export const MAX_TRANSLATION_TEXT_LENGTH = 4200;
export const MAX_TRANSLATION_TOTAL_LENGTH = 12000;
export const GOOGLE_TRANSLATE_MAX_CONCURRENCY = 4;
export const REQUEST_TIMEOUT_MS = 6500;
export const MYMEMORY_HEDGE_DELAY_MS = 180;
export const GOOGLE_PREFERENCE_GRACE_MS = 140;
export const MYMEMORY_MAX_BYTES = 500;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type TranslationCandidate = { translatedText: string; provider: "google" | "mymemory" };

const inFlightTranslations = new Map<string, Promise<string>>();

export function normalizeTranslationLocale(value: unknown): TranslationLocale | undefined {
  if (value === "zh-TW" || value === "zh-CN" || value === "en") return value;
  return undefined;
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
  texts: string[],
  targetLocale: TranslationLocale,
  sourceLocale?: TranslationLocale
): Promise<string[]> {
  if (sourceLocale && sourceLocale === targetLocale) return [...texts];
  if (!texts.length) return [];

  return mapWithConcurrency(texts, GOOGLE_TRANSLATE_MAX_CONCURRENCY, (text) =>
    translateTextCoalesced(fetcher, text, targetLocale, sourceLocale)
  );
}

function translateTextCoalesced(
  fetcher: FetchLike,
  text: string,
  targetLocale: TranslationLocale,
  sourceLocale?: TranslationLocale
): Promise<string> {
  const key = `${sourceLocale ?? "auto"}\u0000${targetLocale}\u0000${text}`;
  const existing = inFlightTranslations.get(key);
  if (existing) return existing;

  const task = translateWithLowLatency(fetcher, text, targetLocale)
    .then((translated) => {
      if (!translated) throw new Error("玩家聊天翻譯服務暫時無法使用");
      return translated;
    })
    .finally(() => {
      if (inFlightTranslations.get(key) === task) inFlightTranslations.delete(key);
    });
  inFlightTranslations.set(key, task);
  return task;
}

async function translateWithLowLatency(
  fetcher: FetchLike,
  text: string,
  targetLocale: TranslationLocale
): Promise<string> {
  let winnerChosen = false;
  const googlePromise = translateViaGoogle(fetcher, text, targetLocale).catch(() => "");
  const myMemoryPromise = delay(MYMEMORY_HEDGE_DELAY_MS)
    .then(async () => {
      if (winnerChosen || !canUseMyMemoryTranslation(text, targetLocale)) return "";
      return translateViaMyMemory(fetcher, text, targetLocale).catch(() => "");
    })
    .catch(() => "");

  const candidates: Promise<TranslationCandidate>[] = [
    googlePromise.then((translatedText) => ({ translatedText, provider: "google" })),
    myMemoryPromise.then((translatedText) => ({ translatedText, provider: "mymemory" }))
  ];
  const firstResult = await firstUsefulTranslation(candidates);

  if (!firstResult) {
    winnerChosen = true;
    return "";
  }
  if (firstResult.provider === "google") {
    winnerChosen = true;
    return firstResult.translatedText;
  }

  const preferredGoogleResult = await Promise.race([
    googlePromise,
    delay(GOOGLE_PREFERENCE_GRACE_MS).then(() => "")
  ]);
  winnerChosen = true;
  return preferredGoogleResult || firstResult.translatedText;
}

async function translateViaGoogle(fetcher: FetchLike, text: string, targetLocale: TranslationLocale): Promise<string> {
  const url = new URL(GOOGLE_TRANSLATE_ENDPOINT);
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", targetLocale);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);

  const response = await fetchWithTimeout(fetcher, url);
  if (!response.ok) throw new Error(`Google Translate HTTP ${response.status}`);
  const payload = await response.json().catch(() => undefined) as unknown;
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) return "";

  const translated = payload[0]
    .map((item) => Array.isArray(item) && typeof item[0] === "string" ? item[0] : "")
    .join("");
  return normalizeTranslationText(translated);
}

async function translateViaMyMemory(
  fetcher: FetchLike,
  text: string,
  targetLocale: TranslationLocale
): Promise<string> {
  const source = detectSourceLanguageCode(text, targetLocale);
  if (!source || source === targetLocale || utf8ByteLength(text) > MYMEMORY_MAX_BYTES) return "";

  const url = new URL(MYMEMORY_TRANSLATE_ENDPOINT);
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", `${source}|${targetLocale}`);
  const response = await fetchWithTimeout(fetcher, url);
  if (!response.ok) throw new Error(`MyMemory HTTP ${response.status}`);
  const payload = await response.json().catch(() => undefined) as unknown;
  const root = asRecord(payload);
  const responseData = asRecord(root.responseData);
  const direct = normalizeTranslationText(responseData.translatedText);
  if (direct) return direct;

  const matches = Array.isArray(root.matches) ? root.matches : [];
  for (const match of matches) {
    const translated = normalizeTranslationText(asRecord(match).translation);
    if (translated) return translated;
  }
  return "";
}

function canUseMyMemoryTranslation(text: string, targetLocale: TranslationLocale): boolean {
  const source = detectSourceLanguageCode(text, targetLocale);
  return Boolean(source && source !== targetLocale && utf8ByteLength(text) <= MYMEMORY_MAX_BYTES);
}

function detectSourceLanguageCode(text: string, targetLocale: TranslationLocale): TranslationLocale | undefined {
  const normalized = text.trim();
  if (!normalized) return undefined;
  const hasCjk = /[\u3400-\u9FFF]/.test(normalized);
  const letters = (normalized.match(/[A-Za-z]/g) || []).length;
  const cjk = (normalized.match(/[\u3400-\u9FFF]/g) || []).length;
  const likelyEnglish = letters > 0 && (cjk === 0 || letters >= cjk * 1.5);

  if (targetLocale === "en") {
    if (hasCjk) return "zh-TW";
    if (likelyEnglish) return "en";
    return undefined;
  }
  if (likelyEnglish) return "en";
  if (hasCjk) return "zh-TW";
  return undefined;
}

async function fetchWithTimeout(fetcher: FetchLike, input: RequestInfo | URL): Promise<Response> {
  return fetcher(input, { method: "GET", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

function firstUsefulTranslation<T extends { translatedText: string }>(promises: Promise<T>[]): Promise<T | null> {
  return new Promise((resolve) => {
    let remaining = promises.length;
    let settled = false;
    for (const promise of promises) {
      promise.then((result) => {
        if (settled) return;
        if (result.translatedText) {
          settled = true;
          resolve(result);
          return;
        }
        remaining -= 1;
        if (remaining === 0) resolve(null);
      }).catch(() => {
        remaining -= 1;
        if (!settled && remaining === 0) resolve(null);
      });
    }
  });
}

async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]!, currentIndex);
    }
  }
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function normalizeTranslationText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
