(() => {
  const COLLAPSE_PREFIX = "werewolf-panel-collapsed:";
  const ROLE_GROUP_PREFIX = "werewolf-role-group-collapsed:";
  const ROLE_DIALOG_ID = "roleSetupDialog";
  const ROLE_LAUNCHER_ID = "roleSetupLauncher";
  const nativeFetch = window.fetch.bind(window);
  const staticI18n = () => window.WerewolfGameI18n;
  const staticSources = new WeakMap();
  let timer = 0;
  let gameObserver = null;
  let dialogObserver = null;

  const LABELS = {
    "zh-TW": {
      collapse: "縮起",
      expand: "展開",
      configureRoles: "角色配置",
      close: "關閉",
      addonIdentities: "附加身份",
      lover: "情侶",
      masochist: "抖M",
      sadist: "抖S",
      loverSummary: "由邱比特配對產生；保留本體角色與陣營，不佔本體角色配置數量。",
      lobby: "大廳",
      reaction: "反應",
      gameOver: "遊戲結束",
      vote: "投票",
      waitingRoleSetup: "等待房主完成角色配置。"
    },
    "zh-CN": {
      collapse: "收起",
      expand: "展开",
      configureRoles: "角色配置",
      close: "关闭",
      addonIdentities: "附加身份",
      lover: "情侣",
      masochist: "抖M",
      sadist: "抖S",
      loverSummary: "由丘比特配对产生；保留本体角色与阵营，不占本体角色配置数量。",
      lobby: "大厅",
      reaction: "反应",
      gameOver: "游戏结束",
      vote: "投票",
      waitingRoleSetup: "等待房主完成角色配置。"
    },
    en: {
      collapse: "Collapse",
      expand: "Expand",
      configureRoles: "Role setup",
      close: "Close",
      addonIdentities: "Addon identities",
      lover: "Lover",
      masochist: "M",
      sadist: "S",
      loverSummary: "Created by Cupid pairing; keeps the base role and faction and does not consume a base-role slot.",
      lobby: "LOBBY",
      reaction: "REACTION",
      gameOver: "GAME OVER",
      vote: "VOTE",
      waitingRoleSetup: "Waiting for the host to finish role setup."
    }
  };

  function locale() {
    const value = localStorage.getItem("werewolf-locale");
    return value === "zh-CN" || value === "en" ? value : "zh-TW";
  }

  function label(key) {
    return LABELS[locale()]?.[key] || LABELS["zh-TW"][key] || key;
  }

  function translationPath(url) {
    return /^\/api\/rooms\/[A-Z2-9]{6}\/translate$/.test(url.pathname);
  }

  function parseJsonBody(init) {
    if (!init || typeof init.body !== "string") return null;
    try {
      const value = JSON.parse(init.body);
      return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  }

  function localTranslationResponse(body) {
    const targetLocale = body.targetLocale;
    const texts = Array.isArray(body.texts) ? body.texts : [];
    const fixed = staticI18n();
    const translations = texts.map((value) => {
      const source = String(value ?? "");
      if (!fixed || !body.sourceLocale || body.sourceLocale === targetLocale) return source;
      return fixed.text(source, targetLocale) || source;
    });
    return new Response(JSON.stringify({ translations, targetLocale }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }

  // Fixed game text always carries sourceLocale and stays local. Player-authored
  // chat/speech uses source auto-detection and therefore continues through the
  // native fetch path to the Worker translation endpoint.
  window.fetch = function guardedFetch(input, init) {
    try {
      const raw = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
      const url = new URL(raw, location.href);
      if (translationPath(url)) {
        const body = parseJsonBody(init);
        if (body?.sourceLocale) return Promise.resolve(localTranslationResponse(body));
      }
    } catch {}
    return nativeFetch(input, init);
  };

  function translateRoleCatalog() {
    const targetLocale = locale();
    const fixed = staticI18n();
    if (!fixed) return;
    for (const card of document.querySelectorAll("#roleCatalog [data-role-card]")) {
      const roleId = card.dataset.roleCard;
      const name = card.querySelector(".role-title strong");
      const summary = card.querySelector(".role-copy p");
      const adaptation = card.querySelector(".adaptation");
      if (name) {
        if (!name.dataset.fixedZhTw) name.dataset.fixedZhTw = name.textContent?.trim() || "";
        const translated = fixed.role(roleId, "name", targetLocale, name.dataset.fixedZhTw);
        if (name.textContent !== translated) name.textContent = translated;
      }
      if (summary) {
        if (!summary.dataset.fixedZhTw) summary.dataset.fixedZhTw = summary.textContent?.trim() || "";
        const translated = fixed.role(roleId, "summary", targetLocale, summary.dataset.fixedZhTw);
        if (summary.textContent !== translated) summary.textContent = translated;
      }
      if (adaptation) {
        if (!adaptation.dataset.fixedZhTw) adaptation.dataset.fixedZhTw = adaptation.textContent?.trim() || "";
        const translated = fixed.text(adaptation.dataset.fixedZhTw, targetLocale);
        if (adaptation.textContent !== translated) adaptation.textContent = translated;
      }
    }
  }

  function translateRuntimeFixedText(source, targetLocale) {
    const dictionary = LABELS[targetLocale] || LABELS["zh-TW"];
    if (source === "LOBBY") return dictionary.lobby;
    if (source === "REACTION") return dictionary.reaction;
    if (source === "GAME OVER") return dictionary.gameOver;
    if (source === "VOTE") return dictionary.vote;
    if (source === "等待房主完成角色配置。") return dictionary.waitingRoleSetup;
    const lobbySummary = source.match(/^正式玩家 (\d+) 人；角色總數必須相同，且狼人陣營少於其他玩家總數。AI 不是必需品。$/);
    if (lobbySummary) {
      const count = lobbySummary[1];
      if (targetLocale === "en") return `${count} active player${count === "1" ? "" : "s"}. Base-role total must match the active-player count, and werewolves must be fewer than all other players combined. AI is optional.`;
      if (targetLocale === "zh-CN") return `正式玩家 ${count} 人；本体角色总数必须与正式玩家数相同，且狼人阵营少于其他玩家总数。AI 不是必需。`;
      return `正式玩家 ${count} 人；本體角色總數必須與正式玩家數相同，且狼人陣營少於其他玩家總數。AI 不是必需品。`;
    }
    const round = source.match(/^第 (\d+) 輪$/);
    if (round && targetLocale === "en") return `Round ${round[1]}`;
    const formal = source.match(/^(\d+) 名正式玩家$/);
    if (formal) {
      if (targetLocale === "en") return `${formal[1]} active player${formal[1] === "1" ? "" : "s"}`;
      if (targetLocale === "zh-CN") return `${formal[1]} 名正式玩家`;
    }
    return null;
  }

  function translateFixedGameDom() {
    const targetLocale = locale();
    const fixed = staticI18n();
    if (!fixed) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest("script, style, #messages, [data-no-translate], #roleCatalog")) continue;
      const current = (node.nodeValue || "").trim();
      if (!current) continue;
      let source = staticSources.get(node);
      if (!source) {
        const runtime = translateRuntimeFixedText(current, targetLocale);
        if (!runtime && !fixed.canTranslate(current)) continue;
        source = current;
        staticSources.set(node, source);
      }
      const translated = translateRuntimeFixedText(source, targetLocale) || fixed.text(source, targetLocale);
      const original = node.nodeValue || "";
      const trimmed = original.trim();
      const start = original.indexOf(trimmed);
      const next = `${original.slice(0, start)}${translated}${original.slice(start + trimmed.length)}`;
      if (next !== original) node.nodeValue = next;
    }
  }

  function translateFixedMessages() {
    const targetLocale = locale();
    const fixed = staticI18n();
    if (!fixed) return;
    for (const row of document.querySelectorAll("#messages .message-system, #messages .message-role")) {
      const body = row.querySelector(".message-content");
      if (!body) continue;
      if (!body.dataset.fixedZhTw) body.dataset.fixedZhTw = body.textContent?.trim() || "";
      const source = body.dataset.fixedZhTw;
      const translated = fixed.text(source, targetLocale) || source;
      if (body.textContent !== translated) body.textContent = translated;
      if (body.title !== translated) body.title = translated;
      row.querySelector(".translation-warning")?.remove();
      if (row.classList.contains("message-system")) {
        const name = row.querySelector(".message-head strong");
        const systemName = targetLocale === "zh-TW" ? "系統" : fixed.text("系統", targetLocale) || "系統";
        if (name && name.textContent !== systemName) name.textContent = systemName;
      }
    }
    const playerWarning = document.querySelector("#messages .message-chat .translation-warning, #messages .message-speech .translation-warning");
    const status = document.querySelector("#translationStatus");
    if (status && !playerWarning) {
      if (status.textContent) status.textContent = "";
      status.classList.add("hidden");
    }
  }

  function syncCollapseButton(button, collapsed) {
    const symbol = collapsed ? "+" : "−";
    const title = collapsed ? label("expand") : label("collapse");
    const expanded = collapsed ? "false" : "true";
    if (button.textContent !== symbol) button.textContent = symbol;
    if (button.title !== title) button.title = title;
    if (button.getAttribute("aria-label") !== title) button.setAttribute("aria-label", title);
    if (button.getAttribute("aria-expanded") !== expanded) button.setAttribute("aria-expanded", expanded);
  }

  function installPanelCollapse() {
    const panels = [
      ["action", document.querySelector(".action-card")],
      ["chat", document.querySelector(".chat-card")],
      ["players", document.querySelector(".players-card")],
      ["host", document.querySelector("#hostPanel")]
    ];
    for (const [key, panel] of panels) {
      if (!panel) continue;
      const heading = panel.querySelector(":scope > .section-heading");
      if (!heading) continue;
      let button = heading.querySelector("[data-panel-collapse]");
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "panel-collapse-button";
        button.dataset.panelCollapse = key;
        const collapsed = localStorage.getItem(`${COLLAPSE_PREFIX}${key}`) === "1";
        panel.classList.toggle("panel-collapsed", collapsed);
        button.addEventListener("click", () => {
          const next = !panel.classList.contains("panel-collapsed");
          panel.classList.toggle("panel-collapsed", next);
          localStorage.setItem(`${COLLAPSE_PREFIX}${key}`, next ? "1" : "0");
          syncCollapseButton(button, next);
        });
        heading.append(button);
      }
      syncCollapseButton(button, panel.classList.contains("panel-collapsed"));
    }
  }

  function installRoleGroupCollapse() {
    for (const group of document.querySelectorAll("#roleCatalog .role-group")) {
      const faction = group.dataset.roleGroup || group.dataset.addonRoleGroup || "unknown";
      const head = group.querySelector(":scope > .role-group-head");
      if (!head || head.dataset.uiCollapseReady === "1") continue;
      head.dataset.uiCollapseReady = "1";
      head.tabIndex = 0;
      head.setAttribute("role", "button");
      const collapsed = localStorage.getItem(`${ROLE_GROUP_PREFIX}${faction}`) === "1";
      group.classList.toggle("role-group-collapsed", collapsed);
      head.setAttribute("aria-expanded", collapsed ? "false" : "true");
      const toggle = () => {
        const next = !group.classList.contains("role-group-collapsed");
        group.classList.toggle("role-group-collapsed", next);
        localStorage.setItem(`${ROLE_GROUP_PREFIX}${faction}`, next ? "1" : "0");
        head.setAttribute("aria-expanded", next ? "false" : "true");
      };
      head.addEventListener("click", toggle);
      head.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle();
        }
      });
    }
  }

  function syncRoleLauncher() {
    const launcher = document.querySelector(`#${ROLE_LAUNCHER_ID}`);
    const count = document.querySelector("#roleSetupTotal");
    const mirror = launcher?.querySelector("[data-role-launcher-count]");
    const title = launcher?.querySelector("[data-role-launcher-title]");
    const dialogTitle = document.querySelector(`#${ROLE_DIALOG_ID} [data-role-dialog-title]`);
    if (title) title.textContent = label("configureRoles");
    if (dialogTitle) dialogTitle.textContent = label("configureRoles");
    if (mirror) mirror.textContent = count?.textContent || "0 / 0";
    const close = document.querySelector(`#${ROLE_DIALOG_ID} [data-role-dialog-close]`);
    if (close) {
      close.textContent = "×";
      close.title = label("close");
      close.setAttribute("aria-label", label("close"));
    }
    const host = document.querySelector("#hostPanel");
    const dialog = document.querySelector(`#${ROLE_DIALOG_ID}`);
    if (host?.classList.contains("hidden") && dialog?.open) dialog.close();
  }

  function syncAddonIdentityStrip() {
    const strip = document.querySelector("[data-addon-identity-strip]");
    if (!strip) return;
    const title = strip.querySelector("[data-addon-strip-title]");
    const lover = strip.querySelector("[data-addon-lover]");
    const m = strip.querySelector("[data-addon-m]");
    const s = strip.querySelector("[data-addon-s]");
    const summary = strip.querySelector("[data-addon-lover-summary]");
    if (title) title.textContent = label("addonIdentities");
    if (lover) lover.textContent = label("lover");
    if (m) m.textContent = label("masochist");
    if (s) s.textContent = label("sadist");
    if (summary) summary.textContent = label("loverSummary");
  }

  function installRoleSetupModal() {
    const form = document.querySelector("#roleSetupForm");
    const details = form?.closest("details");
    if (!form || !details) return;
    let dialog = document.querySelector(`#${ROLE_DIALOG_ID}`);
    let launcher = document.querySelector(`#${ROLE_LAUNCHER_ID}`);
    if (!dialog) {
      launcher = document.createElement("button");
      launcher.id = ROLE_LAUNCHER_ID;
      launcher.type = "button";
      launcher.className = "role-modal-launcher";
      launcher.innerHTML = '<span data-role-launcher-title></span><strong data-role-launcher-count>0 / 0</strong><span aria-hidden="true">›</span>';
      details.before(launcher);

      dialog = document.createElement("dialog");
      dialog.id = ROLE_DIALOG_ID;
      dialog.className = "role-setup-dialog";
      dialog.innerHTML = '<section class="role-setup-dialog-card"><header class="role-setup-dialog-head"><div><span class="eyebrow">ROLE SETUP</span><h2 data-role-dialog-title></h2></div><button class="role-dialog-close" data-role-dialog-close type="button">×</button></header><div class="addon-identity-strip" data-addon-identity-strip data-no-translate><div class="addon-identity-strip-head"><strong data-addon-strip-title></strong><span class="pill addon" data-addon-lover></span><span class="pill addon" data-addon-m></span><span class="pill addon" data-addon-s></span></div><p data-addon-lover-summary></p></div><div class="role-setup-dialog-body" data-role-dialog-body></div></section>';
      document.body.append(dialog);
      const body = dialog.querySelector("[data-role-dialog-body]");
      const summary = details.querySelector(":scope > summary");
      let node = summary?.nextSibling || details.firstChild;
      while (node) {
        const next = node.nextSibling;
        body.append(node);
        node = next;
      }
      details.classList.add("role-setup-source-hidden");
      launcher.addEventListener("click", () => {
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
        document.querySelector("#roleSearch")?.focus();
      });
      dialog.querySelector("[data-role-dialog-close]")?.addEventListener("click", () => dialog.close());
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
      });
      dialog.addEventListener("cancel", () => dialog.close());
    }
    syncRoleLauncher();
    syncAddonIdentityStrip();
  }

  function applyUiFixes() {
    installPanelCollapse();
    installRoleSetupModal();
    installRoleGroupCollapse();
    translateRoleCatalog();
    translateFixedGameDom();
    translateFixedMessages();
    syncRoleLauncher();
    syncAddonIdentityStrip();
  }

  function observeRuntime() {
    const game = document.querySelector("#game");
    const dialog = document.querySelector("#confirmDialog");
    if (game && gameObserver) gameObserver.observe(game, { childList: true, subtree: true });
    if (dialog && dialogObserver) dialogObserver.observe(dialog, { childList: true, subtree: true });
  }

  function applyWithoutObserverFeedback() {
    gameObserver?.disconnect();
    dialogObserver?.disconnect();
    try {
      applyUiFixes();
    } finally {
      observeRuntime();
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(applyWithoutObserverFeedback, 0);
  }

  function init() {
    gameObserver = new MutationObserver(schedule);
    dialogObserver = new MutationObserver(schedule);
    applyWithoutObserverFeedback();
    document.querySelector("#languageSelect")?.addEventListener("change", schedule);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();