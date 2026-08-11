const LABELS = {
  "zh-TW": {
    openRoles: "設定角色",
    close: "關閉",
    title: "角色配置",
    sourceNote: "角色標籤：原作＝作者正文／作者更新；討論角色＝社群提案；辯論改寫＝本專案為網頁辯論流程做的調整。已明確設定的房規會維持專案覆寫，不和舊版規則混用。",
    compactHint: "角色清單已移到彈出視窗，主畫面只保留配置摘要。",
    lover: "情侶",
    addon: "附加身份",
    generated: "邱比特配對",
    loverSummary: "由邱比特配對產生；不佔本體角色槽，保留原本角色與陣營。伴侶死亡時會觸發殉情，並套用情侶的特殊勝利規則。"
  },
  "zh-CN": {
    openRoles: "设置角色",
    close: "关闭",
    title: "角色配置",
    sourceNote: "角色标签：原作＝作者正文／作者更新；讨论角色＝社区提案；辩论改写＝本项目为网页辩论流程做的调整。已明确设置的房规会维持项目覆盖，不与旧版规则混用。",
    compactHint: "角色列表已移到弹出窗口，主画面只保留配置摘要。",
    lover: "情侣",
    addon: "附加身份",
    generated: "丘比特配对",
    loverSummary: "由丘比特配对产生；不占本体角色槽，保留原本角色与阵营。伴侣死亡时会触发殉情，并套用情侣的特殊胜利规则。"
  },
  en: {
    openRoles: "Configure roles",
    close: "Close",
    title: "Role setup",
    sourceNote: "Role labels: Original = author post/updates; Community role = community proposal; Debate adaptation = adjustments made for this web debate version. Explicit house-rule overrides remain project rules instead of silently reverting to older source behavior.",
    compactHint: "The role catalog now opens in a dialog so the main page only keeps a compact setup summary.",
    lover: "Lover",
    addon: "Addon identity",
    generated: "Linked by Cupid",
    loverSummary: "Created by Cupid's link. It does not consume a base-role slot and keeps the player's base role and faction. A partner's death can trigger lover suicide, and lover special-win rules also apply."
  }
};

function locale() {
  const value = localStorage.getItem("werewolf-locale");
  return value === "zh-CN" || value === "en" ? value : "zh-TW";
}

function text(key) {
  return LABELS[locale()]?.[key] || LABELS["zh-TW"][key] || key;
}

function installRoleDialog() {
  const details = document.querySelector("#roleSetupDetails") || [...document.querySelectorAll("#hostPanel details")].find((node) => node.querySelector("#roleSetupForm"));
  if (!details || details.dataset.compactRoleReady === "1") return;
  const summary = details.querySelector(":scope > summary");
  if (!summary) return;

  details.dataset.compactRoleReady = "1";
  details.classList.add("role-config-compact");
  details.open = true;
  summary.addEventListener("click", (event) => event.preventDefault());

  const dialog = document.createElement("dialog");
  dialog.id = "roleSetupDialog";
  dialog.className = "role-setup-dialog";
  dialog.setAttribute("aria-labelledby", "roleSetupDialogTitle");

  const card = document.createElement("div");
  card.className = "role-setup-dialog-card";
  const head = document.createElement("div");
  head.className = "role-setup-dialog-head";
  head.innerHTML = `<div><span class="eyebrow" data-role-modal-eyebrow></span><h2 id="roleSetupDialogTitle"></h2></div><button class="icon-button role-dialog-close" type="button" data-role-dialog-close></button>`;

  const sourceNote = document.createElement("p");
  sourceNote.className = "role-source-note";
  sourceNote.dataset.roleSourceNote = "1";

  const body = document.createElement("div");
  body.className = "role-setup-dialog-body";
  for (const child of [...details.children]) {
    if (child !== summary) body.append(child);
  }

  card.append(head, sourceNote, body);
  dialog.append(card);
  document.body.append(dialog);

  const launch = document.createElement("div");
  launch.className = "role-config-launch";
  launch.innerHTML = `<p data-role-compact-hint></p><button class="button button-secondary" type="button" data-open-role-dialog></button>`;
  details.append(launch);

  const openButton = launch.querySelector("[data-open-role-dialog]");
  const closeButton = dialog.querySelector("[data-role-dialog-close]");
  openButton?.addEventListener("click", () => {
    ensureLoverAddonCard();
    if (!dialog.open) dialog.showModal();
  });
  closeButton?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.querySelector("#roleSetupForm")?.addEventListener("submit", () => setTimeout(() => dialog.open && dialog.close(), 0));

  const catalog = document.querySelector("#roleCatalog");
  if (catalog) {
    const observer = new MutationObserver(() => ensureLoverAddonCard());
    observer.observe(catalog, { childList: true, subtree: true });
  }

  updateCopy();
  ensureLoverAddonCard();
}

function ensureLoverAddonCard() {
  const group = document.querySelector("#roleCatalog [data-addon-role-group]");
  if (!group || group.querySelector("[data-lover-addon-card]")) return;
  const card = document.createElement("article");
  card.className = "role-card addon-info-card";
  card.dataset.loverAddonCard = "1";
  card.dataset.noTranslate = "";
  card.innerHTML = `<div class="role-copy"><div class="role-title"><strong data-lover-name></strong><span data-lover-addon-label></span></div><p data-lover-summary></p></div><span class="addon-generated-badge" data-lover-generated></span>`;
  const head = group.querySelector(":scope > .role-group-head");
  if (head?.nextSibling) group.insertBefore(card, head.nextSibling);
  else group.append(card);
  updateCopy();
}

function updateCopy() {
  const dialog = document.querySelector("#roleSetupDialog");
  if (dialog) {
    const title = dialog.querySelector("#roleSetupDialogTitle");
    const eyebrow = dialog.querySelector("[data-role-modal-eyebrow]");
    const close = dialog.querySelector("[data-role-dialog-close]");
    const sourceNote = dialog.querySelector("[data-role-source-note]");
    if (title) title.textContent = text("title");
    if (eyebrow) eyebrow.textContent = text("addon");
    if (close) {
      close.textContent = "×";
      close.title = text("close");
      close.setAttribute("aria-label", text("close"));
    }
    if (sourceNote) sourceNote.textContent = text("sourceNote");
  }
  const hint = document.querySelector("[data-role-compact-hint]");
  const open = document.querySelector("[data-open-role-dialog]");
  if (hint) hint.textContent = text("compactHint");
  if (open) open.textContent = text("openRoles");

  const lover = document.querySelector("[data-lover-addon-card]");
  if (lover) {
    lover.querySelector("[data-lover-name]").textContent = text("lover");
    lover.querySelector("[data-lover-addon-label]").textContent = text("addon");
    lover.querySelector("[data-lover-summary]").textContent = text("loverSummary");
    lover.querySelector("[data-lover-generated]").textContent = text("generated");
  }
}

function init() {
  installRoleDialog();
  document.querySelector("#languageSelect")?.addEventListener("change", () => setTimeout(updateCopy, 0));
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();