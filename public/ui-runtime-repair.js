(() => {
  const MODE_KEY = "werewolf-room-toolkit:compact";
  const MODE_CLASS = "room-compact-mode";
  const nativeFetch = window.fetch.bind(window);

  const labels = {
    "zh-TW": {
      normalState: "目前：一般模式",
      compactState: "目前：精簡模式",
      toNormal: "切換一般模式",
      toCompact: "切換精簡模式",
      normalHelp: "一般模式顯示完整的玩家搜尋、訊息篩選與房間統計。",
      compactHelp: "精簡模式隱藏搜尋、篩選與次要統計，只保留遊戲核心操作。"
    },
    "zh-CN": {
      normalState: "当前：一般模式",
      compactState: "当前：精简模式",
      toNormal: "切换一般模式",
      toCompact: "切换精简模式",
      normalHelp: "一般模式显示完整的玩家搜索、消息筛选与房间统计。",
      compactHelp: "精简模式隐藏搜索、筛选与次要统计，只保留游戏核心操作。"
    },
    en: {
      normalState: "Current: Normal mode",
      compactState: "Current: Compact mode",
      toNormal: "Switch to Normal",
      toCompact: "Switch to Compact",
      normalHelp: "Normal mode shows player search, message filters, and room statistics.",
      compactHelp: "Compact mode hides search, filters, and secondary statistics so core game controls stay in focus."
    }
  };

  installFixedCopyTranslationPolicy();
  installModeStyles();
  installModeRepair();

  function locale() {
    const stored = localStorage.getItem("werewolf-locale");
    const selected = document.querySelector("#languageSelect")?.value;
    const value = stored || selected;
    return value === "zh-CN" || value === "en" ? value : "zh-TW";
  }

  function copy(key) {
    return labels[locale()]?.[key] || labels["zh-TW"][key] || key;
  }

  function installFixedCopyTranslationPolicy() {
    window.fetch = async function repairedFetch(input, init) {
      try {
        const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url, location.href);
        const isTranslationRequest = /^\/api\/rooms\/[A-Z2-9]{6}\/translate$/i.test(url.pathname);
        const bodyText = typeof init?.body === "string" ? init.body : "";
        if (isTranslationRequest && bodyText) {
          const body = JSON.parse(bodyText);
          const explicitSource = typeof body.sourceLocale === "string" && body.sourceLocale !== "auto";
          if (explicitSource && Array.isArray(body.texts)) {
            const targetLocale = body.targetLocale === "zh-CN" || body.targetLocale === "en" ? body.targetLocale : "zh-TW";
            const translations = body.texts.map((value) => localFixedText(String(value ?? ""), targetLocale));
            return new Response(JSON.stringify({ translations, targetLocale, localOnly: true }), {
              status: 200,
              headers: { "content-type": "application/json; charset=utf-8", "x-werewolf-translation": "local-fixed-copy" }
            });
          }
        }
      } catch {
        // Malformed/non-standard fetch inputs continue through the native fetch implementation.
      }
      return nativeFetch(input, init);
    };
  }

  function localFixedText(source, targetLocale) {
    const local = window.WerewolfGameI18n;
    try {
      const translated = local?.text?.(source, targetLocale);
      if (typeof translated === "string" && translated.trim()) return translated;
    } catch {
      // Repository copy is best-effort; unknown fixed copy stays in its authored source language.
    }
    return source;
  }

  function installModeRepair() {
    const apply = () => {
      let button = document.querySelector("#roomCompactToggle");
      if (!button) return false;

      if (button.dataset.runtimeRepair !== "1") {
        const replacement = button.cloneNode(true);
        replacement.dataset.runtimeRepair = "1";
        replacement.type = "button";
        replacement.disabled = false;
        replacement.removeAttribute("aria-disabled");
        button.replaceWith(replacement);
        button = replacement;
        button.addEventListener("click", () => setCompactMode(!document.body.classList.contains(MODE_CLASS), true));
      }

      let state = document.querySelector("#roomDisplayModeState");
      if (!state) {
        state = document.createElement("span");
        state.id = "roomDisplayModeState";
        state.className = "room-display-mode-state";
        state.dataset.noTranslate = "";
        button.before(state);
      }
      syncModeControl();
      return true;
    };

    if (!apply()) {
      const observer = new MutationObserver(() => {
        if (apply()) observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    document.querySelector("#languageSelect")?.addEventListener("change", () => setTimeout(syncModeControl, 0));
  }

  function setCompactMode(enabled, persist) {
    document.body.classList.toggle(MODE_CLASS, enabled);
    if (persist) localStorage.setItem(MODE_KEY, enabled ? "1" : "0");
    syncModeControl();
  }

  function syncModeControl() {
    const button = document.querySelector("#roomCompactToggle");
    const state = document.querySelector("#roomDisplayModeState");
    if (!button) return;
    const compact = document.body.classList.contains(MODE_CLASS);
    button.disabled = false;
    button.removeAttribute("aria-disabled");
    button.setAttribute("aria-pressed", compact ? "true" : "false");
    button.setAttribute("aria-label", compact ? copy("toNormal") : copy("toCompact"));
    button.title = compact ? copy("compactHelp") : copy("normalHelp");
    button.textContent = compact ? copy("toNormal") : copy("toCompact");
    button.classList.toggle("mode-active", compact);
    if (state) {
      state.textContent = compact ? copy("compactState") : copy("normalState");
      state.title = compact ? copy("compactHelp") : copy("normalHelp");
    }
  }

  function installModeStyles() {
    if (document.querySelector("#roomModeRepairStyles")) return;
    const style = document.createElement("style");
    style.id = "roomModeRepairStyles";
    style.textContent = `
      .room-toolkit-actions { position: relative; z-index: 4; }
      #roomCompactToggle { position: relative; z-index: 5; pointer-events: auto !important; min-width: 126px; }
      #roomCompactToggle.mode-active { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
      .room-display-mode-state { display: inline-flex; align-items: center; min-height: 34px; padding: 0 8px; color: var(--muted); font-size: 10px; font-weight: 800; white-space: nowrap; }

      .room-compact-mode #roomPlayerTools,
      .room-compact-mode #roomMessageTools,
      .room-compact-mode .room-quick-tools > .room-toolkit-stat,
      .room-compact-mode .room-quick-tools > .room-toolkit-sync { display: none !important; }
      .room-compact-mode .room-quick-tools { display: flex !important; justify-content: flex-end; min-height: 0; border-radius: 14px; background: transparent; box-shadow: none; }
      .room-compact-mode .room-quick-tools .room-toolkit-actions { width: 100%; justify-content: flex-end; padding: 6px 8px; border: 0; }
      .room-compact-mode .action-card,
      .room-compact-mode .chat-card,
      .room-compact-mode .players-card,
      .room-compact-mode .host-card { padding: 12px !important; }
      .room-compact-mode .section-heading.compact-heading { margin-bottom: 9px; }
      .room-compact-mode .section-heading.compact-heading > .eyebrow,
      .room-compact-mode .chat-heading .eyebrow { display: none; }
      .room-compact-mode .player-row { padding: 7px 8px !important; }
      .room-compact-mode .messages { min-height: 340px; max-height: 72vh; }
      .room-compact-mode .players { max-height: 38vh; }

      @media (max-width: 680px) {
        .room-display-mode-state { flex: 1 1 auto; }
        #roomCompactToggle { min-width: 0; flex: 1 1 140px; }
      }
    `;
    document.head.append(style);
  }
})();