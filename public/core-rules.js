(() => {
  const roomId = location.pathname.toUpperCase().match(/^\/([A-Z2-9]{6})\/?$/)?.[1] || "";
  if (!roomId) return;

  const LABELS = {
    "zh-TW": {
      fool: "啟用蠢蛋（每名正式玩家獨立 25% 機率）",
      loverSize: "每組 CP 人數",
      dayMinutes: "白天時間（分鐘）",
      nightMinutes: "夜晚時間（分鐘）",
      timer: "剩餘時間",
      noLimit: "未計時",
      ownRole: "你的角色技能",
      noActiveSkill: "此角色沒有主動技能",
      foolYou: "你本局是蠢蛋",
      normalYou: "你本局不是蠢蛋",
      abstain: "棄票／跳過投票",
      voteSummary: "上一輪投票",
      abstentions: "棄票",
      invalidVotes: "無效票",
      hunterLastWords: "獵人遺言",
      hunterPlaceholder: "留下最後一句話……",
      sendLastWords: "送出遺言",
      cupidTitle: "邱比特配對",
      cupidHelp: "請勾選剛好指定人數；同一玩家不能同時屬於兩組 CP。",
      submitCupid: "確認配對",
      loverGroup: "你的戀人群組",
      pairedByCupid: "本局配對",
      suicideTitle: "自殺炸彈",
      suicideHelp: "可指定 0～2 名其他存活玩家；不必硬選滿兩人。",
      submitSuicide: "引爆",
      winEdge: "屠邊：無怨靈、狼人仍存活且好人方只剩 1 人時，狼人勝",
      winAll: "屠城：狼人必須讓所有其他陣營出局才勝",
      winHelp: "屠邊依目前存活狀態判定；屠城必須清空全部非狼人陣營。",
      skillTiming: "時機"
    },
    "zh-CN": {
      fool: "启用蠢蛋（每名正式玩家独立 25% 概率）", loverSize: "每组 CP 人数", dayMinutes: "白天时间（分钟）", nightMinutes: "夜晚时间（分钟）", timer: "剩余时间", noLimit: "未计时", ownRole: "你的角色技能", noActiveSkill: "此角色没有主动技能", foolYou: "你本局是蠢蛋", normalYou: "你本局不是蠢蛋", abstain: "弃票／跳过投票", voteSummary: "上一轮投票", abstentions: "弃票", invalidVotes: "无效票", hunterLastWords: "猎人遗言", hunterPlaceholder: "留下最后一句话……", sendLastWords: "送出遗言", cupidTitle: "丘比特配对", cupidHelp: "请勾选刚好指定人数；同一玩家不能同时属于两组 CP。", submitCupid: "确认配对", loverGroup: "你的恋人群组", pairedByCupid: "本局配对", suicideTitle: "自杀炸弹", suicideHelp: "可指定 0～2 名其他存活玩家；不必强制选满两人。", submitSuicide: "引爆", winEdge: "屠边：无怨灵、狼人仍存活且好人方只剩 1 人时，狼人胜", winAll: "屠城：狼人必须让所有其他阵营出局才胜", winHelp: "屠边依当前存活状态判定；屠城必须清空全部非狼人阵营。", skillTiming: "时机"
    },
    en: {
      fool: "Enable Fool modifier (independent 25% chance per active player)", loverSize: "Players per CP group", dayMinutes: "Day limit (minutes)", nightMinutes: "Night limit (minutes)", timer: "Time left", noLimit: "No timer", ownRole: "Your role ability", noActiveSkill: "This role has no active ability", foolYou: "You are a Fool this game", normalYou: "You are not a Fool this game", abstain: "Abstain / skip vote", voteSummary: "Previous vote", abstentions: "Abstentions", invalidVotes: "Invalid votes", hunterLastWords: "Hunter last words", hunterPlaceholder: "Leave your final message…", sendLastWords: "Send last words", cupidTitle: "Cupid link", cupidHelp: "Select exactly the configured group size. A player cannot belong to two CP groups.", submitCupid: "Confirm group", loverGroup: "Your lover group", pairedByCupid: "Cupid group", suicideTitle: "Suicide bomb", suicideHelp: "Choose zero, one, or two other living players; selecting two is not mandatory.", submitSuicide: "Detonate", winEdge: "Edge: with no spirits, wolves alive, and at most 1 village player left, wolves win", winAll: "Full elimination: wolves must eliminate every other faction", winHelp: "Edge uses the current surviving factions. Full elimination requires no living non-wolf players.", skillTiming: "Timing"
    }
  };

  let latestState = null;
  let socket = null;
  let reconnectTimer = 0;
  let timerInterval = 0;
  let applying = false;

  const locale = () => {
    const value = localStorage.getItem("werewolf-locale");
    return value === "zh-CN" || value === "en" ? value : "zh-TW";
  };
  const t = (key) => LABELS[locale()]?.[key] || LABELS["zh-TW"][key] || key;

  function session() {
    try { return JSON.parse(localStorage.getItem(`werewolf-session:${roomId}`) || "null"); }
    catch { return null; }
  }

  function connect() {
    const token = session()?.token;
    if (!token) return;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    clearTimeout(reconnectTimer);
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/api/rooms/${roomId}/ws?token=${encodeURIComponent(token)}`);
    socket = ws;
    ws.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "state" && payload.state) {
          latestState = payload.state;
          scheduleApply();
        }
      } catch {}
    });
    ws.addEventListener("close", (event) => {
      if (socket !== ws) return;
      socket = null;
      if (event.code === 1000 || session()?.token !== token) return;
      reconnectTimer = setTimeout(connect, 1200);
    });
  }

  function send(command) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      connect();
      return false;
    }
    socket.send(JSON.stringify(command));
    return true;
  }

  function showToast(message, error = false) {
    const toast = document.querySelector("#toast");
    if (!toast) return;
    toast.textContent = String(message);
    toast.classList.remove("hidden");
    toast.classList.toggle("error", error);
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.add("hidden"), 3600);
  }

  function injectStyle() {
    if (document.querySelector("#coreRulesStyle")) return;
    const style = document.createElement("style");
    style.id = "coreRulesStyle";
    style.textContent = `
      .core-rule-box { padding: 12px 13px; border: 1px solid var(--line); border-radius: 12px; background: #fbfaf7; }
      .core-rule-box strong { display:block; font-size:12px; }
      .core-rule-box p { margin:5px 0 0; color:var(--muted); font-size:10px; line-height:1.55; }
      .core-settings-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px 10px; margin:10px 0; }
      .core-settings-grid label { margin:0; }
      .core-fool-row { grid-column:1 / -1; grid-template-columns:auto 1fr; align-items:center; }
      .core-fool-row input { width:auto; }
      .core-phase-timer { display:inline-flex; margin-top:5px; width:fit-content; padding:4px 8px; border-radius:999px; background:#eee9e3; color:#504942; font-size:10px; font-weight:800; }
      .core-phase-timer.urgent { background:#f8e3df; color:#7c302b; }
      .core-own-role { border-left:3px solid #665c76; }
      .core-fool-chip { display:inline-flex; margin-top:7px; padding:3px 7px; border-radius:999px; background:#f0e8cb; color:#6f571b; font-size:9px; font-weight:800; }
      .core-lover-chip { display:inline-flex; margin-left:5px; padding:3px 6px; border-radius:999px; background:#f1edf8; color:#51465f; font-size:8px; font-weight:800; }
      .core-cupid-grid, .core-suicide-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; margin-top:10px; }
      .core-cupid-grid label, .core-suicide-grid label { display:flex; align-items:center; gap:7px; margin:0; padding:8px; border:1px solid var(--line); border-radius:9px; background:#fff; }
      .core-cupid-grid input, .core-suicide-grid input { width:auto; }
      .core-vote-summary { margin-bottom:10px; padding:10px 12px; border:1px solid var(--line); border-radius:10px; background:#f7f4ef; font-size:10px; line-height:1.55; }
      .core-vote-summary strong { display:block; margin-bottom:4px; font-size:11px; }
      #coreAbstainVote { margin-left:8px; }
      .core-last-words { margin-top:10px; }
      @media(max-width:680px){ .core-settings-grid,.core-cupid-grid,.core-suicide-grid{grid-template-columns:1fr;} .core-fool-row{grid-column:auto;} #coreAbstainVote{margin:8px 0 0;width:100%;} }
    `;
    document.head.append(style);
  }

  function ensureSettings() {
    const form = document.querySelector("#settingsForm");
    if (!form || document.querySelector("#coreSettingsGrid")) return;
    const grid = document.createElement("div");
    grid.id = "coreSettingsGrid";
    grid.className = "core-settings-grid";
    grid.dataset.noTranslate = "";
    grid.innerHTML = `
      <label class="check-row core-fool-row"><input id="coreFoolEnabled" type="checkbox" /><span data-core-label="fool"></span></label>
      <label><span data-core-label="loverSize"></span><input id="coreLoverGroupSize" type="number" min="2" max="50" step="1" value="2" /></label>
      <label><span data-core-label="dayMinutes"></span><input id="coreDayMinutes" type="number" min="0.25" max="60" step="0.25" value="2" /></label>
      <label><span data-core-label="nightMinutes"></span><input id="coreNightMinutes" type="number" min="0.25" max="60" step="0.25" value="2" /></label>`;
    form.insertBefore(grid, form.querySelector('button[type="submit"]'));
    form.addEventListener("submit", () => setTimeout(sendCoreSettings, 0));
  }

  function sendCoreSettings() {
    if (!latestState?.me?.isHost || latestState.phase !== "lobby") return;
    const day = Number(document.querySelector("#coreDayMinutes")?.value || 2);
    const night = Number(document.querySelector("#coreNightMinutes")?.value || 2);
    const command = {
      type: "configure_settings",
      settings: {
        foolEnabled: Boolean(document.querySelector("#coreFoolEnabled")?.checked),
        loverGroupSize: Number.parseInt(document.querySelector("#coreLoverGroupSize")?.value || "2", 10),
        dayDurationSeconds: Math.round(day * 60),
        nightDurationSeconds: Math.round(night * 60)
      }
    };
    if (!send(command)) setTimeout(() => send(command), 250);
  }

  function syncSettings() {
    if (!latestState) return;
    ensureSettings();
    document.querySelectorAll("[data-core-label]").forEach((node) => { node.textContent = t(node.dataset.coreLabel); });
    const settings = latestState.settings || {};
    const fool = document.querySelector("#coreFoolEnabled");
    const size = document.querySelector("#coreLoverGroupSize");
    const day = document.querySelector("#coreDayMinutes");
    const night = document.querySelector("#coreNightMinutes");
    if (fool) fool.checked = Boolean(settings.foolEnabled);
    if (size) size.value = String(settings.loverGroupSize || 2);
    if (day) day.value = String((Number(settings.dayDurationSeconds || 120) / 60).toFixed(2).replace(/\.00$/, ""));
    if (night) night.value = String((Number(settings.nightDurationSeconds || 120) / 60).toFixed(2).replace(/\.00$/, ""));
    const disabled = latestState.phase !== "lobby" || !latestState.me?.isHost;
    [fool, size, day, night].forEach((el) => { if (el) el.disabled = disabled; });

    const win = document.querySelector("#winConditionSelect");
    const help = document.querySelector("#winConditionHelp");
    if (win?.options?.[0]) win.options[0].textContent = t("winEdge");
    if (win?.options?.[1]) win.options[1].textContent = t("winAll");
    if (help) help.textContent = t("winHelp");
  }

  function removeDisabledRoles() {
    const ids = new Set(latestState?.removedRoleIds || ["confirmed_villager", "mimic_wolf", "diviner"]);
    for (const id of ids) document.querySelector(`[data-role-card='${CSS.escape(id)}']`)?.remove();
  }

  function ensureTimer() {
    const phaseLabel = document.querySelector("#phaseLabel");
    if (!phaseLabel) return;
    let timer = document.querySelector("#corePhaseTimer");
    if (!timer) {
      timer = document.createElement("span");
      timer.id = "corePhaseTimer";
      timer.className = "core-phase-timer";
      phaseLabel.insertAdjacentElement("afterend", timer);
    }
    updateTimer();
    if (!timerInterval) timerInterval = setInterval(updateTimer, 500);
  }

  function updateTimer() {
    const timer = document.querySelector("#corePhaseTimer");
    if (!timer || !latestState) return;
    const deadline = Number(latestState.phaseDeadlineAt || 0);
    if (!deadline || !["night", "debate", "vote"].includes(latestState.phase)) {
      timer.textContent = `${t("timer")}：${t("noLimit")}`;
      timer.classList.remove("urgent");
      return;
    }
    const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const min = Math.floor(seconds / 60);
    const sec = String(seconds % 60).padStart(2, "0");
    timer.textContent = `${t("timer")}：${min}:${sec}`;
    timer.classList.toggle("urgent", seconds <= 20);
  }

  function ensureOwnRoleCard() {
    const area = document.querySelector("#actionArea");
    if (!area || !latestState?.me?.role) return;
    area.querySelector("#coreOwnRoleCard")?.remove();
    const card = document.createElement("div");
    card.id = "coreOwnRoleCard";
    card.className = "core-rule-box core-own-role";
    card.dataset.noTranslate = "";
    const skill = latestState.me.roleSkill;
    const skillLine = skill ? `${t("skillTiming")}：${skill.timing}${skill.oncePerGame ? " · once" : ""}` : t("noActiveSkill");
    const fool = latestState.settings?.foolEnabled ? `<span class="core-fool-chip">${latestState.me.isFool ? t("foolYou") : t("normalYou")}</span>` : "";
    card.innerHTML = `<strong>${escapeHtml(t("ownRole"))}｜${escapeHtml(latestState.me.role)}</strong><p>${escapeHtml(latestState.me.roleSummary || "")}</p><p>${escapeHtml(skillLine)}</p>${fool}`;
    area.prepend(card);
  }

  function ensureLoverGroupUi() {
    document.querySelectorAll("[data-core-lover]").forEach((node) => node.remove());
    if (!latestState?.me || !Array.isArray(latestState.players)) return;
    const group = Array.isArray(latestState.me.loverGroupIds) ? latestState.me.loverGroupIds : [];
    const cupid = Array.isArray(latestState.me.cupidLinkedIds) ? latestState.me.cupidLinkedIds : [];
    if (group.length <= 2 && cupid.length <= 2) return;
    const rows = [...document.querySelectorAll("#players > .player-row")];
    const byId = new Map(latestState.players.map((p) => [p.id, p]));
    const byName = new Map(rows.map((row) => [String(row.querySelector(".player-name strong")?.textContent || "").trim(), row]));
    const mark = (ids, label) => {
      ids.forEach((id) => {
        if (id === latestState.me.id) return;
        const p = byId.get(id); const row = p ? byName.get(p.name) : null; const box = row?.querySelector(".player-name");
        if (!box) return;
        const badge = document.createElement("span"); badge.dataset.coreLover = "1"; badge.className = "core-lover-chip"; badge.textContent = label; box.append(badge);
      });
    };
    if (group.length > 2) mark(group, t("loverGroup"));
    if (cupid.length > 2) mark(cupid, t("pairedByCupid"));
  }

  function ensureCupidAction() {
    if (!latestState?.roleAction || latestState.roleAction.effect !== "link_lovers" || latestState.roleActionSubmitted) return;
    const button = document.querySelector("#roleActionButton");
    const old = button?.closest(".role-skill");
    if (!old || old.dataset.coreCupid === "1") return;
    const expected = Number(latestState.settings?.loverGroupSize || 2);
    const eligible = (latestState.players || []).filter((p) => p.alive && !p.isSpectator);
    old.dataset.coreCupid = "1";
    old.innerHTML = `<div><span class="skill-label">${escapeHtml(t("cupidTitle"))}</span><strong>${escapeHtml(t("cupidTitle"))} · ${expected}</strong><p>${escapeHtml(t("cupidHelp"))}</p></div><div class="core-cupid-grid">${eligible.map((p) => `<label><input type="checkbox" data-core-cupid-target="${escapeAttr(p.id)}" /><span data-no-translate>${escapeHtml(p.name)}</span></label>`).join("")}</div><button id="coreCupidSubmit" class="button button-secondary" type="button">${escapeHtml(t("submitCupid"))}</button>`;
    old.querySelector("#coreCupidSubmit")?.addEventListener("click", () => {
      const ids = [...old.querySelectorAll("[data-core-cupid-target]:checked")].map((input) => input.dataset.coreCupidTarget);
      if (ids.length !== expected) return showToast(`${t("cupidHelp")} (${ids.length}/${expected})`, true);
      if (!send({ type: "role_action", effect: "link_lovers", targetIds: ids })) showToast("WebSocket 尚未連線", true);
    });
  }

  function ensureSuicideBombAction() {
    if (!latestState?.roleAction || latestState.roleAction.effect !== "suicide_bomb" || latestState.roleActionSubmitted) return;
    const button = document.querySelector("#roleActionButton");
    const old = button?.closest(".role-skill");
    if (!old || old.dataset.coreSuicide === "1") return;
    const eligible = (latestState.players || []).filter((p) => p.alive && !p.isSpectator && p.id !== latestState.me?.id);
    old.dataset.coreSuicide = "1";
    old.innerHTML = `<div><span class="skill-label">${escapeHtml(t("suicideTitle"))}</span><strong>${escapeHtml(t("suicideTitle"))}</strong><p>${escapeHtml(t("suicideHelp"))}</p></div><div class="core-suicide-grid">${eligible.map((p) => `<label><input type="checkbox" data-core-suicide-target="${escapeAttr(p.id)}" /><span data-no-translate>${escapeHtml(p.name)}</span></label>`).join("")}</div><button id="coreSuicideSubmit" class="button button-secondary" type="button">${escapeHtml(t("submitSuicide"))}</button>`;
    old.querySelector("#coreSuicideSubmit")?.addEventListener("click", () => {
      const ids = [...old.querySelectorAll("[data-core-suicide-target]:checked")].map((input) => input.dataset.coreSuicideTarget);
      if (ids.length > 2) return showToast(t("suicideHelp"), true);
      if (!send({ type: "role_action", effect: "suicide_bomb", targetIds: ids })) showToast("WebSocket 尚未連線", true);
    });
  }

  function ensureAbstain() {
    document.querySelector("#coreAbstainVote")?.remove();
    if (latestState?.phase !== "vote" || (latestState.votesCast || []).includes(latestState.me?.id)) return;
    const vote = document.querySelector("#voteButton");
    if (!vote) return;
    const button = document.createElement("button");
    button.id = "coreAbstainVote";
    button.type = "button";
    button.className = "button button-ghost";
    button.textContent = t("abstain");
    button.addEventListener("click", () => send({ type: "vote", targetId: "__abstain__" }));
    vote.insertAdjacentElement("afterend", button);
  }

  function ensureVoteSummary() {
    document.querySelector("#coreVoteSummary")?.remove();
    const summary = latestState?.lastVoteSummary;
    const messages = document.querySelector("#messages");
    if (!summary || !messages || !Array.isArray(summary.entries)) return;
    const byId = new Map((latestState.players || []).map((p) => [p.id, p.name]));
    const counts = Object.entries(summary.counts || {}).sort((a, b) => b[1] - a[1]).map(([id, n]) => `${byId.get(id) || id} ${n}`).join("、") || "0";
    const abstain = summary.entries.filter((e) => e.status === "abstain");
    const invalid = summary.entries.filter((e) => e.status === "invalid");
    const box = document.createElement("div");
    box.id = "coreVoteSummary";
    box.className = "core-vote-summary";
    box.dataset.noTranslate = "";
    box.innerHTML = `<strong>${escapeHtml(t("voteSummary"))}</strong><div>票數：${escapeHtml(counts)}</div><div>${escapeHtml(t("abstentions"))}：${abstain.length}${abstain.length ? `（${escapeHtml(abstain.map((e) => byId.get(e.voterId) || e.voterId).join("、"))}）` : ""}</div><div>${escapeHtml(t("invalidVotes"))}：${invalid.length}${invalid.length ? `（${escapeHtml(invalid.map((e) => `${byId.get(e.voterId) || e.voterId}${e.reason ? `：${e.reason}` : ""}`).join("；"))}）` : ""}</div>`;
    messages.before(box);
  }

  function ensureHunterLastWords() {
    document.querySelector("#coreHunterLastWords")?.remove();
    if (!latestState?.me?.canHunterLastWords) return;
    const area = document.querySelector("#actionArea");
    if (!area) return;
    const box = document.createElement("div");
    box.id = "coreHunterLastWords";
    box.className = "core-rule-box core-last-words";
    box.dataset.noTranslate = "";
    box.innerHTML = `<strong>${escapeHtml(t("hunterLastWords"))}</strong><textarea id="coreHunterLastWordsText" rows="3" maxlength="500" placeholder="${escapeAttr(t("hunterPlaceholder"))}"></textarea><button id="coreHunterLastWordsSend" class="button button-ghost" type="button">${escapeHtml(t("sendLastWords"))}</button>`;
    box.querySelector("#coreHunterLastWordsSend")?.addEventListener("click", () => {
      const text = String(box.querySelector("#coreHunterLastWordsText")?.value || "").trim();
      if (!text) return;
      send({ type: "chat", content: text });
    });
    area.append(box);
  }

  function scheduleApply() {
    if (applying) return;
    applying = true;
    setTimeout(() => {
      applying = false;
      apply();
      setTimeout(apply, 80);
    }, 0);
  }

  function apply() {
    if (!latestState) return;
    injectStyle();
    syncSettings();
    removeDisabledRoles();
    ensureTimer();
    ensureOwnRoleCard();
    ensureLoverGroupUi();
    ensureCupidAction();
    ensureSuicideBombAction();
    ensureAbstain();
    ensureVoteSummary();
    ensureHunterLastWords();
  }

  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }
  function escapeAttr(value) { return escapeHtml(value); }

  const observer = new MutationObserver(() => scheduleApply());
  observer.observe(document.body, { childList: true, subtree: true });
  document.querySelector("#languageSelect")?.addEventListener("change", () => setTimeout(scheduleApply, 0));
  connect();
  setInterval(connect, 1500);
})();
