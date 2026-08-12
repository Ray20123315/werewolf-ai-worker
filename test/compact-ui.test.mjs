import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

function source(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

test("compact UI scripts pass browser syntax checks", () => {
  for (const relative of ["../public/static-copy.js", "../public/compact-ui.js", "../public/private-inspection.js", "../public/ui-runtime-repair.js"]) {
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
  assert.doesNotMatch(js, /cloneNode\s*\(/);
  assert.doesNotMatch(js, /roleSetupForm[^\n]*\.innerHTML\s*=/);

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
  assert.match(fixed, /正式玩家 \(\\d\+\) 人/);
  assert.match(fixed, /"zh-TW"/);
  assert.match(fixed, /"zh-CN"/);
  assert.match(fixed, /en:/);
  assert.match(admin, /src="\/game-i18n\.js"/);
  assert.match(admin, /src="\/static-copy\.js"/);
  assert.match(admin, /src="\/ui-fixes\.js"/);
});

test("desktop room is a single viewport with only core controls", () => {
  const html = source("../public/index.html");
  const css = source("../public/compact-ui.css");
  const repair = source("../public/ui-runtime-repair.js");
  const inspection = source("../public/private-inspection.js");

  assert.match(html, /src="\/private-inspection\.js"><\/script>\s*<script src="\/ui-runtime-repair\.js"><\/script>/s);
  assert.doesNotMatch(html, /class="hero panel"/);
  assert.doesNotMatch(html, /class="mode-chip"/);
  assert.doesNotMatch(html, /class="button button-ghost admin-link"/);
  assert.doesNotMatch(html, /room-toolkit\.(?:css|js)/);
  assert.match(css, /body:has\(#game:not\(\.hidden\)\) \{ overflow: hidden; \}/);
  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /#game \.action-area \{ min-height:\s*0; overflow:\s*auto;/);
  assert.match(css, /#game \.players \{ flex:\s*1 1 auto; min-height:\s*0; max-height:\s*none; \}/);
  assert.doesNotMatch(repair, /roomCompactToggle|MODE_KEY|MODE_CLASS|room-compact-mode/);
  assert.match(inspection, /function refreshPrivateInspections\(\)/);
});

test("core form and room text use readable desktop sizes", () => {
  const styles = source("../public/styles.css");
  const compact = source("../public/compact-ui.css");

  assert.match(styles, /label \{[^}]*font-size:\s*15px;/);
  assert.match(styles, /input, select, textarea \{[^}]*font-size:\s*15px;/);
  assert.match(styles, /\.message p \{[^}]*font-size:\s*15px;/);
  assert.match(styles, /\.player-name strong \{ font-size:\s*15px; \}/);
  assert.match(compact, /#game \.action-area:has\(#debateSpeech\)/);
});

test("fixed copy stays local while auto-detected player text still reaches live translation", () => {
  const repair = source("../public/ui-runtime-repair.js");
  const app = source("../public/app.js");

  assert.match(repair, /explicitSource = typeof body\.sourceLocale === "string" && body\.sourceLocale !== "auto"/);
  assert.match(repair, /window\.WerewolfGameI18n/);
  assert.match(repair, /localOnly: true/);
  assert.match(repair, /return nativeFetch\(input, init\)/);
  assert.match(app, /m\.kind === "chat" \|\| m\.kind === "speech" \? "auto"/);
  assert.match(app, /if \(sourceLocale && sourceLocale !== "auto"\) body\.sourceLocale = sourceLocale/);
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
