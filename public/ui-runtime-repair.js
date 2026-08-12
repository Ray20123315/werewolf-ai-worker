(() => {
  const nativeFetch = window.fetch.bind(window);

  const labels = {
    "zh-TW": {
      debateCurrentHelp: "投票倒數已暫停；現在只有你可以輸入正式發言，送出後才換下一位。",
      debateWaitingHelp: "投票倒數已暫停；現在只有輪到的玩家可以輸入，你的一般聊天已暫停。",
      debateCurrentStatus: "輪到你：請使用上方正式發言框",
      debateWaitingStatus: "依序發言中：一般聊天已暫停",
      wolfChoice: "狼人夜間選擇",
      wolfTarget: "選擇本夜攻擊目標",
      wolfSubmit: "提交目標（尚未結算）",
      wolfSubmitted: "狼隊目標已提交，等待夜間結算。",
      roleSubmit: "提交技能選擇（尚未結算）"
    },
    "zh-CN": {
      debateCurrentHelp: "投票倒计时已暂停；现在只有你可以输入正式发言，提交后才换下一位。",
      debateWaitingHelp: "投票倒计时已暂停；现在只有轮到的玩家可以输入，你的一般聊天已暂停。",
      debateCurrentStatus: "轮到你：请使用上方正式发言框",
      debateWaitingStatus: "依次发言中：一般聊天已暂停",
      wolfChoice: "狼人夜间选择",
      wolfTarget: "选择本夜攻击目标",
      wolfSubmit: "提交目标（尚未结算）",
      wolfSubmitted: "狼队目标已提交，等待夜间结算。",
      roleSubmit: "提交技能选择（尚未结算）"
    },
    en: {
      debateCurrentHelp: "The vote timer is paused. Only you can enter a formal speech; submitting passes the turn.",
      debateWaitingHelp: "The vote timer is paused. Only the current speaker can enter text; your general chat is paused.",
      debateCurrentStatus: "Your turn: use the formal speech box above",
      debateWaitingStatus: "Sequential speeches: general chat paused",
      wolfChoice: "Werewolf night choice",
      wolfTarget: "Choose tonight's attack target",
      wolfSubmit: "Submit target (not resolved yet)",
      wolfSubmitted: "Wolf target submitted; waiting for night resolution.",
      roleSubmit: "Submit ability choice (not resolved yet)"
    }
  };

  installFixedCopyTranslationPolicy();
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
    const area = document.querySelector("#actionArea");
    if (area) {
      const observer = new MutationObserver(schedule);
      observer.observe(area, { childList: true, subtree: true });
    }
    document.querySelector("#languageSelect")?.addEventListener("change", () => setTimeout(schedule, 0));
    schedule();
  }

  function syncFlowClarity() {
    const area = document.querySelector("#actionArea");
    if (!area) return;
    const debate = Boolean(area.querySelector(".speech-order"));
    const currentSpeaker = Boolean(area.querySelector("#debateSpeech"));
    syncDebateChatLock(debate, currentSpeaker);
    syncDebateCopy(area, debate, currentSpeaker);
    syncNightSubmissionClarity(area);
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

  function syncDebateCopy(area, debate, currentSpeaker) {
    if (!debate) return;
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
    if (!night) return;

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

})();
