import test from "node:test";
import assert from "node:assert/strict";
import {
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
  assert.throws(() => validateTranslationTexts(["x".repeat(1201)]), /1200/);
});

test("translation preserves ordering and explicitly distinguishes Simplified from Traditional Chinese", async () => {
  let captured;
  const ai = {
    async run(model, input) {
      assert.match(model, /llama-3\.1-8b-instruct-fast/);
      assert.ok(input && typeof input === "object");
      captured = input;
      return { response: '{"translations":["狼人杀","你好"]}' };
    }
  };
  assert.deepEqual(await translateTexts(ai, ["狼人殺", "哈囉"], "zh-CN", "zh-TW"), ["狼人杀", "你好"]);
  assert.match(JSON.stringify(captured), /Mainland Simplified Chinese/);
  assert.match(JSON.stringify(captured), /detect the actual language/);
});

test("same source and target locale skips model inference", async () => {
  let called = false;
  const ai = { async run() { called = true; return { response: "{}" }; } };
  assert.deepEqual(await translateTexts(ai, ["原文"], "zh-TW", "zh-TW"), ["原文"]);
  assert.equal(called, false);
});
