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

test("AI join has an independent capture-phase controller and authoritative reload path", () => {
  const ai = source("../public/ai-form.js");
  const html = source("../public/index.html");
  const index = source("../src/index.ts");
  const room = source("../src/room.ts");

  assert.match(html, /<script src="\/ai-form\.js"><\/script>\s*<script type="module" src="\/app\.js"><\/script>/s);
  assert.match(ai, /form\.addEventListener\("submit", handleSubmit, \{ capture: true \}\)/);
  assert.match(ai, /event\.stopImmediatePropagation\(\)/);
  assert.match(ai, /fetch\(`\/api\/rooms\/\$\{id\}\/ai`/);
  assert.match(ai, /sessionStorage\.setItem\(aiKeyStorageKey\(id\)/);
  assert.match(ai, /setTimeout\(\(\) => location\.reload\(\), 350\)/);
  assert.doesNotMatch(ai, /event\.currentTarget/);

  assert.match(index, /action === "ai" && request\.method === "POST"/);
  assert.match(index, /room\.addAI\(stringField\(body, "token"\), stringField\(body, "name"\), parseAIConfig\(body\)\)/);
  assert.match(room, /async addAI\(hostToken: string, name: string, ai: AIConfig\)/);
  assert.match(room, /state\.players\.push\(player\)/);
  assert.match(room, /this\.touchAndSave\(state\);\s*this\.broadcast\(state\);/s);
});

test("fixed game translation stays local while player chat keeps the native remote path", () => {
  const ui = source("../public/ui-fixes.js");
  assert.match(ui, /if \(body\?\.sourceLocale\) return Promise\.resolve\(localTranslationResponse\(body\)\)/);
  assert.match(ui, /return nativeFetch\(input, init\)/);
  assert.match(ui, /fixed\.text\(source, targetLocale\)/);
});
