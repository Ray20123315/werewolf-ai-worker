import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.localStorage = { getItem() { return null; }, setItem() {} };
if (!globalThis.navigator) Object.defineProperty(globalThis, "navigator", { value: { language: "zh-TW" }, configurable: true });
const { displayText, ensureTranslations, knownText, normalizeLocale, translationFailure } = await import("../public/i18n.js");

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
  assert.equal(knownText("不再顯示此確認", "zh-CN"), "不再显示此确认");
  assert.equal(knownText("確認操作", "en"), "Confirm action");
});

test("browser locale normalization keeps zh-TW zh-CN and en separate", () => {
  assert.equal(normalizeLocale("zh-Hant-TW"), "zh-TW");
  assert.equal(normalizeLocale("zh-CN"), "zh-CN");
  assert.equal(normalizeLocale("zh-Hans"), "zh-CN");
  assert.equal(normalizeLocale("en-US"), "en");
});

test("page exposes three-language UI, automatic role setup, multi-key AI BYOK, and fixed equal exile voting", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const house = readFileSync(new URL("../public/house-rules.js", import.meta.url), "utf8");
  assert.match(html, /id="languageSelect"/);
  assert.match(html, /value="zh-TW"/);
  assert.match(html, /value="zh-CN"/);
  assert.match(html, /value="en"/);
  assert.match(html, /id="autoRoleSetup"/);
  assert.match(html, /textarea name="apiKeys"/);
  assert.match(html, /id="tieRuleSelect"/);
  assert.match(html, /<option value="random_elimination">最高票並列時隨機抽 1 人<\/option>/);
  assert.doesNotMatch(html, /value="no_elimination"|value="revote"|value="pk_revote"/);
  assert.match(html, /警長選舉保留；一般放逐投票與其他玩家相同，都是 1 票。/);
  assert.match(house, /sheriffHelp: "警長選舉保留；一般放逐投票與其他玩家相同，都是 1 票。"/);
  assert.match(house, /sheriffHelp: "警长选举保留；普通放逐投票与其他玩家相同，都是 1 票。"/);
  assert.match(house, /Sheriff election stays enabled, but the sheriff has the same single exile vote/);
  assert.match(house, /tieFixed: "最高票並列時隨機抽 1 人"/);
  assert.match(house, /tieFixed: "最高票并列时随机抽 1 人"/);
  assert.match(house, /Randomly eliminate 1 tied top player/);
  assert.doesNotMatch(house, /sheriffSecond:/);
  assert.match(html, /id="confirmDialog"/);
  assert.match(html, /id="confirmDialogDontShow"/);
  assert.match(html, /\/game-i18n\.js/);
  assert.match(html, /\/role-name-i18n\.js/);
  assert.match(html, /\/ui-fixes\.js/);
  assert.match(app, /type: "configure_settings", settings: \{ autoRoleSetup:/);
  assert.match(app, /parseApiKeyPool/);
  assert.match(app, /apiKeys: keys/);
  assert.match(app, /type: "chat", content \}/);
  assert.match(app, /type: "debate_speech", content \}/);
  assert.doesNotMatch(app, /type: "chat", content, locale: getLocale\(\)/);
  assert.doesNotMatch(app, /type: "debate_speech", content, locale: getLocale\(\)/);
  assert.match(app, /\/translate`/);
  assert.match(app, /confirmAction\("kick", prompt\)/);
  assert.match(app, /dialog\.showModal\(\)/);
  assert.match(app, /werewolf-confirm-skip:/);
  assert.doesNotMatch(app, /\bconfirm\s*\(/);
});

test("equal exile vote runtime freezes the vote snapshot before effects and only randomizes tied-highest targets", () => {
  const equalVote = readFileSync(new URL("../src/equal-vote.ts", import.meta.url), "utf8");
  const channels = readFileSync(new URL("../src/chat-channels.ts", import.meta.url), "utf8");
  assert.match(equalVote, /FIXED_TIE_RULE = "random_elimination"/);
  assert.match(equalVote, /const snapshot = createVoteSnapshot\(state\)/);
  assert.match(equalVote, /const topTargets = snapshot\.topTargetIds/);
  assert.match(equalVote, /secureShuffle\(topTargets\)\[0\]/);
  assert.match(equalVote, /areEqualVotesComplete\(state\)/);
  assert.match(equalVote, /!player\.kickedAt/);
  assert.match(channels, /installHouseRules\(GameRoomCtor\);\s*installEqualVoteRules\(GameRoomCtor\);\s*installAIFlowRules\(GameRoomCtor\);/s);
  assert.match(channels, /installCoreRules\(GameRoomCtor\);/);
});

test("server translation endpoint is authenticated and uses Userscript-style Google GTX with no Cloud Translation key", () => {
  const index = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const translate = readFileSync(new URL("../src/translate.ts", import.meta.url), "utf8");
  const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(index, /\/translate\$\/\);/);
  assert.match(index, /getStateByToken\(token\)/);
  assert.match(index, /translateTexts\(fetch, texts, targetLocale, sourceLocale\)/);
  assert.doesNotMatch(index, /GOOGLE_TRANSLATE_API_KEYS/);
  assert.match(translate, /translate\.googleapis\.com\/translate_a\/single/);
  assert.match(translate, /searchParams\.set\("client", "gtx"\)/);
  assert.match(translate, /searchParams\.set\("sl", "auto"\)/);
  assert.match(translate, /MYMEMORY_TRANSLATE_ENDPOINT/);
  assert.doesNotMatch(translate, /translation\.googleapis\.com\/language\/translate\/v2/);
  assert.doesNotMatch(translate, /parseGoogleTranslateApiKeys/);
  assert.doesNotMatch(wrangler, /"ai"\s*:\s*\{/);
  assert.doesNotMatch(wrangler, /"binding"\s*:\s*"AI"/);
});

test("room state preserves original player text plus source locale instead of persisted translated variants", () => {
  const types = readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
  const room = readFileSync(new URL("../src/room.ts", import.meta.url), "utf8");
  assert.match(types, /sourceLocale\?: AppLocale/);
  assert.match(types, /type: "chat"; content: string; locale\?: AppLocale/);
  assert.match(types, /type: "debate_speech"; content: string; locale\?: AppLocale/);
  assert.match(room, /this\.chatMessage\(state, actor, this\.normalizeChat\(content\)\)/);
  assert.match(room, /this\.recordDebateSpeech\(state, actor, this\.normalizeSpeech\(content\)\)/);
  assert.match(room, /recordDebateSpeech\(state, current, decision\.message, "zh-TW"\)/);
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

test("human chat and speech always use translation auto-detection, including legacy locale-tagged messages", () => {
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /m\.kind === "chat" \|\| m\.kind === "speech" \? "auto"/);
  assert.match(app, /translationFailure\(m\.content, sourceLocale\)/);
});

test("translation failures are visible and retryable instead of permanently cached as success", async () => {
  const result = await ensureTranslations(["你好"], "auto", async () => { throw new Error("玩家聊天翻譯服務暫時無法使用"); }, "en");
  assert.equal(result.ok, false);
  assert.equal(displayText("你好", "auto", "en"), "你好");
  assert.match(translationFailure("你好", "auto", "en"), /暫時無法使用/);
});

test("admin backend uses a registry DO, secret bearer auth, and room moderator role without exposing host controls", () => {
  const index = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../src/admin.ts", import.meta.url), "utf8");
  const room = readFileSync(new URL("../src/room.ts", import.meta.url), "utf8");
  const directory = readFileSync(new URL("../src/room-directory.ts", import.meta.url), "utf8");
  const types = readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
  const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const adminHtml = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
  const adminJs = readFileSync(new URL("../public/admin.js", import.meta.url), "utf8");
  assert.match(index, /ADMIN_PANEL_TOKENS/);
  assert.match(index, /isAdminRequest/);
  assert.match(admin, /authorization/);
  assert.match(index, /\/api\/admin\/rooms/);
  assert.match(directory, /CREATE TABLE IF NOT EXISTS rooms/);
  assert.match(directory, /CREATE TABLE IF NOT EXISTS errors/);
  assert.match(wrangler, /"ROOM_DIRECTORY"/);
  assert.match(wrangler, /"new_sqlite_classes": \["RoomDirectory"\]/);
  assert.match(types, /moderatorIds: string\[\]/);
  assert.match(types, /isModerator: boolean/);
  assert.match(types, /type: "set_moderator"/);
  assert.match(room, /只有房主或房間管理員可以踢出玩家/);
  assert.match(room, /this\.assertHost\(state, token\)/);
  assert.match(adminHtml, /id="adminLoginForm"/);
  assert.match(adminJs, /sessionStorage\.setItem\(TOKEN_KEY/);
  assert.doesNotMatch(adminJs, /localStorage\.setItem\(TOKEN_KEY/);
});
