(() => {
  const COLLAPSE_PREFIX = "werewolf-panel-collapsed:";
  const ROLE_GROUP_PREFIX = "werewolf-role-group-collapsed:";
  const nativeFetch = window.fetch.bind(window);
  const staticI18n = () => window.WerewolfGameI18n;
  const staticSources = new WeakMap();
  let timer = 0;
  let gameObserver = null;
  let dialogObserver = null;

  const LABELS = {
    "zh-TW": { collapse: "縮起", expand: "展開" },
    "zh-CN": { collapse: "收起", expand: "展開" },
    en: { collapse: "Collapse", expand: "Expand" }
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

  function applyUiFixes() {
    installPanelCollapse();
    installRoleGroupCollapse();
    translateRoleCatalog();
    translateFixedGameDom();
    translateFixedMessages();
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