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
  assert.equal(knownText("自動配置角色（依正式玩家數）", "zh-CN"), "自动配置角色（按正式玩家数）");
  assert.equal(knownText("自動配置角色（依正式玩家數）", "en"), "Auto-configure roles (by active players)");
  assert.equal(knownText("最多 8 組，只存此瀏覽器 session", "en"), "Up to 8; stored only in this browser session");
  assert.equal(knownText("平票隨機淘汰 1 人", "zh-CN"), "平票随机淘汰 1 人");
  assert.equal(knownText("平票隨機淘汰 1 人", "en"), "Randomly eliminate 1 tied player");
});

test("browser locale normalization keeps zh-TW zh-CN and en separate", () => {
  assert.equal(normalizeLocale("zh-Hant-TW"), "zh-TW");
  assert.equal(normalizeLocale("zh-CN"), "zh-CN");
  assert.equal(normalizeLocale("zh-Hans"), "zh-CN");
  assert.equal(normalizeLocale("en-US"), "en");
});

test("page exposes three-language UI, automatic role setup, and multi-key AI BYOK", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(html, /id="languageSelect"/);
  assert.match(html, /value="zh-TW"/);
  assert.match(html, /value="zh-CN"/);
  assert.match(html, /value="en"/);
  assert.match(html, /id="autoRoleSetup"/);
  assert.match(html, /textarea name="apiKeys"/);
  assert.match(html, /value="random_elimination"/);
  assert.match(app, /type: "configure_settings", settings: \{ autoRoleSetup:/);
  assert.match(app, /parseApiKeyPool/);
  assert.match(app, /apiKeys: keys/);
  assert.match(app, /type: "chat", content, locale: getLocale\(\)/);
  assert.match(app, /type: "debate_speech", content, locale: getLocale\(\)/);
  assert.match(app, /\/translate`/);
});

test("random tie rule is server-authoritative and reuses the normal exile pipeline", () => {
  const types = readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
  const room = readFileSync(new URL("../src/room.ts", import.meta.url), "utf8");
  assert.match(types, /random_elimination/);
  assert.match(room, /state\.settings\.tieRule === "random_elimination"/);
  assert.match(room, /randomTopVoteTarget\(state\)/);
  assert.match(room, /topTargets\.length === 1 && target\?\.role === "masochist_cultist"/);
});

test("server translation endpoint uses authenticated Google Cloud Translation v2 without Workers AI binding", () => {
  const index = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const translate = readFileSync(new URL("../src/translate.ts", import.meta.url), "utf8");
  const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(index, /\/translate\$\/\);/);
  assert.match(index, /getStateByToken\(token\)/);
  assert.match(index, /GOOGLE_TRANSLATE_API_KEYS/);
  assert.match(translate, /translation\.googleapis\.com\/language\/translate\/v2/);
  assert.match(translate, /parseGoogleTranslateApiKeys/);
  assert.doesNotMatch(wrangler, /"ai"\s*:\s*\{/);
  assert.doesNotMatch(wrangler, /"binding"\s*:\s*"AI"/);
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

test("automatic role setup is server-authoritative and blocks manual role edits while enabled", () => {
  const types = readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
  const room = readFileSync(new URL("../src/room.ts", import.meta.url), "utf8");
  assert.match(types, /autoRoleSetup: boolean/);
  assert.match(room, /autoRoleSetup: false/);
  assert.match(room, /if \(state\.settings\.autoRoleSetup\) state\.roleSetup = defaultRoleSetup\(participants\.length\)/);
  assert.match(room, /自動配置角色已啟用；請先取消勾選再手動調整角色/);
  assert.match(room, /if \(raw\.autoRoleSetup\) state\.roleSetup = defaultRoleSetup/);
});

test("AI debate management uses structured server-validated day actions rather than speech keyword triggers", () => {
  const room = readFileSync(new URL("../src/room.ts", import.meta.url), "utf8");
  assert.match(room, /decideAIDebateTurn/);
  assert.match(room, /normalizeAIDayAction/);
  assert.match(room, /record\.effect !== prompt\.effect/);
  assert.match(room, /validateTargetCount\(prompt\.targetMode, targetIds\)/);
  assert.match(room, /伺服器只相信結構化 action，不從文字關鍵字觸發技能/);
  assert.doesNotMatch(room, /match\([^\n]*(自爆|決鬥)/);
});

test("dynamic DOM translations read back from the same zh-TW cache key used for translation requests", () => {
  const i18n = readFileSync(new URL("../public/i18n.js", import.meta.url), "utf8");
  assert.doesNotMatch(i18n, /displayText\(item\.source, "auto", locale\)/);
  assert.match(i18n, /displayText\(item\.source, "zh-TW", locale\)/);
});
