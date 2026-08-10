(() => {
  const COLLAPSE_PREFIX = "werewolf-panel-collapsed:";
  const ROLE_GROUP_PREFIX = "werewolf-role-group-collapsed:";
  const STATUS_ID = "translationServiceStatus";
  const LABELS = {
    "zh-TW": {
      collapse: "縮起",
      expand: "展開",
      translationError: "翻譯服務目前無法使用；請確認 Worker Secret GOOGLE_TRANSLATE_API_KEYS。"
    },
    "zh-CN": {
      collapse: "收起",
      expand: "展开",
      translationError: "翻译服务目前不可用；请确认 Worker Secret GOOGLE_TRANSLATE_API_KEYS。"
    },
    en: {
      collapse: "Collapse",
      expand: "Expand",
      translationError: "Translation is unavailable. Check the GOOGLE_TRANSLATE_API_KEYS Worker Secret."
    }
  };

  let latestState = null;
  let websocketToken = "";
  let timer = 0;
  let generation = 0;
  const cache = new Map();

  function locale() {
    const value = localStorage.getItem("werewolf-locale");
    return value === "zh-CN" || value === "en" ? value : "zh-TW";
  }

  function label(key) {
    return LABELS[locale()]?.[key] || LABELS["zh-TW"][key] || key;
  }

  function roomId() {
    return location.pathname.toUpperCase().match(/^\/([A-Z2-9]{6})\/?$/)?.[1] || "";
  }

  function roomToken() {
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
      CONNECTING: { value: NativeWebSocket.CONNECTING },
      OPEN: { value: NativeWebSocket.OPEN },
      CLOSING: { value: NativeWebSocket.CLOSING },
      CLOSED: { value: NativeWebSocket.CLOSED }
    });
    window.WebSocket = UiFixWebSocket;
  }

  async function requestTranslations(texts, sourceLocale, targetLocale) {
    if (!texts.length || sourceLocale === targetLocale) return [...texts];
    const id = roomId();
    const token = roomToken();
    if (!id || !token) throw new Error("missing room translation session");

    const output = [];
    for (let index = 0; index < texts.length; index += 40) {
      const chunk = texts.slice(index, index + 40);
      const response = await fetch(`/api/rooms/${id}/translate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, sourceLocale, targetLocale, texts: chunk })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      if (!Array.isArray(body.translations) || body.translations.length !== chunk.length) {
        throw new Error("translation response length mismatch");
      }
      output.push(...body.translations.map((value, i) => typeof value === "string" && value.trim() ? value.trim() : chunk[i]));
    }
    return output;
  }

  async function translatedMap(texts, sourceLocale, targetLocale) {
    const unique = [...new Set(texts.map((value) => String(value ?? "").trim()).filter(Boolean))];
    const missing = unique.filter((source) => !cache.has(`${sourceLocale}\u0000${targetLocale}\u0000${source}`));
    if (missing.length) {
      const translated = await requestTranslations(missing, sourceLocale, targetLocale);
      missing.forEach((source, index) => cache.set(`${sourceLocale}\u0000${targetLocale}\u0000${source}`, translated[index] || source));
    }
    return new Map(unique.map((source) => [source, sourceLocale === targetLocale ? source : cache.get(`${sourceLocale}\u0000${targetLocale}\u0000${source}`) || source]));
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

  function showTranslationError() {
    const node = statusNode();
    if (!node) return;
    node.textContent = label("translationError");
    node.classList.remove("hidden");
  }

  function clearTranslationError() {
    statusNode()?.classList.add("hidden");
  }

  async function translateMessages(runGeneration) {
    if (!latestState?.messages?.length || runGeneration !== generation) return;
    const rows = [...document.querySelectorAll("#messages .message")];
    if (!rows.length) return;
    const targetLocale = locale();
    const groups = new Map();

    latestState.messages.forEach((message, index) => {
      const row = rows[index];
      if (!row) return;
      const sourceLocale = message.sourceLocale || "zh-TW";
      const source = String(message.content ?? "");
      if (sourceLocale === targetLocale) {
        const body = row.querySelector(".message-content");
        if (body) {
          body.textContent = source;
          body.title = source;
        }
        return;
      }
      const items = groups.get(sourceLocale) || [];
      items.push({ row, source });
      groups.set(sourceLocale, items);
    });

    for (const [sourceLocale, items] of groups) {
      const map = await translatedMap(items.map((item) => item.source), sourceLocale, targetLocale);
      if (runGeneration !== generation) return;
      for (const item of items) {
        const body = item.row.querySelector(".message-content");
        const translated = map.get(item.source) || item.source;
        if (body) {
          body.textContent = translated;
          body.title = translated;
        }
      }
    }
  }

  async function translateRoleCatalog(runGeneration) {
    const targetLocale = locale();
    const nodes = [...document.querySelectorAll("#roleCatalog .role-title strong, #roleCatalog .role-copy p, #roleCatalog .adaptation")];
    if (!nodes.length || targetLocale === "zh-TW" || runGeneration !== generation) return;

    const sources = [];
    for (const node of nodes) {
      const current = node.textContent?.trim() || "";
      if (!current) continue;
      if (!node.dataset.uiFixSource) node.dataset.uiFixSource = current;
      const source = node.dataset.uiFixSource;
      if (source) sources.push(source);
    }
    if (!sources.length) return;

    const map = await translatedMap(sources, "zh-TW", targetLocale);
    if (runGeneration !== generation) return;
    for (const node of nodes) {
      const source = node.dataset.uiFixSource || "";
      if (source) node.textContent = map.get(source) || source;
    }
  }

  async function translateDynamicContent() {
    if (!roomId() || locale() === "zh-TW") {
      clearTranslationError();
      return;
    }
    const runGeneration = generation;
    try {
      await Promise.all([translateMessages(runGeneration), translateRoleCatalog(runGeneration)]);
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
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle();
        }
      });
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      installPanelCollapse();
      installRoleGroupCollapse();
      void translateDynamicContent();
    }, 0);
  }

  function init() {
    installPanelCollapse();
    installRoleGroupCollapse();
    statusNode();

    document.querySelector("#languageSelect")?.addEventListener("change", () => {
      generation += 1;
      cache.clear();
      setTimeout(() => {
        installPanelCollapse();
        installRoleGroupCollapse();
        document.querySelectorAll("[data-panel-collapse]").forEach((button) => {
          syncCollapseButton(button, button.closest(".panel")?.classList.contains("panel-collapsed"));
        });
        void translateDynamicContent();
      }, 0);
    });

    const game = document.querySelector("#game");
    if (game) new MutationObserver(schedule).observe(game, { childList: true, subtree: true });
    schedule();
  }

  installWebSocketObserver();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();