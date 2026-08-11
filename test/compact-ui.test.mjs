import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

function source(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

test("compact UI scripts pass browser syntax checks", () => {
  for (const relative of ["../public/static-copy.js", "../public/compact-ui.js"]) {
    const path = fileURLToPath(new URL(relative, import.meta.url));
    const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
    assert.equal(result.status, 0, `${relative} syntax failed:\n${result.stderr || result.stdout}`);
  }
});

test("role configuration is moved into a compact modal without replacing the existing form", () => {
  const html = source("../public/index.html");
  const js = source("../public/compact-ui.js");
  const css = source("../public/compact-ui.css");

  assert.match(html, /id="roleSetupDetails"/);
  assert.match(html, /href="\/compact-ui\.css"/);
  assert.match(html, /src="\/static-copy\.js"/);
  assert.match(html, /<script type="module" src="\/app\.js"><\/script>\s*<script type="module" src="\/compact-ui\.js"><\/script>/s);

  assert.match(js, /#roleSetupDetails/);
  assert.match(js, /body\.append\(child\)/);
  assert.match(js, /dialog\.showModal\(\)/);
  assert.match(js, /#roleSetupForm/);
  assert.doesNotMatch(js, /innerHTML\s*=.*roleSetupForm/s);

  assert.match(css, /\.role-setup-dialog\s*\{/);
  assert.match(css, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.role-setup-dialog \.role-group \{ grid-template-columns: 1fr; \}/);
});

test("addon UI visibly includes lover alongside M and S without consuming a count input", () => {
  const js = source("../public/compact-ui.js");
  const house = source("../public/house-rules.js");

  assert.match(js, /data-lover-addon-card/);
  assert.match(js, /邱比特配對/);
  assert.match(js, /不佔本體角色槽/);
  assert.doesNotMatch(js, /data-role-count=["']lover/);
  assert.match(house, /ADDON_SETUP_IDS = new Set\(\["masochist_cultist", "sadist_leader"\]\)/);
});

test("remaining fixed labels use repository-owned static translations", () => {
  const fixed = source("../public/static-copy.js");
  const admin = source("../public/admin.html");

  for (const token of ["ADMIN", "LOBBY", "REACTION", "GAME OVER", "CONFIRM", "ROOMS", "ERRORS"]) {
    assert.equal(fixed.includes(`"${token}"`), true, `missing fixed translation for ${token}`);
  }
  assert.match(fixed, /Token 只保留在這個瀏覽器 session/);
  assert.match(fixed, /"zh-TW"/);
  assert.match(fixed, /"zh-CN"/);
  assert.match(fixed, /en:/);
  assert.match(admin, /src="\/game-i18n\.js"/);
  assert.match(admin, /src="\/static-copy\.js"/);
  assert.match(admin, /src="\/ui-fixes\.js"/);
});

test("admin layout and credential documentation stay regression protected", () => {
  const css = source("../public/compact-ui.css");
  const env = source("../.dev.vars.example");

  assert.match(css, /\.admin-login\s*\{[\s\S]*padding:/);
  assert.match(css, /\.brand-actions\s*\{[\s\S]*flex-wrap:\s*wrap/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.brand-actions \{ width: 100%; justify-content: flex-start; \}/);
  assert.match(env, /ADMIN_PANEL_TOKENS=/);
  assert.match(env, /wrangler secret put ADMIN_PANEL_TOKENS/);
});