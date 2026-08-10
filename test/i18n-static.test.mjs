import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.localStorage = { getItem() { return null; }, setItem() {} };
if (!globalThis.navigator) Object.defineProperty(globalThis, "navigator", { value: { language: "zh-TW" }, configurable: true });
const { knownText, normalizeLocale } = await import("../public/i18n.js");

test("UI dictionary has distinct Traditional Simplified and English product labels", () => {
  assert.equal(knownText("狼人殺", "zh-TW"), "狼人殺");
  assert.equal(knownText("狼人殺", "zh-CN"), "狼人杀");
  assert.equal(knownText("狼人殺", "en"), "Werewolf");
  assert.equal(knownText("建立房間", "zh-CN"), "创建房间");
  assert.equal(knownText("建立房間", "en"), "Create room");
});

test("browser locale normalization keeps zh-TW zh-CN and en separate", () => {
  assert.equal(normalizeLocale("zh-Hant-TW"), "zh-TW");
  assert.equal(normalizeLocale("zh-CN"), "zh-CN");
  assert.equal(normalizeLocale("zh-Hans"), "zh-CN");
  assert.equal(normalizeLocale("en-US"), "en");
});

test("page exposes a persistent three-language selector and client tags player messages with locale", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(html, /id="languageSelect"/);
  assert.match(html, /value="zh-TW"/);
  assert.match(html, /value="zh-CN"/);
  assert.match(html, /value="en"/);
  assert.match(app, /type: "chat", content, locale: getLocale\(\)/);
  assert.match(app, /type: "debate_speech", content, locale: getLocale\(\)/);
  assert.match(app, /\/translate`/);
});

test("server config includes authenticated room translation endpoint and Workers AI binding", () => {
  const index = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(index, /\/translate\$\/\);/);
  assert.match(index, /getStateByToken\(token\)/);
  assert.match(wrangler, /"ai"\s*:\s*\{/);
  assert.match(wrangler, /"binding"\s*:\s*"AI"/);
});


test("room state preserves original player text plus source locale instead of persisted translated variants", () => {
  const types = readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
  const room = readFileSync(new URL("../src/room.ts", import.meta.url), "utf8");
  assert.match(types, /sourceLocale\?: AppLocale/);
  assert.match(types, /type: "chat"; content: string; locale\?: AppLocale/);
  assert.match(types, /type: "debate_speech"; content: string; locale\?: AppLocale/);
  assert.match(room, /this\.chatMessage\(state, actor, this\.normalizeChat\(content\), this\.normalizeMessageLocale\(locale\)\)/);
  assert.match(room, /this\.recordDebateSpeech\(state, actor, this\.normalizeSpeech\(content\), this\.normalizeMessageLocale\(locale\)\)/);
});

test("dynamic DOM translations read back from the same zh-TW cache key used for translation requests", () => {
  const i18n = readFileSync(new URL("../public/i18n.js", import.meta.url), "utf8");
  assert.doesNotMatch(i18n, /displayText\(item\.source, "auto", locale\)/);
  assert.match(i18n, /displayText\(item\.source, "zh-TW", locale\)/);
});
