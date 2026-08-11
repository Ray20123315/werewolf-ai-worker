import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

function source(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

test("admin fixed-copy helper is valid JavaScript and is loaded before the admin module", () => {
  const path = fileURLToPath(new URL("../public/admin-ui-copy.js", import.meta.url));
  const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const js = source("../public/admin-ui-copy.js");
  const html = source("../public/admin.html");
  assert.match(js, /"zh-TW"/);
  assert.match(js, /"zh-CN"/);
  assert.match(js, /en:/);
  assert.match(js, /Token 只保留在這個瀏覽器 session/);
  assert.match(js, /The token stays only in this browser session/);
  assert.match(js, /#languageSelect/);
  assert.match(html, /<script src="\/admin-ui-copy\.js"><\/script>\s*<script type="module" src="\/admin\.js"><\/script>/s);
  assert.match(html, /id="adminTokenHelp"/);
});
