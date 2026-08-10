from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, got {count}: {old[:100]!r}")
    p.write_text(text.replace(old, new, 1))


def append_once(path: str, marker: str, content: str) -> None:
    p = Path(path)
    text = p.read_text()
    if marker in text:
        raise SystemExit(f"{path}: marker already present: {marker}")
    p.write_text(text.rstrip() + "\n\n" + content.strip() + "\n")


replace_once(
    "src/game-engine.ts",
    '''  const bonus = state.roleMemory[player.id]?.voteBonus;
  return 1 + (typeof bonus === "number" ? Math.max(0, bonus) : 0);
''',
    '''  const bonus = state.roleMemory[player.id]?.voteBonus;
  const sheriffBonus = state.sheriff.sheriffId === player.id ? 1 : 0;
  return 1 + sheriffBonus + (typeof bonus === "number" ? Math.max(0, bonus) : 0);
''',
)

replace_once(
    "public/index.html",
    '                <label class="check-row"><input name="sheriffEnabled" type="checkbox" /> 啟用警長選舉</label>\n',
    '                <label class="check-row"><input name="sheriffEnabled" type="checkbox" /> 啟用警長選舉</label>\n                <p class="field-help">警長的放逐票計為 2 票。</p>\n',
)
replace_once(
    "public/index.html",
    '''  <div id="toast" class="toast hidden" role="status"></div>
  <script src="/chat-channels.js"></script>''',
    '''  <dialog id="confirmDialog" class="confirm-dialog" aria-labelledby="confirmDialogTitle" aria-describedby="confirmDialogMessage">
    <form method="dialog" class="confirm-dialog-card">
      <div class="confirm-dialog-heading"><span class="eyebrow">CONFIRM</span><h2 id="confirmDialogTitle">確認操作</h2></div>
      <p id="confirmDialogMessage" class="confirm-dialog-message"></p>
      <label class="check-row confirm-skip-row"><input id="confirmDialogDontShow" type="checkbox" /><span id="confirmDialogDontShowText">不再顯示此確認</span></label>
      <div class="confirm-dialog-actions">
        <button id="confirmDialogCancel" class="button button-ghost" type="submit" value="cancel">取消</button>
        <button id="confirmDialogConfirm" class="button button-primary" type="submit" value="confirm" autofocus>確定</button>
      </div>
    </form>
  </dialog>

  <div id="toast" class="toast hidden" role="status"></div>
  <script src="/chat-channels.js"></script>''',
)

replace_once(
    "public/app.js",
    '''  document.querySelectorAll("[data-kick]").forEach((button) => button.addEventListener("click", async () => {
    const prompt = await localizedRuntime(`確定踢出 ${nameOf(button.dataset.kick)}？被踢者不是永久封鎖，可重新加入。`);
    if (confirm(prompt)) send({ type: "kick", targetId: button.dataset.kick });
  }));''',
    '''  document.querySelectorAll("[data-kick]").forEach((button) => button.addEventListener("click", async () => {
    const prompt = await localizedRuntime(`確定踢出 ${nameOf(button.dataset.kick)}？被踢者不是永久封鎖，可重新加入。`);
    const approved = await confirmAction("kick", prompt);
    if (approved) send({ type: "kick", targetId: button.dataset.kick });
  }));''',
)
append_once(
    "public/app.js",
    "const CONFIRM_SKIP_PREFIX = \"werewolf-confirm-skip:\";",
    '''const CONFIRM_SKIP_PREFIX = "werewolf-confirm-skip:";

async function confirmAction(kind, message) {
  const skipKey = `${CONFIRM_SKIP_PREFIX}${kind}`;
  if (localStorage.getItem(skipKey) === "1") return true;

  const dialog = $("#confirmDialog");
  const checkbox = $("#confirmDialogDontShow");
  if (!dialog || typeof dialog.showModal !== "function" || !checkbox) {
    showToast("此瀏覽器無法開啟站內確認視窗，操作已取消。", true);
    return false;
  }

  $("#confirmDialogTitle").textContent = knownText("確認操作");
  $("#confirmDialogMessage").textContent = message;
  $("#confirmDialogDontShowText").textContent = knownText("不再顯示此確認");
  $("#confirmDialogCancel").textContent = knownText("取消");
  $("#confirmDialogConfirm").textContent = knownText("確定");
  checkbox.checked = false;
  dialog.returnValue = "";

  return new Promise((resolve) => {
    const onClose = () => {
      dialog.removeEventListener("close", onClose);
      const approved = dialog.returnValue === "confirm";
      if (approved && checkbox.checked) localStorage.setItem(skipKey, "1");
      resolve(approved);
    };
    dialog.addEventListener("close", onClose);
    dialog.showModal();
  });
}''',
)

replace_once(
    "public/i18n.js",
    '  "啟用警長選舉": { "zh-TW": "啟用警長選舉", "zh-CN": "启用警长选举", en: "Enable sheriff election" },\n',
    '''  "啟用警長選舉": { "zh-TW": "啟用警長選舉", "zh-CN": "启用警长选举", en: "Enable sheriff election" },
  "警長的放逐票計為 2 票。": { "zh-TW": "警長的放逐票計為 2 票。", "zh-CN": "警长的放逐票计为 2 票。", en: "The sheriff's exile vote counts as 2 votes." },
  "確認操作": { "zh-TW": "確認操作", "zh-CN": "确认操作", en: "Confirm action" },
  "不再顯示此確認": { "zh-TW": "不再顯示此確認", "zh-CN": "不再显示此确认", en: "Don't show this confirmation again" },
  "確定": { "zh-TW": "確定", "zh-CN": "确定", en: "Confirm" },
  "取消": { "zh-TW": "取消", "zh-CN": "取消", en: "Cancel" },
  "此瀏覽器無法開啟站內確認視窗，操作已取消。": { "zh-TW": "此瀏覽器無法開啟站內確認視窗，操作已取消。", "zh-CN": "此浏览器无法打开站内确认窗口，操作已取消。", en: "This browser cannot open the in-site confirmation dialog; the action was cancelled." },
''',
)

append_once(
    "public/styles.css",
    ".confirm-dialog {",
    '''.confirm-dialog {
  width: min(440px, calc(100% - 32px));
  max-width: 440px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-xl);
  color: var(--ink);
  background: transparent;
  box-shadow: 0 28px 90px rgba(35, 27, 22, .28);
}
.confirm-dialog::backdrop { background: rgba(31, 26, 23, .54); backdrop-filter: blur(3px); }
.confirm-dialog-card { padding: 24px; border: 1px solid var(--line); border-radius: var(--radius-xl); background: var(--paper); }
.confirm-dialog-heading { display: grid; gap: 7px; margin-bottom: 12px; }
.confirm-dialog-heading h2 { margin: 0; font-size: 21px; }
.confirm-dialog-message { margin: 0 0 18px; color: var(--muted); font-size: 13px; line-height: 1.7; white-space: pre-wrap; }
.confirm-skip-row { margin: 0 0 18px; grid-template-columns: auto minmax(0, 1fr); align-items: center; }
.confirm-skip-row input { width: auto; margin: 0; }
.confirm-dialog-actions { display: flex; justify-content: flex-end; gap: 10px; }
.confirm-dialog-actions .button { min-width: 96px; }
@media (max-width: 520px) {
  .confirm-dialog-card { padding: 20px; }
  .confirm-dialog-actions { display: grid; grid-template-columns: 1fr 1fr; }
  .confirm-dialog-actions .button { width: 100%; min-width: 0; }
}''',
)

replace_once(
    "test/game-engine.test.mjs",
    '''test("weighted voting supports zero-weight and PK top target detection", () => {
  const state = baseState([p("m", "masochist_cultist"), p("v", "villager"), p("w", "werewolf")], { m: "w", v: "w", w: "v" });
  assert.deepEqual(weightedVoteCounts(state), { w: 1, v: 1 });
  assert.deepEqual(new Set(topWeightedVoteTargets(state)), new Set(["v", "w"]));
});
''',
    '''test("weighted voting supports zero-weight and PK top target detection", () => {
  const state = baseState([p("m", "masochist_cultist"), p("v", "villager"), p("w", "werewolf")], { m: "w", v: "w", w: "v" });
  assert.deepEqual(weightedVoteCounts(state), { w: 1, v: 1 });
  assert.deepEqual(new Set(topWeightedVoteTargets(state)), new Set(["v", "w"]));
});

test("sheriff exile vote counts as two and stacks with role vote bonuses", () => {
  const state = baseState([p("s", "villager"), p("v", "villager"), p("w", "werewolf")], { s: "w", v: "w", w: "v" });
  state.sheriff.enabled = true;
  state.sheriff.sheriffId = "s";
  assert.deepEqual(weightedVoteCounts(state), { w: 3, v: 1 });
  state.roleMemory.s = { voteBonus: 2 };
  assert.deepEqual(weightedVoteCounts(state), { w: 5, v: 1 });
});
''',
)

replace_once(
    "test/i18n-static.test.mjs",
    '  assert.equal(knownText("平票隨機淘汰 1 人", "en"), "Randomly eliminate 1 tied player");\n',
    '''  assert.equal(knownText("平票隨機淘汰 1 人", "en"), "Randomly eliminate 1 tied player");
  assert.equal(knownText("警長的放逐票計為 2 票。", "en"), "The sheriff's exile vote counts as 2 votes.");
  assert.equal(knownText("不再顯示此確認", "zh-CN"), "不再显示此确认");
  assert.equal(knownText("確認操作", "en"), "Confirm action");
''',
)
replace_once(
    "test/i18n-static.test.mjs",
    '  assert.match(html, /value="random_elimination"/);\n',
    '''  assert.match(html, /value="random_elimination"/);
  assert.match(html, /警長的放逐票計為 2 票。/);
  assert.match(html, /id="confirmDialog"/);
  assert.match(html, /id="confirmDialogDontShow"/);
''',
)
replace_once(
    "test/i18n-static.test.mjs",
    '  assert.match(app, /\\/translate`/);\n',
    '''  assert.match(app, /\\/translate`/);
  assert.match(app, /confirmAction\("kick", prompt\)/);
  assert.match(app, /dialog\.showModal\(\)/);
  assert.match(app, /werewolf-confirm-skip:/);
  assert.doesNotMatch(app, /\bconfirm\s*\(/);
''',
)

print("sheriff/modal patch applied")
