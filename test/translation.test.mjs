import test from "node:test";
import assert from "node:assert/strict";
import { MAX_AI_KEYS, normalizeCredentialPool, callAIWithKeys } from "../.test-build/ai.js";
import {
  GOOGLE_TRANSLATE_ENDPOINT,
  MAX_TRANSLATION_KEYS,
  MAX_TRANSLATION_TEXTS,
  normalizeTranslationLocale,
  parseGoogleTranslateApiKeys,
  translateTexts,
  validateTranslationTexts
} from "../.test-build/translate.js";

test("translation locales are restricted to zh-TW zh-CN and en", () => {
  assert.equal(normalizeTranslationLocale("zh-TW"), "zh-TW");
  assert.equal(normalizeTranslationLocale("zh-CN"), "zh-CN");
  assert.equal(normalizeTranslationLocale("en"), "en");
  assert.equal(normalizeTranslationLocale("fr"), undefined);
});

test("Google translation deployment key pool is deduplicated and bounded", () => {
  const raw = Array.from({ length: MAX_TRANSLATION_KEYS + 3 }, (_, index) => `key-${index}`).join("\n") + "\nkey-0";
  assert.deepEqual(parseGoogleTranslateApiKeys(raw), Array.from({ length: MAX_TRANSLATION_KEYS }, (_, index) => `key-${index}`));
  assert.deepEqual(parseGoogleTranslateApiKeys(" a, b; a\n c "), ["a", "b", "c"]);
  assert.deepEqual(parseGoogleTranslateApiKeys(undefined), []);
});

test("translation batch is bounded", () => {
  assert.deepEqual(validateTranslationTexts(["狼人殺", "hello"]), ["狼人殺", "hello"]);
  assert.throws(() => validateTranslationTexts([]), /1~/);
  assert.throws(() => validateTranslationTexts(Array.from({ length: MAX_TRANSLATION_TEXTS + 1 }, () => "x")), /1~/);
  assert.throws(() => validateTranslationTexts(["x".repeat(1201)]), /1200/);
});

test("Google Cloud Translation v2 preserves ordering and explicit Traditional/Simplified locale codes", async () => {
  let capturedUrl = "";
  let capturedBody;
  const fetcher = async (input, init) => {
    capturedUrl = String(input);
    capturedBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ data: { translations: [{ translatedText: "狼人杀" }, { translatedText: "你好 &amp; 再见" }] } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  assert.deepEqual(await translateTexts(fetcher, ["google-key"], ["狼人殺", "哈囉 & 再見"], "zh-CN", "zh-TW"), ["狼人杀", "你好 & 再见"]);
  assert.match(capturedUrl, new RegExp(`^${GOOGLE_TRANSLATE_ENDPOINT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?key=`));
  assert.deepEqual(capturedBody, { q: ["狼人殺", "哈囉 & 再見"], target: "zh-CN", source: "zh-TW", format: "text" });
});

test("Google translation retries the next key only for credential quota or transient failures", async () => {
  const attempted = [];
  const fetcher = async (input) => {
    const url = new URL(String(input));
    const key = url.searchParams.get("key");
    attempted.push(key);
    if (key === "bad-key") {
      return new Response(JSON.stringify({ error: { message: "API key not valid. Please pass a valid API key." } }), {
        status: 403,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ data: { translations: [{ translatedText: "Hello" }] } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  assert.deepEqual(await translateTexts(fetcher, ["bad-key", "good-key"], ["你好"], "en", "zh-TW"), ["Hello"]);
  assert.deepEqual(attempted, ["bad-key", "good-key"]);
});

test("same source and target locale skips Google translation and does not require a key", async () => {
  let called = false;
  const fetcher = async () => { called = true; throw new Error("should not run"); };
  assert.deepEqual(await translateTexts(fetcher, [], ["原文"], "zh-TW", "zh-TW"), ["原文"]);
  assert.equal(called, false);
});

test("AI BYOK key pools support up to eight deduplicated keys", () => {
  const values = Array.from({ length: MAX_AI_KEYS + 3 }, (_, index) => `ai-key-${index}`);
  assert.deepEqual(normalizeCredentialPool([...values, "ai-key-0"]), values.slice(0, MAX_AI_KEYS));
  assert.throws(() => normalizeCredentialPool([]), /至少 1 組/);
});

test("AI provider failover uses the next key on rate limits", async () => {
  const originalFetch = globalThis.fetch;
  const attempted = [];
  globalThis.fetch = async (_input, init) => {
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    attempted.push(auth);
    if (auth === "Bearer first-key") {
      return new Response(JSON.stringify({ error: { message: "rate limit exceeded" } }), {
        status: 429,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ output_text: '{"message":"ok"}' }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const result = await callAIWithKeys(["first-key", "second-key"], {
      config: { provider: "openai", model: "test-model" },
      system: "system",
      prompt: "prompt"
    });
    assert.equal(result.text, '{"message":"ok"}');
    assert.deepEqual(attempted, ["Bearer first-key", "Bearer second-key"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
