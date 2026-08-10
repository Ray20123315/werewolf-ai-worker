import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const publicScripts = [
  "../public/app.js",
  "../public/i18n.js",
  "../public/game-i18n.js",
  "../public/role-name-i18n.js",
  "../public/ui-fixes.js",
  "../public/chat-channels.js",
  "../public/ai-form.js",
  "../public/admin.js"
];

function source(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

test("browser JavaScript files pass syntax checks", () => {
  for (const relative of publicScripts) {
    const path = fileURLToPath(new URL(relative, import.meta.url));
    const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
    assert.equal(result.status, 0, `${relative} syntax failed:\n${result.stderr || result.stdout}`);
  }
});

test("no runtime helper replaces the game's native WebSocket constructor", () => {
  for (const relative of ["../public/ui-fixes.js", "../public/chat-channels.js", "../public/ai-form.js"]) {
    const js = source(relative);
    assert.doesNotMatch(js, /window\.WebSocket\s*=/, relative);
    assert.doesNotMatch(js, /extends\s+NativeWebSocket/, relative);
  }
  const channels = source("../public/chat-channels.js");
  assert.match(channels, /channelSocket\s*=\s*socket/);
  assert.match(channels, /const socket = new WebSocket\(/);
});

test("start-game DOM observers cannot self-trigger an infinite disabled or childList loop", () => {
  const channels = source("../public/chat-channels.js");
  const ui = source("../public/ui-fixes.js");

  assert.match(channels, /if \(element && element\.disabled !== disabled\) element\.disabled = disabled/);
  assert.match(channels, /attributeFilter: \["disabled"\]/);
  assert.doesNotMatch(channels, /input\.disabled\s*=\s*blocked;\s*button\.disabled\s*=\s*blocked/);

  assert.match(ui, /gameObserver\?\.disconnect\(\)/);
  assert.match(ui, /dialogObserver\?\.disconnect\(\)/);
  assert.match(ui, /finally \{\s*observeRuntime\(\);\s*\}/s);
  assert.match(ui, /if \(button\.textContent !== symbol\) button\.textContent = symbol/);
});

test("AI bulk join keeps the page and form state while storing keys for every created AI", () => {
  const ai = source("../public/ai-form.js");
  const html = source("../public/index.html");
  const index = source("../src/index.ts");
  const room = source("../src/room.ts");

  assert.match(html, /name="count"[^>]*min="1"[^>]*max="100"[^>]*value="1"/);
  assert.match(html, /id="aiNameBaseLabel"/);
  assert.match(html, /id="aiBatchHint"/);
  assert.match(html, /<script src="\/ai-form\.js"><\/script>\s*<script type="module" src="\/app\.js"><\/script>/s);

  assert.match(ai, /const BATCH_MAX = 100/);
  assert.match(ai, /Array\.from\(\{ length: count \}, \(_, index\) => normalizeName\(`\$\{base\}\$\{index \+ 1\}`\)\)/);
  assert.match(ai, /assertNamesAvailable\(id, session\.token, names\)/);
  assert.match(ai, /for \(const item of names\)/);
  assert.match(ai, /fetch\(url, options\)/);
  assert.match(ai, /keys\[body\.playerId\] = apiKeys;\s*writeAIKeys\(id, keys\);/s);
  assert.match(ai, /form\.addEventListener\("submit", handleSubmit, \{ capture: true \}\)/);
  assert.match(ai, /event\.stopImmediatePropagation\(\)/);
  assert.doesNotMatch(ai, /form\.reset\(/);
  assert.doesNotMatch(ai, /location\.reload\(/);
  assert.doesNotMatch(ai, /event\.currentTarget/);

  assert.match(index, /action === "ai" && request\.method === "POST"/);
  assert.match(index, /room\.addAI\(stringField\(body, "token"\), stringField\(body, "name"\), parseAIConfig\(body\)\)/);
  assert.match(room, /async addAI\(hostToken: string, name: string, ai: AIConfig\)/);
  assert.match(room, /state\.players\.push\(player\)/);
  assert.match(room, /this\.touchAndSave\(state\);\s*this\.broadcast\(state\);/s);
});

test("AI bulk form owns fixed zh-TW, zh-CN, and en labels", () => {
  const ai = source("../public/ai-form.js");
  assert.match(ai, /"zh-TW"/);
  assert.match(ai, /"zh-CN"/);
  assert.match(ai, /en:/);
  assert.match(ai, /nameBase: "AI 名稱基底"/);
  assert.match(ai, /nameBase: "AI 名称前缀"/);
  assert.match(ai, /nameBase: "AI name prefix"/);
  assert.match(ai, /languageSelect/);
});

test("fixed game translation stays local while player chat keeps the native remote path", () => {
  const ui = source("../public/ui-fixes.js");
  assert.match(ui, /if \(body\?\.sourceLocale\) return Promise\.resolve\(localTranslationResponse\(body\)\)/);
  assert.match(ui, /return nativeFetch\(input, init\)/);
  assert.match(ui, /fixed\.text\(source, targetLocale\)/);
});
