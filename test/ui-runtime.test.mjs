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
  "../public/admin.js"
];

test("browser JavaScript files pass syntax checks", () => {
  for (const relative of publicScripts) {
    const path = fileURLToPath(new URL(relative, import.meta.url));
    const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
    assert.equal(result.status, 0, `${relative} syntax failed:\n${result.stderr || result.stdout}`);
  }
});

test("ui fixes never replace the native WebSocket constructor", () => {
  const source = readFileSync(new URL("../public/ui-fixes.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /window\.WebSocket\s*=/);
  assert.doesNotMatch(source, /class\s+\w+\s+extends\s+NativeWebSocket/);
  assert.doesNotMatch(source, /installWebSocketObserver/);
});

test("fixed game translation stays local while player chat uses the native remote path", () => {
  const source = readFileSync(new URL("../public/ui-fixes.js", import.meta.url), "utf8");
  assert.match(source, /if \(body\?\.sourceLocale\) return Promise\.resolve\(localTranslationResponse\(body\)\)/);
  assert.match(source, /return nativeFetch\(input, init\)/);
  assert.match(source, /fixed\.text\(source, targetLocale\)/);
  assert.doesNotMatch(source, /nativeFetch\(`\/api\/rooms\/\$\{id\}\/translate`/);
});
