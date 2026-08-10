(() => {
  const COLLAPSE_PREFIX = "werewolf-panel-collapsed:";
  const ROLE_GROUP_PREFIX = "werewolf-role-group-collapsed:";
  const STATUS_ID = "translationServiceStatus";
  const nativeFetch = window.fetch.bind(window);
  const staticI18n = () => window.WerewolfGameI18n;
  const staticSources = new WeakMap();

  const LABELS = {
    "zh-TW": { collapse: "縮起", expand: "展開", translationError: "玩家聊天翻譯目前無法使用；將保留原文。" },
    "zh-CN": { collapse: "收起", expand: "展开", translationError: "玩家聊天翻译目前不可用；将保留原文。" },
    en: { collapse: "Collapse", expand: "Expand", translationError: "Player chat translation is unavailable; original text is shown." }
  };

  let latestState = null;
  let websocketToken = "";
  let timer = 0;
  let generation = 0;
  const chatCache = new Map();

  function locale() {
    const value = localStorage.getItem("werewolf-locale");
    return value === "zh-CN" || value === "en" ? value : "zh-TW";
  }
  function label(key) { return LABELS[locale()]?.[key] || LABELS["zh-TW"][key] || key; }
  function roomId() { return location.pathname.toUpperCase().match(/^\/([A-Z2-9]{6})\/?$/)?.[1] || ""; }
  function roomToken() {
    if (websocketToken) return websocketToken;
    const id = roomId();
    if (!id) return "";
    try { return JSON.parse(localStorage.getItem(`werewolf-session:${id}`) || "null")?.token || ""; } catch { return ""; }
  }

  // Prevent the generic UI/role/system i18n fallback from sending fixed game
  // content to remote translation. nativeFetch remains reserved for player chat.
  window.fetch = function guardedFetch(input, init) {
    try {
      const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url, location.href);
      if (/^\/api\/rooms\/[A-Z2-9]{6}\/translate$/.test(url.pathname)) {
        return Promise.reject(new Error("Remote translation is reserved for player chat"));
      }
    } catch {}
    return nativeFetch(input, init);
  };

  function installWebSocketObserver() {
    const NativeWebSocket = window.WebSocket;
    class UiFixWebSocket extends NativeWebSocket {
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
              schedule();
            }
          } catch {}
        });
      }
    }
    Object.defineProperties(UiFixWebSocket, {
      CONNECTING: { value: NativeWebSocket.CONNECTING }, OPEN: { value: NativeWebSocket.OPEN },
      CLOSING: { value: NativeWebSocket.CLOSING }, CLOSED: { value: NativeWebSocket.CLOSED }
    });
    window.WebSocket = UiFixWebSocket;
  }

  async function requestChatTranslations(texts, sourceLocale, targetLocale) {
    if (!texts.length || (sourceLocale && sourceLocale === targetLocale)) return [...texts];
    const id = roomId();
    const token = roomToken();
    if (!id || !token) throw new Error("missing room translation session");
    const output = [];
    for (let index = 0; index < texts.length; index += 40) {
      const chunk = texts.slice(index, index + 40);
      const payload = { token, targetLocale, texts: chunk };
      if (sourceLocale) payload.sourceLocale = sourceLocale;
      const response = await nativeFetch(`/api/rooms/${id}/translate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      if (!Array.isArray(body.translations) || body.translations.length !== chunk.length) throw new Error("translation response length mismatch");
      output.push(...body.translations.map((value, i) => typeof value === "string" && value.trim() ? value.trim() : chunk[i]));
    }
    return output;
  }

  async function translatedChatMap(texts, sourceLocale, targetLocale) {
    const sourceKey = sourceLocale || "auto";
    const unique = [...new Set(texts.map((value) => String(value ?? "").trim()).filter(Boolean))];
    const missing = unique.filter((source) => !chatCache.has(`${sourceKey}\u0000${targetLocale}\u0000${source}`));
    if (missing.length) {
      const translated = await requestChatTranslations(missing, sourceLocale, targetLocale);
      missing.forEach((source, index) => chatCache.set(`${sourceKey}\u0000${targetLocale}\u0000${source}`, translated[index] || source));
    }
    return new Map(unique.map((source) => [
      source,
      sourceLocale && sourceLocale === targetLocale
        ? source
        : chatCache.get(`${sourceKey}\u0000${targetLocale}\u0000${source}`) || source
    ]));
  }

  function statusNode() {
    let node = document.getElementById(STATUS_ID);
    if (node) return node;
    const actions = document.querySelector(".brand-actions");
    if (!actions) return null;
    node = document.createElement("span");
    node.id = STATUS_ID;
    node.className = "translation-service-status hidden";
    node.setAttribute("role", "status");
    actions.prepend(node);
    return node;
  }
  function showTranslationError() { const node = statusNode(); if (node) { node.textContent = label("translationError"); node.classList.remove("hidden"); } }
  function clearTranslationError() { statusNode()?.classList.add("hidden"); }

  async function translateMessages(runGeneration) {
    if (!latestState?.messages?.length || runGeneration !== generation) return;
    const rows = [...document.querySelectorAll("#messages .message")];
    if (!rows.length) return;
    const targetLocale = locale();
    const playerGroups = new Map();
    const fixed = staticI18n();

    latestState.messages.forEach((message, index) => {
      const row = rows[index];
      if (!row) return;
      const sourceLocale = message.sourceLocale || undefined;
      const source = String(message.content ?? "");
      const body = row.querySelector(".message-content");
      const name = row.querySelector(".message-head strong");

      if (message.kind === "system" || message.kind === "role") {
        const translated = targetLocale === "zh-TW" ? source : fixed?.text(source, targetLocale) || source;
        if (body && body.textContent !== translated) body.textContent = translated;
        if (body && body.title !== translated) body.title = translated;
        if (message.kind === "system" && name) {
          const systemName = targetLocale === "zh-TW" ? "系統" : fixed?.text("系統", targetLocale) || "系統";
          if (name.textContent !== systemName) name.textContent = systemName;
        }
        return;
      }

      if (sourceLocale && sourceLocale === targetLocale) {
        if (body && body.textContent !== source) body.textContent = source;
        if (body && body.title !== source) body.title = source;
        return;
      }
      const groupKey = sourceLocale || "";
      const items = playerGroups.get(groupKey) || [];
      items.push({ row, source });
      playerGroups.set(groupKey, items);
    });

    for (const [groupKey, items] of playerGroups) {
      const sourceLocale = groupKey || undefined;
      const map = await translatedChatMap(items.map((item) => item.source), sourceLocale, targetLocale);
      if (runGeneration !== generation) return;
      for (const item of items) {
        const body = item.row.querySelector(".message-content");
        const translated = map.get(item.source) || item.source;
        if (body && body.textContent !== translated) body.textContent = translated;
        if (body && body.title !== translated) body.title = translated;
      }
    }
  }

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
        if (!fixed.canTranslate(current)) continue;
        source = current;
        staticSources.set(node, source);
      }
      const translated = fixed.text(source, targetLocale);
      const original = node.nodeValue || "";
      const trimmed = original.trim();
      const start = original.indexOf(trimmed);
      const next = `${original.slice(0, start)}${translated}${original.slice(start + trimmed.length)}`;
      if (next !== original) node.nodeValue = next;
    }
  }

  async function translateDynamicContent() {
    const runGeneration = generation;
    translateRoleCatalog();
    translateFixedGameDom();
    if (!roomId()) { clearTranslationError(); return; }
    try {
      await translateMessages(runGeneration);
      if (runGeneration === generation) clearTranslationError();
    } catch {
      if (runGeneration === generation) showTranslationError();
    }
  }

  function syncCollapseButton(button, collapsed) {
    button.textContent = collapsed ? "+" : "−";
    button.title = collapsed ? label("expand") : label("collapse");
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }

  function installPanelCollapse() {
    const panels = [["action", document.querySelector(".action-card")],["chat", document.querySelector(".chat-card")],["players", document.querySelector(".players-card")],["host", document.querySelector("#hostPanel")]];
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
      const faction = group.dataset.roleGroup || "unknown";
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
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); }
      });
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => { installPanelCollapse(); installRoleGroupCollapse(); void translateDynamicContent(); }, 0);
  }

  function init() {
    installPanelCollapse();
    installRoleGroupCollapse();
    statusNode();
    document.querySelector("#languageSelect")?.addEventListener("change", () => {
      generation += 1;
      chatCache.clear();
      setTimeout(() => {
        installPanelCollapse(); installRoleGroupCollapse();
        document.querySelectorAll("[data-panel-collapse]").forEach((button) => syncCollapseButton(button, button.closest(".panel")?.classList.contains("panel-collapsed")));
        void translateDynamicContent();
      }, 0);
    });
    const game = document.querySelector("#game");
    if (game) new MutationObserver(schedule).observe(game, { childList: true, subtree: true });
    const dialog = document.querySelector("#confirmDialog");
    if (dialog) new MutationObserver(schedule).observe(dialog, { childList: true, subtree: true });
    schedule();
  }

  installWebSocketObserver();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
