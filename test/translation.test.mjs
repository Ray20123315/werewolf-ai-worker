import test from "node:test";
import assert from "node:assert/strict";
import { MAX_AI_KEYS, normalizeCredentialPool, callAIWithKeys } from "../.test-build/ai.js";
import {
  GOOGLE_TRANSLATE_ENDPOINT,
  MYMEMORY_TRANSLATE_ENDPOINT,
  MAX_TRANSLATION_TEXTS,
  normalizeTranslationLocale,
  translateTexts,
  validateTranslationTexts
} from "../.test-build/translate.js";

test("translation locales are restricted to zh-TW zh-CN and en", () => {
  assert.equal(normalizeTranslationLocale("zh-TW"), "zh-TW");
  assert.equal(normalizeTranslationLocale("zh-CN"), "zh-CN");
  assert.equal(normalizeTranslationLocale("en"), "en");
  assert.equal(normalizeTranslationLocale("fr"), undefined);
});

test("translation batch is bounded", () => {
  assert.deepEqual(validateTranslationTexts(["狼人殺", "hello"]), ["狼人殺", "hello"]);
  assert.throws(() => validateTranslationTexts([]), /1~/);
  assert.throws(() => validateTranslationTexts(Array.from({ length: MAX_TRANSLATION_TEXTS + 1 }, () => "x")), /1~/);
  assert.throws(() => validateTranslationTexts(["x".repeat(4201)]), /4200/);
});

test("Google chat translation matches the provided Userscript client=gtx request shape", async () => {
  const captured = [];
  const fetcher = async (input) => {
    const url = new URL(String(input));
    captured.push(url);
    const source = url.searchParams.get("q");
    const translated = source === "狼人殺" ? "狼人杀" : "你好 & 再见";
    return new Response(JSON.stringify([[[translated, source, null, null]]]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  assert.deepEqual(
    await translateTexts(fetcher, ["狼人殺", "哈囉 & 再見"], "zh-CN", "zh-TW"),
    ["狼人杀", "你好 & 再见"]
  );
  assert.equal(captured.length, 2);
  for (const url of captured) {
    assert.equal(`${url.origin}${url.pathname}`, GOOGLE_TRANSLATE_ENDPOINT);
    assert.equal(url.searchParams.get("client"), "gtx");
    assert.equal(url.searchParams.get("sl"), "auto");
    assert.equal(url.searchParams.get("tl"), "zh-CN");
    assert.equal(url.searchParams.get("dt"), "t");
    assert.equal(url.searchParams.has("key"), false);
  }
});

test("MyMemory is used as a short-text fallback when Google is unavailable", async () => {
  const attempted = [];
  const fetcher = async (input) => {
    const url = new URL(String(input));
    attempted.push(`${url.origin}${url.pathname}`);
    if (`${url.origin}${url.pathname}` === GOOGLE_TRANSLATE_ENDPOINT) {
      return new Response("upstream unavailable", { status: 503 });
    }
    assert.equal(`${url.origin}${url.pathname}`, MYMEMORY_TRANSLATE_ENDPOINT);
    assert.equal(url.searchParams.get("q"), "你好");
    assert.equal(url.searchParams.get("langpair"), "zh-TW|en");
    return new Response(JSON.stringify({ responseData: { translatedText: "Hello" } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  assert.deepEqual(await translateTexts(fetcher, ["你好"], "en", "zh-TW"), ["Hello"]);
  assert.deepEqual(attempted, [GOOGLE_TRANSLATE_ENDPOINT, MYMEMORY_TRANSLATE_ENDPOINT]);
});

test("same source and target locale skips remote translation and requires no key", async () => {
  let called = false;
  const fetcher = async () => { called = true; throw new Error("should not run"); };
  assert.deepEqual(await translateTexts(fetcher, ["原文"], "zh-TW", "zh-TW"), ["原文"]);
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
