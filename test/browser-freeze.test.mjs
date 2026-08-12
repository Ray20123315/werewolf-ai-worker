import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const core = readFileSync(new URL("../public/core-rules.js", import.meta.url), "utf8");
const repair = readFileSync(new URL("../public/ui-runtime-repair.js", import.meta.url), "utf8");

test("core UI repair disconnects its observer while mutating DOM", () => {
  assert.match(core, /let observer = null;/);
  assert.match(core, /const OBSERVER_OPTIONS = \{ childList: true, subtree: true \};/);
  assert.match(core, /function runApplyWithoutObserver\(\) \{[\s\S]*?observer\?\.disconnect\(\);[\s\S]*?apply\(\);[\s\S]*?observer\?\.observe\(document\.body, OBSERVER_OPTIONS\);[\s\S]*?\}/);
  assert.match(core, /function scheduleApply\(\) \{[\s\S]*?runApplyWithoutObserver\(\);[\s\S]*?setTimeout\(\(\) => \{[\s\S]*?runApplyWithoutObserver\(\);[\s\S]*?applying = false;/);
  assert.doesNotMatch(core, /setTimeout\(apply,\s*80\)/, "delayed repair pass must also suspend observation");
});

test("flow clarity observer is scoped to the action area and ignores text churn", () => {
  assert.match(repair, /const area = document\.querySelector\("#actionArea"\);/);
  assert.match(repair, /observer\.observe\(area, \{ childList: true, subtree: true \}\);/);
  assert.doesNotMatch(
    repair,
    /observer\.observe\(document\.body, \{ childList: true, subtree: true, characterData: true \}\);/,
    "flow repair must not observe every timer/sync text mutation on the page"
  );
});

test("freeze hotfix preserves debate flow clarity and pending-resolution wording", () => {
  assert.match(repair, /投票倒數已暫停/);
  assert.match(repair, /一般聊天已暫停/);
  assert.match(repair, /提交目標（尚未結算）/);
  assert.match(repair, /提交技能選擇（尚未結算）/);
});
