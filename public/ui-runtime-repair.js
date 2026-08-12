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
      compactHelp: "精簡模式隱藏搜尋、篩選與次要統計，只保留遊戲核心操作。",
      debatePaused: "依序發言中：投票倒數已暫停",
      debatePausedHelp: "現在只有輪到的玩家可以輸入正式發言。送出後才換下一位；所有人講完後，才開始完整的投票倒數。",
      debateCurrentHelp: "現在只有你可以輸入。請使用正式發言框；送出後才換下一位。",
      debateWaitingHelp: "現在只有輪到的玩家可以輸入；你的聊天框已暫停。",
      debateCurrentStatus: "輪到你：請使用上方正式發言框",
      debateWaitingStatus: "依序發言中：一般聊天已暫停",
      voteStarted: "正式發言已完成；現在才開始投票倒數。",
      skillPending: "技能提交只代表送出選擇",
      skillPendingHelp: "是否真的造成死亡或其他效果，要等伺服器依規則結算；送出目標不等於已經擊殺。",
      wolfChoice: "狼人夜間選擇",
      wolfTarget: "選擇本夜攻擊目標",
      wolfSubmit: "提交目標（尚未結算）",
      wolfSubmitted: "狼隊目標已提交，等待夜間結算。",
      roleSubmit: "提交技能選擇（尚未結算）"
    },
    "zh-CN": {
      normalState: "当前：一般模式",
      compactState: "当前：精简模式",
      toNormal: "切换一般模式",
      toCompact: "切换精简模式",
      normalHelp: "一般模式显示完整的玩家搜索、消息筛选与房间统计。",
      compactHelp: "精简模式隐藏搜索、筛选与次要统计，只保留游戏核心操作。",
      debatePaused: "依次发言中：投票倒计时已暂停",
      debatePausedHelp: "现在只有轮到的玩家可以输入正式发言。提交后才换下一位；所有人发言完后，才开始完整的投票倒计时。",
      debateCurrentHelp: "现在只有你可以输入。请使用正式发言框；提交后才换下一位。",
      debateWaitingHelp: "现在只有轮到的玩家可以输入；你的聊天框已暂停。",
      debateCurrentStatus: "轮到你：请使用上方正式发言框",
      debateWaitingStatus: "依次发言中：一般聊天已暂停",
      voteStarted: "正式发言已完成；现在才开始投票倒计时。",
      skillPending: "提交技能只代表送出选择",
      skillPendingHelp: "是否真的造成死亡或其他效果，要等服务器按规则结算；送出目标不等于已经击杀。",
      wolfChoice: "狼人夜间选择",
      wolfTarget: "选择本夜攻击目标",
      wolfSubmit: "提交目标（尚未结算）",
      wolfSubmitted: "狼队目标已提交，等待夜间结算。",
      roleSubmit: "提交技能选择（尚未结算）"
    },
    en: {
      normalState: "Current: Normal mode",
      compactState: "Current: Compact mode",
      toNormal: "Switch to Normal",
      toCompact: "Switch to Compact",
      normalHelp: "Normal mode shows player search, message filters, and room statistics.",
      compactHelp: "Compact mode hides search, filters, and secondary statistics so core game controls stay in focus.",
      debatePaused: "Sequential speeches: vote timer paused",
      debatePausedHelp: "Only the current speaker can enter a formal speech. Submitting passes the turn; the full vote timer starts only after every required speech is finished.",
      debateCurrentHelp: "Only you can enter text right now. Use the formal speech box; submitting passes the turn.",
      debateWaitingHelp: "Only the current speaker can enter text right now; your general chat box is paused.",
      debateCurrentStatus: "Your turn: use the formal speech box above",
      debateWaitingStatus: "Sequential speeches: general chat paused",
      voteStarted: "Formal speeches are complete; the vote timer starts now.",
      skillPending: "Submitting an ability only records your choice",
      skillPendingHelp: "A death or other effect is not confirmed until the server resolves the phase. Choosing a target does not mean the target is already killed.",
      wolfChoice: "Werewolf night choice",
      wolfTarget: "Choose tonight's attack target",
      wolfSubmit: "Submit target (not resolved yet)",
      wolfSubmitted: "Wolf target submitted; waiting for night resolution.",
      roleSubmit: "Submit ability choice (not resolved yet)"
    }
  };

  installFixedCopyTranslationPolicy();
  installModeStyles();
  installModeRepair();
  installFlowClarityRepair();

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

  function installFlowClarityRepair() {
    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        syncFlowClarity();
      });
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.querySelector("#languageSelect")?.addEventListener("change", () => setTimeout(schedule, 0));
    schedule();
  }

  function syncFlowClarity() {
    const area = document.querySelector("#actionArea");
    if (!area) return;
    const debate = Boolean(area.querySelector(".speech-order"));
    const currentSpeaker = Boolean(area.querySelector("#debateSpeech"));
    syncDebateChatLock(debate, currentSpeaker);
    syncDebateNotice(area, debate, currentSpeaker);
    syncNightSubmissionClarity(area);
    syncVoteClarity(area, debate);
  }

  function syncDebateChatLock(debate, currentSpeaker) {
    if (!debate) return;
    const input = document.querySelector("#chatInput");
    const button = document.querySelector("#chatForm button[type='submit']");
    const status = document.querySelector("#chatStatus");
    if (input) input.disabled = true;
    if (button) button.disabled = true;
    if (status) {
      const text = currentSpeaker ? copy("debateCurrentStatus") : copy("debateWaitingStatus");
      if (status.textContent !== text) status.textContent = text;
      status.classList.add("blocked");
    }
  }

  function syncDebateNotice(area, debate, currentSpeaker) {
    let note = area.querySelector("#debateFlowNotice");
    if (!debate) {
      note?.remove();
      return;
    }
    if (!note) {
      note = document.createElement("div");
      note.id = "debateFlowNotice";
      note.className = "flow-clarity-note";
      note.dataset.noTranslate = "";
      area.prepend(note);
    }
    const noteHtml = `<strong>${escapeHtml(copy("debatePaused"))}</strong><p>${escapeHtml(copy("debatePausedHelp"))}</p>`;
    if (note.innerHTML !== noteHtml) note.innerHTML = noteHtml;

    const debateCard = [...area.querySelectorAll(".phase-card")].find((card) => {
      const tag = String(card.querySelector("span")?.textContent || "").toUpperCase();
      return tag.includes("DEBATE") || tag.includes("YOUR TURN");
    });
    const help = debateCard?.querySelector("p");
    const desired = currentSpeaker ? copy("debateCurrentHelp") : copy("debateWaitingHelp");
    if (help && help.textContent !== desired) {
      help.textContent = desired;
      help.dataset.noTranslate = "";
    }
  }

  function syncNightSubmissionClarity(area) {
    const night = Boolean(area.querySelector(".night-card"));
    let note = area.querySelector("#skillSubmissionNotice");
    if (!night) {
      note?.remove();
      return;
    }
    if (!note) {
      note = document.createElement("div");
      note.id = "skillSubmissionNotice";
      note.className = "flow-clarity-note skill-clarity-note";
      note.dataset.noTranslate = "";
      const nightCard = area.querySelector(".night-card");
      nightCard?.insertAdjacentElement("afterend", note);
    }
    const noteHtml = `<strong>${escapeHtml(copy("skillPending"))}</strong><p>${escapeHtml(copy("skillPendingHelp"))}</p>`;
    if (note.innerHTML !== noteHtml) note.innerHTML = noteHtml;

    const wolfButton = area.querySelector("#wolfVoteButton");
    if (wolfButton && wolfButton.textContent !== copy("wolfSubmit")) wolfButton.textContent = copy("wolfSubmit");
    const wolfBox = wolfButton?.closest(".skill-box");
    const wolfLabel = wolfBox?.querySelector(".skill-label");
    const wolfTitle = wolfBox?.querySelector("strong");
    if (wolfLabel && wolfLabel.textContent !== copy("wolfChoice")) wolfLabel.textContent = copy("wolfChoice");
    if (wolfTitle && wolfTitle.textContent !== copy("wolfTarget")) wolfTitle.textContent = copy("wolfTarget");

    for (const strong of area.querySelectorAll(".intel-card strong")) {
      if (["狼刀票已提交。", "狼刀票已提交。"].includes(String(strong.textContent || "").trim())) strong.textContent = copy("wolfSubmitted");
    }
    const roleButton = area.querySelector("#roleActionButton");
    if (roleButton && roleButton.textContent !== copy("roleSubmit")) roleButton.textContent = copy("roleSubmit");
  }

  function syncVoteClarity(area, debate) {
    let note = area.querySelector("#voteFlowNotice");
    const vote = !debate && [...area.querySelectorAll(".phase-card > span")].some((node) => String(node.textContent || "").trim().toUpperCase() === "VOTE");
    if (!vote) {
      note?.remove();
      return;
    }
    if (!note) {
      note = document.createElement("div");
      note.id = "voteFlowNotice";
      note.className = "flow-clarity-note vote-clarity-note";
      note.dataset.noTranslate = "";
      area.prepend(note);
    }
    const html = `<strong>${escapeHtml(copy("voteStarted"))}</strong>`;
    if (note.innerHTML !== html) note.innerHTML = html;
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
      .flow-clarity-note { margin: 0 0 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 11px; background: #f7f4ef; }
      .flow-clarity-note strong { display: block; font-size: 12px; }
      .flow-clarity-note p { margin: 4px 0 0; color: var(--muted); font-size: 10px; line-height: 1.55; }
      .skill-clarity-note { border-style: dashed; }
      .vote-clarity-note { background: #f4f7f1; }

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

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }
})();