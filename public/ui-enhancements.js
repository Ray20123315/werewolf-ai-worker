(() => {
  const TRANSLATION_STATUS_ID = "translationServiceStatus";
  const SKIP_KICK_KEY = "werewolf-skip-kick-confirm";
  const COLLAPSE_PREFIX = "werewolf-panel-collapsed:";
  const ROLE_GROUP_PREFIX = "werewolf-role-group-collapsed:";

  const LABELS = {
    "zh-TW": {
      system: "系統",
      translating: "翻譯中…",
      translationError: "翻譯服務無法使用；請確認 Worker Secret GOOGLE_TRANSLATE_API_KEYS。",
      collapse: "縮起",
      expand: "展開",
      kickTitle: "踢出玩家？",
      kickBody: "被踢者不是永久封鎖，可重新建立人物加入。",
      dontShowAgain: "不再顯示這個確認視窗",
      confirm: "確定",
      cancel: "取消"
    },
    "zh-CN": {
      system: "系统",
      translating: "翻译中…",
      translationError: "翻译服务无法使用；请确认 Worker Secret GOOGLE_TRANSLATE_API_KEYS。",
      collapse: "收起",
      expand: "展开",
      kickTitle: "踢出玩家？",
      kickBody: "被踢者不是永久封禁，可重新创建人物加入。",
      dontShowAgain: "不再显示这个确认窗口",
      confirm: "确定",
      cancel: "取消"
    },
    en: {
      system: "System",
      translating: "Translating…",
      translationError: "Translation is unavailable. Check the GOOGLE_TRANSLATE_API_KEYS Worker Secret.",
      collapse: "Collapse",
      expand: "Expand",
      kickTitle: "Remove player?",
      kickBody: "This is not a permanent ban. The player can create a new identity and rejoin.",
      dontShowAgain: "Do not show this confirmation again",
      confirm: "Confirm",
      cancel: "Cancel"
    }
  };

  const translationCache = new Map();
  let latestState = null;
  let websocketToken = "";
  let enhanceTimer = 0;
  let kickDialog = null;
  let kickTargetButton = null;
  let bypassKickButton = null;
  let allowConfirmOnce = false;

  function locale() {
    const value = localStorage.getItem("werewolf-locale");
    return value === "zh-CN" || value === "en" ? value : "zh-TW";
  }

  function text(key) {
    return LABELS[locale()]?.[key] || LABELS["zh-TW"][key] || key;
  }

  function roomId() {
    return location.pathname.toUpperCase().match(/^\/([A-Z2-9]{6})\/?$/)?.[1] || "";
  }

  function sessionToken() {
    if (websocketToken) return websocketToken;
    const id = roomId();
    if (!id) return "";
    try {
      return JSON.parse(localStorage.getItem(`werewolf-session:${id}`) || "null")?.token || "";
    } catch {
      return "";
    }
  }

  function installWebSocketObserver() {
    const NativeWebSocket = window.WebSocket;
    class EnhancementWebSocket extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        try {
          const url = new URL(String(args[0]), location.href);
          websocketToken = url.searchParams.get("token") || websocketToken;
        } catch {}
        super.addEventListener("message", (event) => {
          try {
            const payload = JSON.parse(event.data);
            if (payload.type === "state" && payload.state) {
              latestState = payload.state;
              scheduleEnhance();
            }
          } catch {}
        });
      }
    }
    Object.defineProperties(EnhancementWebSocket, {
      CONNECTING: { value: NativeWebSocket.CONNECTING },
      OPEN: { value: NativeWebSocket.OPEN },
      CLOSING: { value: NativeWebSocket.CLOSING },
      CLOSED: { value: NativeWebSocket.CLOSED }
    });
    window.WebSocket = EnhancementWebSocket;
  }

  async function remoteTranslate(texts, sourceLocale, targetLocale) {
    if (!texts.length || sourceLocale === targetLocale) return [...texts];
    const id = roomId();
    const token = sessionToken();
    if (!id || !token) throw new Error("Missing room session");
    const output = [];
    for (let index = 0; index < texts.length; index += 40) {
      const chunk = texts.slice(index, index + 40);
      const response = await fetch(`/api/rooms/${id}/translate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, sourceLocale, targetLocale, texts: chunk })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      if (!Array.isArray(data.translations) || data.translations.length !== chunk.length) throw new Error("Invalid translation response");
      output.push(...data.translations);
    }
    return output;
  }

  async function translateTexts(texts, sourceLocale, targetLocale) {
    const unique = [...new Set(texts.map((value) => String(value || "").trim()).filter(Boolean))];
    const missing = unique.filter((value) => !translationCache.has(`${sourceLocale}\u0000${targetLocale}\u0000${value}`));
    if (missing.length) {
      const translated = await remoteTranslate(missing, sourceLocale, targetLocale);
      missing.forEach((value, index) => {
        const result = typeof translated[index] === "string" && translated[index].trim() ? translated[index].trim() : value;
        translationCache.set(`${sourceLocale}\u0000${targetLocale}\u0000${value}`, result);
      });
    }
    return unique.reduce((map, value) => {
      map.set(value, sourceLocale === targetLocale ? value : translationCache.get(`${sourceLocale}\u0000${targetLocale}\u0000${value}`) || value);
      return map;
    }, new Map());
  }

  function ensureTranslationStatus() {
    let node = document.getElementById(TRANSLATION_STATUS_ID);
    if (node) return node;
    const actions = document.querySelector(".brand-actions");
    if (!actions) return null;
    node = document.createElement("span");
    node.id = TRANSLATION_STATUS_ID;
    node.className = "translation-service-status hidden";
    node.setAttribute("role", "status");
    actions.prepend(node);
    return node;
  }

  function showTranslationError() {
    const node = ensureTranslationStatus();
    if (!node) return;
    node.textContent = text("translationError");
    node.classList.remove("hidden");
  }

  function clearTranslationError() {
    ensureTranslationStatus()?.classList.add("hidden");
  }

  async function translateRoleCatalog() {
    const targetLocale = locale();
    const cards = [...document.querySelectorAll("#roleCatalog .role-card")];
    if (!cards.length) return;
    const nodes = cards.flatMap((card) => [
      card.querySelector(".role-title strong"),
      card.querySelector(".role-copy p"),
      card.querySelector(".adaptation")
    ].filter(Boolean));

    const sources = [];
    for (const node of nodes) {
      if (!node.dataset.translationSource) node.dataset.translationSource = node.textContent?.trim() || "";
      if (node.dataset.translationSource) sources.push(node.dataset.translationSource);
    }
    if (!sources.length) return;

    if (targetLocale === "zh-TW") {
      for (const node of nodes) node.textContent = node.dataset.translationSource || node.textContent;
      return;
    }

    const map = await translateTexts(sources, "zh-TW", targetLocale);
    for (const node of nodes) {
      const source = node.dataset.translationSource || "";
      if (source) node.textContent = map.get(source) || source;
    }
  }

  async function translateMessages() {
    if (!latestState?.messages?.length) return;
    const rows = [...document.querySelectorAll("#messages .message")];
    if (!rows.length) return;
    const targetLocale = locale();
    const groups = new Map();

    latestState.messages.forEach((message, index) => {
      const row = rows[index];
      if (!row) return;
      const sourceLocale = message.sourceLocale || "zh-TW";
      const source = String(message.content || "");
      const key = sourceLocale;
      const group = groups.get(key) || [];
      group.push({ row, source, message });
      groups.set(key, group);
      const name = row.querySelector(".message-head strong");
      if (name && message.kind === "system") name.textContent = text("system");
    });

    for (const [sourceLocale, items] of groups) {
      const sources = items.map((item) => item.source);
      if (sourceLocale === targetLocale) {
        items.forEach((item) => {
          const body = item.row.querySelector(".message-content");
          if (body) { body.textContent = item.source; body.title = item.source; }
        });
        continue;
      }
      const map = await translateTexts(sources, sourceLocale, targetLocale);
      items.forEach((item) => {
        const body = item.row.querySelector(".message-content");
        const shown = map.get(item.source) || item.source;
        if (body) { body.textContent = shown; body.title = shown; }
      });
    }
  }

  async function enhanceTranslations() {
    if (!roomId()) return;
    try {
      await Promise.all([translateRoleCatalog(), translateMessages()]);
      clearTranslationError();
    } catch {
      showTranslationError();
    }
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
      if (!heading || heading.querySelector("[data-panel-collapse]")) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "panel-collapse-button";
      button.dataset.panelCollapse = key;
      const stored = localStorage.getItem(`${COLLAPSE_PREFIX}${key}`) === "1";
      panel.classList.toggle("panel-collapsed", stored);
      syncPanelCollapseButton(button, stored);
      button.addEventListener("click", () => {
        const collapsed = !panel.classList.contains("panel-collapsed");
        panel.classList.toggle("panel-collapsed", collapsed);
        localStorage.setItem(`${COLLAPSE_PREFIX}${key}`, collapsed ? "1" : "0");
        syncPanelCollapseButton(button, collapsed);
      });
      heading.append(button);
    }
  }

  function syncPanelCollapseButton(button, collapsed) {
    button.textContent = collapsed ? "+" : "−";
    button.title = collapsed ? text("expand") : text("collapse");
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }

  function installRoleGroupCollapse() {
    for (const group of document.querySelectorAll("#roleCatalog .role-group")) {
      const faction = group.dataset.roleGroup || "unknown";
      const head = group.querySelector(".role-group-head");
      if (!head || head.dataset.collapseReady === "1") continue;
      head.dataset.collapseReady = "1";
      head.setAttribute("role", "button");
      head.tabIndex = 0;
      const stored = localStorage.getItem(`${ROLE_GROUP_PREFIX}${faction}`) === "1";
      group.classList.toggle("role-group-collapsed", stored);
      head.setAttribute("aria-expanded", stored ? "false" : "true");
      const toggle = () => {
        const collapsed = !group.classList.contains("role-group-collapsed");
        group.classList.toggle("role-group-collapsed", collapsed);
        localStorage.setItem(`${ROLE_GROUP_PREFIX}${faction}`, collapsed ? "1" : "0");
        head.setAttribute("aria-expanded", collapsed ? "false" : "true");
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

  function installKickDialog() {
    if (kickDialog) return;
    const nativeConfirm = window.confirm.bind(window);
    window.confirm = (message) => {
      if (allowConfirmOnce) {
        allowConfirmOnce = false;
        return true;
      }
      return nativeConfirm(message);
    };

    kickDialog = document.createElement("dialog");
    kickDialog.id = "kickConfirmDialog";
    kickDialog.className = "confirm-dialog";
    kickDialog.innerHTML = `
      <form method="dialog" class="confirm-dialog-card">
        <div class="confirm-dialog-copy">
          <span class="eyebrow">HOST ACTION</span>
          <h2 data-kick-title></h2>
          <p data-kick-body></p>
        </div>
        <label class="confirm-dialog-check"><input data-kick-skip type="checkbox" /> <span data-kick-skip-label></span></label>
        <div class="confirm-dialog-actions">
          <button value="cancel" class="button button-ghost" type="submit" data-kick-cancel></button>
          <button value="confirm" class="button button-primary" type="submit" data-kick-confirm></button>
        </div>
      </form>`;
    document.body.append(kickDialog);

    kickDialog.addEventListener("close", () => {
      if (kickDialog.returnValue !== "confirm" || !kickTargetButton) {
        kickTargetButton = null;
        return;
      }
      if (kickDialog.querySelector("[data-kick-skip]")?.checked) localStorage.setItem(SKIP_KICK_KEY, "1");
      replayKick(kickTargetButton);
      kickTargetButton = null;
    });

    document.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-kick]");
      if (!button) return;
      if (bypassKickButton === button) {
        bypassKickButton = null;
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (localStorage.getItem(SKIP_KICK_KEY) === "1") {
        replayKick(button);
        return;
      }
      openKickDialog(button);
    }, true);
  }

  function openKickDialog(button) {
    kickTargetButton = button;
    const playerName = button.closest(".player-row")?.querySelector(".player-name strong")?.textContent?.trim() || "";
    kickDialog.querySelector("[data-kick-title]").textContent = playerName ? `${text("kickTitle")} ${playerName}` : text("kickTitle");
    kickDialog.querySelector("[data-kick-body]").textContent = text("kickBody");
    kickDialog.querySelector("[data-kick-skip-label]").textContent = text("dontShowAgain");
    kickDialog.querySelector("[data-kick-cancel]").textContent = text("cancel");
    kickDialog.querySelector("[data-kick-confirm]").textContent = text("confirm");
    const checkbox = kickDialog.querySelector("[data-kick-skip]");
    if (checkbox) checkbox.checked = false;
    kickDialog.showModal();
  }

  function replayKick(button) {
    bypassKickButton = button;
    allowConfirmOnce = true;
    button.click();
    setTimeout(() => { allowConfirmOnce = false; }, 5000);
  }

  function scheduleEnhance() {
    clearTimeout(enhanceTimer);
    enhanceTimer = setTimeout(() => {
      installPanelCollapse();
      installRoleGroupCollapse();
      void enhanceTranslations();
    }, 0);
  }

  function initDom() {
    installKickDialog();
    installPanelCollapse();
    installRoleGroupCollapse();
    document.querySelector("#languageSelect")?.addEventListener("change", () => {
      translationCache.clear();
      setTimeout(() => {
        installPanelCollapse();
        installRoleGroupCollapse();
        void enhanceTranslations();
        document.querySelectorAll("[data-panel-collapse]").forEach((button) => {
          syncPanelCollapseButton(button, button.closest(".panel")?.classList.contains("panel-collapsed"));
        });
      }, 0);
    });

    const game = document.querySelector("#game");
    if (game) {
      new MutationObserver(scheduleEnhance).observe(game, { childList: true, subtree: true });
    }
    scheduleEnhance();
  }

  installWebSocketObserver();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initDom, { once: true });
  else initDom();
})();