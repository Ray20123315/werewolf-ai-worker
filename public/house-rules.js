(() => {
  const roomId = location.pathname.toUpperCase().match(/^\/([A-Z2-9]{6})\/?$/)?.[1] || "";
  if (!roomId) return;

  const ADDON_SETUP_IDS = new Set(["masochist_cultist", "sadist_leader"]);
  const LABELS = {
    "zh-TW": {
      winLabel: "狼人勝利條件",
      edge: "屠邊：民邊或神邊任一邊全滅",
      all: "屠城：所有非狼人對手全滅",
      winHelp: "屠邊較快：初始存在的村民邊或神職邊任一邊被清空，狼人即勝。屠城較嚴格：所有非狼人對手都必須出局。",
      sheriffHelp: "警長選舉保留；一般放逐投票與其他玩家相同，都是 1 票。",
      tieLabel: "放逐平票",
      tieFixed: "最高票並列時隨機抽 1 人",
      tieHelp: "所有存活、未被踢出的正式玩家一人一票；全部投完立即結算。",
      aiRunning: "AI 正在自動執行",
      wolfLeader: "本夜狼刀主控",
      addonGroup: "附加身份",
      addonCount: "附加",
      baseCount: "本體",
      lover: "情侶",
      masochist: "抖M",
      sadist: "抖S",
      masochistSummary: "附加身份：保留本體角色與陣營；一般放逐仍是一人一票。自己被一般放逐處決時立即達成個人特殊勝利。",
      sadistSummary: "附加身份：保留本體角色與陣營；每晚查一名尚未查過的玩家是否為抖M，查中後該抖M成為死亡肉盾；放逐與情侶殉情不轉移。",
      sadistAction: "抖S查驗",
      sadistActionHelp: "這是附加身份操作，不會取代你的本體夜間技能。",
      sadistTarget: "查驗目標",
      sadistSubmit: "提交抖S查驗"
    },
    "zh-CN": {
      winLabel: "狼人胜利条件",
      edge: "屠边：民边或神边任一边全灭",
      all: "屠城：所有非狼人对手全灭",
      winHelp: "屠边较快：初始存在的村民边或神职边任一边被清空，狼人即胜。屠城较严格：所有非狼人对手都必须出局。",
      sheriffHelp: "警长选举保留；普通放逐投票与其他玩家相同，都是 1 票。",
      tieLabel: "放逐平票",
      tieFixed: "最高票并列时随机抽 1 人",
      tieHelp: "所有存活、未被踢出的正式玩家一人一票；全部投完立即结算。",
      aiRunning: "AI 正在自动执行",
      wolfLeader: "本夜狼刀主控",
      addonGroup: "附加身份",
      addonCount: "附加",
      baseCount: "本体",
      lover: "情侣",
      masochist: "抖M",
      sadist: "抖S",
      masochistSummary: "附加身份：保留本体角色与阵营；普通放逐仍是一人一票。自己被普通放逐处决时立即达成个人特殊胜利。",
      sadistSummary: "附加身份：保留本体角色与阵营；每晚查一名尚未查过的玩家是否为抖M，查中后该抖M成为死亡肉盾；放逐与情侣殉情不转移。",
      sadistAction: "抖S查验",
      sadistActionHelp: "这是附加身份操作，不会取代你的本体夜间技能。",
      sadistTarget: "查验目标",
      sadistSubmit: "提交抖S查验"
    },
    en: {
      winLabel: "Werewolf win condition",
      edge: "Edge elimination: wipe civilians or gods",
      all: "Full elimination: wipe every non-werewolf opponent",
      winHelp: "Edge elimination is faster: wolves win when an initially present civilian or god edge is wiped out. Full elimination requires every non-werewolf opponent to be eliminated.",
      sheriffHelp: "Sheriff election stays enabled, but the sheriff has the same single exile vote as every other player.",
      tieLabel: "Exile tie",
      tieFixed: "Randomly eliminate 1 tied top player",
      tieHelp: "Each living, non-kicked active player has exactly one equal vote; settlement starts as soon as everyone has voted.",
      aiRunning: "AI action running automatically",
      wolfLeader: "Wolf kill leader tonight",
      addonGroup: "Addon identities",
      addonCount: "Addons",
      baseCount: "Base",
      lover: "Lover",
      masochist: "M",
      sadist: "S",
      masochistSummary: "Addon identity: keep the base role and faction. The ordinary exile ballot is still one equal vote. Being normally exiled triggers this addon's personal win.",
      sadistSummary: "Addon identity: keep the base role and faction. Probe one unprobed player each night for M; once found, that M becomes a death substitute, except for exile and lover-suicide deaths.",
      sadistAction: "S probe",
      sadistActionHelp: "This addon action is separate from your base role's night action.",
      sadistTarget: "Probe target",
      sadistSubmit: "Submit S probe"
    }
  };

  let latestState = null;
  let socket = null;
  let reconnectTimer = 0;
  let aiTimer = 0;
  let aiInFlight = false;
  let lastFailedSignature = "";
  let lastFailedAt = 0;

  const locale = () => {
    const value = localStorage.getItem("werewolf-locale");
    return value === "zh-CN" || value === "en" ? value : "zh-TW";
  };
  const text = (key) => LABELS[locale()]?.[key] || LABELS["zh-TW"][key] || key;
  const addonName = (id) => id === "lover" ? text("lover") : id === "masochist_cultist" ? text("masochist") : id === "sadist_leader" ? text("sadist") : id;

  function roomSession() {
    try {
      return JSON.parse(localStorage.getItem(`werewolf-session:${roomId}`) || "null");
    } catch {
      return null;
    }
  }

  function aiKeyStorageKey() {
    return `werewolf-ai-keys:${roomId}`;
  }

  function readAIKeys() {
    try {
      const raw = JSON.parse(sessionStorage.getItem(aiKeyStorageKey()) || "{}");
      return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    } catch {
      return {};
    }
  }

  function showToast(message, error = false) {
    const toast = document.querySelector("#toast");
    if (!toast) return;
    toast.textContent = String(message);
    toast.classList.remove("hidden");
    toast.classList.toggle("error", error);
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.add("hidden"), 4200);
  }

  function suppressManualAIApproval() {
    const box = document.querySelector("#pendingAIBox");
    if (!box) return;
    const button = box.querySelector("#runAIButton");
    if (button) button.remove();
  }

  function removeLegacySheriffSecondVoteUi() {
    document.querySelector("#sheriffVoteTarget2Label")?.remove();
    document.querySelector("#sheriffVoteTarget2")?.remove();
  }

  function applyDeepSeekDefault() {
    const provider = document.querySelector("#aiProvider");
    const model = document.querySelector("#aiModel");
    if (!provider || !model || provider.dataset.houseDefaultApplied === "1") return;
    provider.dataset.houseDefaultApplied = "1";
    provider.value = "deepseek";
    model.value = "deepseek-v4-flash";
    document.querySelector("#aiBaseUrlRow")?.classList.add("hidden");
  }

  function ensureEqualVoteCopy() {
    const label = document.querySelector("#tieRuleLabel");
    const select = document.querySelector("#tieRuleSelect");
    const help = document.querySelector("#equalVoteHelp");
    if (label && label.textContent !== text("tieLabel")) label.textContent = text("tieLabel");
    if (select?.options?.[0] && select.options[0].textContent !== text("tieFixed")) select.options[0].textContent = text("tieFixed");
    if (select) {
      if (select.value !== "random_elimination") select.value = "random_elimination";
      if (!select.disabled) select.disabled = true;
    }
    if (help && help.textContent !== text("tieHelp")) help.textContent = text("tieHelp");
    removeLegacySheriffSecondVoteUi();
  }

  function ensureWinConditionControl() {
    const form = document.querySelector("#settingsForm");
    if (!form) return;
    const sheriffToggle = form.querySelector('input[name="sheriffEnabled"]');
    const sheriffHelp = document.querySelector("#sheriffVoteHelp") || sheriffToggle?.closest("label")?.nextElementSibling;
    if (sheriffHelp?.classList.contains("field-help") && sheriffHelp.textContent !== text("sheriffHelp")) {
      sheriffHelp.textContent = text("sheriffHelp");
      sheriffHelp.setAttribute("data-no-translate", "");
    }
    let row = document.querySelector("#winConditionRow");
    if (!row) {
      row = document.createElement("label");
      row.id = "winConditionRow";
      row.dataset.noTranslate = "";
      const label = document.createElement("span");
      label.id = "winConditionLabel";
      const select = document.createElement("select");
      select.id = "winConditionSelect";
      select.name = "winCondition";
      select.innerHTML = '<option value="slaughter_edge"></option><option value="slaughter_all"></option>';
      const help = document.createElement("small");
      help.id = "winConditionHelp";
      help.className = "field-help";
      row.append(label, select, help);
      form.insertBefore(row, form.querySelector('button[type="submit"]'));
      select.addEventListener("change", () => {
        if (latestState?.phase !== "lobby" || !latestState?.me?.isHost) return;
        sendCommand({ type: "configure_settings", settings: { winCondition: select.value } });
      });
    }
    const select = document.querySelector("#winConditionSelect");
    const label = document.querySelector("#winConditionLabel");
    const help = document.querySelector("#winConditionHelp");
    if (label && label.textContent !== text("winLabel")) label.textContent = text("winLabel");
    if (select?.options?.[0] && select.options[0].textContent !== text("edge")) select.options[0].textContent = text("edge");
    if (select?.options?.[1] && select.options[1].textContent !== text("all")) select.options[1].textContent = text("all");
    if (help && help.textContent !== text("winHelp")) help.textContent = text("winHelp");
    if (select && latestState?.settings?.winCondition && select.value !== latestState.settings.winCondition) select.value = latestState.settings.winCondition;
    if (select) {
      const disabled = latestState ? latestState.phase !== "lobby" || !latestState.me?.isHost : false;
      if (select.disabled !== disabled) select.disabled = disabled;
    }
    ensureEqualVoteCopy();
  }

  function sendCommand(command) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(command));
    return true;
  }

  function connect() {
    const session = roomSession();
    if (!session?.token) return;
    clearTimeout(reconnectTimer);
    socket?.close(1000, "house-rules reconnect");
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/api/rooms/${roomId}/ws?token=${encodeURIComponent(session.token)}`);
    socket = ws;
    ws.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type !== "state" || !payload.state) return;
        latestState = payload.state;
        ensureWinConditionControl();
        syncWolfLeaderHint();
        suppressManualAIApproval();
        scheduleAddonDomSync();
        scheduleAI();
      } catch {}
    });
    ws.addEventListener("close", (event) => {
      if (socket === ws) socket = null;
      if (event.code !== 1000 && roomSession()?.token) reconnectTimer = setTimeout(connect, 1500);
    });
  }

  function pendingSignature(pending) {
    if (!pending || !latestState) return "";
    return [pending.playerId, pending.operation, latestState.round, latestState.phase, latestState.debateIndex, (latestState.votesCast || []).length, (latestState.nightSubmitted || []).length].join(":");
  }

  function scheduleAI() {
    clearTimeout(aiTimer);
    if (!latestState?.me?.isHost || !latestState.pendingAI || aiInFlight) return;
    const keys = readAIKeys()[latestState.pendingAI.playerId] || [];
    if (!keys.length) return;
    const signature = pendingSignature(latestState.pendingAI);
    if (signature === lastFailedSignature && Date.now() - lastFailedAt < 8000) return;
    aiTimer = setTimeout(() => runPendingAI(signature, keys), 650);
  }

  async function runPendingAI(signature, keys) {
    if (aiInFlight || signature !== pendingSignature(latestState?.pendingAI)) return;
    const session = roomSession();
    const pending = latestState?.pendingAI;
    if (!session?.token || !pending) return;
    aiInFlight = true;
    const box = document.querySelector("#pendingAIBox");
    if (box) box.dataset.autoRunning = "1";
    try {
      const response = await fetch(`/api/rooms/${roomId}/ai/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: session.token, playerId: pending.playerId, apiKeys: keys })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      lastFailedSignature = "";
    } catch (error) {
      lastFailedSignature = signature;
      lastFailedAt = Date.now();
      showToast(error instanceof Error ? error.message : String(error), true);
    } finally {
      aiInFlight = false;
      if (box) delete box.dataset.autoRunning;
    }
  }

  function syncWolfLeaderHint() {
    let hint = document.querySelector("#wolfLeaderHint");
    const leaderId = latestState?.phase === "night" ? latestState.me?.wolfLeaderId : undefined;
    const leader = leaderId ? latestState.players?.find((p) => p.id === leaderId) : undefined;
    if (!leader) {
      hint?.remove();
      return;
    }
    const area = document.querySelector("#actionArea");
    if (!area) return;
    if (!hint) {
      hint = document.createElement("div");
      hint.id = "wolfLeaderHint";
      hint.className = "intel-card";
      hint.dataset.noTranslate = "";
      const title = document.createElement("strong");
      title.dataset.wolfLeaderTitle = "1";
      const name = document.createElement("p");
      name.dataset.noTranslate = "";
      name.dataset.wolfLeaderName = "1";
      hint.append(title, name);
      area.prepend(hint);
    }
    const title = hint.querySelector("[data-wolf-leader-title]");
    const name = hint.querySelector("[data-wolf-leader-name]");
    if (title && title.textContent !== text("wolfLeader")) title.textContent = text("wolfLeader");
    if (name && name.textContent !== leader.name) name.textContent = leader.name;
  }

  function scheduleAddonDomSync() {
    const run = () => {
      syncOwnAddonLabel();
      syncPublicAddonPills();
      syncAddonRoleCatalog();
      syncAddonSetupTotal();
      syncAddonAction();
    };
    queueMicrotask(run);
    setTimeout(run, 0);
    setTimeout(run, 60);
  }

  function syncOwnAddonLabel() {
    const label = document.querySelector("#roleLabel");
    if (!label || !latestState?.me) return;
    const addons = Array.isArray(latestState.me.addonRoles) ? latestState.me.addonRoles.map(addonName) : [];
    const current = String(label.textContent || "");
    if (!current.includes(" + ")) label.dataset.addonBaseLabel = current;
    const base = label.dataset.addonBaseLabel || current.split(" + ")[0] || "—";
    const desired = addons.length ? `${base} + ${addons.join(" + ")}` : base;
    if (label.textContent !== desired) label.textContent = desired;
  }

  function syncPublicAddonPills() {
    if (!latestState?.players) return;
    const rows = [...document.querySelectorAll("#players .player-row")];
    for (let index = 0; index < rows.length; index += 1) {
      const player = latestState.players[index];
      const nameBox = rows[index]?.querySelector(".player-name");
      if (!player || !nameBox) continue;
      const visible = new Set(Array.isArray(player.addonRoles) ? player.addonRoles : []);
      if (player.id === latestState.me?.id && Array.isArray(latestState.me.addonRoles)) {
        for (const addon of latestState.me.addonRoles) visible.add(addon);
      }
      const wanted = [...visible].map(addonName);
      const existing = [...nameBox.querySelectorAll("[data-addon-pill]")];
      const existingText = existing.map((node) => node.textContent || "");
      if (existingText.length === wanted.length && existingText.every((value, i) => value === wanted[i])) continue;
      for (const node of existing) node.remove();
      for (const value of wanted) {
        const pill = document.createElement("span");
        pill.className = "pill addon";
        pill.dataset.addonPill = "1";
        pill.dataset.noTranslate = "";
        pill.textContent = value;
        nameBox.append(pill);
      }
    }
  }

  function syncAddonRoleCatalog() {
    const box = document.querySelector("#roleCatalog");
    if (!box) return;
    const cards = [...box.querySelectorAll("[data-role-card]")].filter((card) => ADDON_SETUP_IDS.has(card.dataset.roleCard));
    if (!cards.length) return;
    let group = box.querySelector("[data-addon-role-group]");
    if (!group) {
      group = document.createElement("section");
      group.className = "role-group";
      group.dataset.addonRoleGroup = "1";
      group.dataset.noTranslate = "";
      const head = document.createElement("div");
      head.className = "role-group-head";
      const strong = document.createElement("strong");
      strong.dataset.addonGroupTitle = "1";
      const count = document.createElement("span");
      count.dataset.addonGroupCount = "1";
      head.append(strong, count);
      group.append(head);
      box.append(group);
    }
    const title = group.querySelector("[data-addon-group-title]");
    const count = group.querySelector("[data-addon-group-count]");
    if (title && title.textContent !== text("addonGroup")) title.textContent = text("addonGroup");
    if (count && count.textContent !== `${cards.length}`) count.textContent = `${cards.length}`;
    for (const card of cards) {
      if (card.parentElement !== group) group.append(card);
      card.dataset.noTranslate = "";
      const source = card.querySelector(".role-title span");
      if (source && source.textContent !== text("addonGroup")) source.textContent = text("addonGroup");
      const summary = card.querySelector(".role-copy > p");
      const desired = card.dataset.roleCard === "masochist_cultist" ? text("masochistSummary") : text("sadistSummary");
      if (summary && summary.textContent !== desired) summary.textContent = desired;
    }
  }

  function syncAddonSetupTotal() {
    const totalBox = document.querySelector("#roleSetupTotal");
    if (!totalBox || !latestState) return;
    const inputs = [...document.querySelectorAll("[data-role-count]")];
    if (!inputs.length) return;
    let baseTotal = 0;
    let addonTotal = 0;
    for (const input of inputs) {
      const value = Math.max(0, Number.parseInt(input.value || "0", 10) || 0);
      if (ADDON_SETUP_IDS.has(input.dataset.roleCount)) addonTotal += value;
      else baseTotal += value;
    }
    const formal = (latestState.players || []).filter((player) => !player.isSpectator).length;
    const desired = `${text("baseCount")} ${baseTotal} / ${formal} · ${text("addonCount")} ${addonTotal}`;
    if (totalBox.textContent !== desired) totalBox.textContent = desired;
    totalBox.classList.toggle("bad", baseTotal < formal);
  }

  function syncAddonAction() {
    const area = document.querySelector("#actionArea");
    if (!area) return;
    const action = Array.isArray(latestState?.addonActions)
      ? latestState.addonActions.find((item) => item?.addon === "sadist_leader" && item?.effect === "probe_masochist")
      : undefined;
    let block = document.querySelector("#sadistAddonAction");
    if (!action || latestState?.phase !== "night" || latestState?.me?.isAI || !latestState?.me?.alive) {
      block?.remove();
      return;
    }
    const candidates = Array.isArray(action.candidateIds) ? action.candidateIds : [];
    const signature = candidates.join("|");
    if (block?.dataset.signature === signature && block.dataset.locale === locale()) return;
    block?.remove();
    block = document.createElement("div");
    block.id = "sadistAddonAction";
    block.className = "skill-box role-skill";
    block.dataset.signature = signature;
    block.dataset.locale = locale();
    block.dataset.noTranslate = "";
    const options = candidates.map((id) => {
      const player = latestState.players?.find((item) => item.id === id);
      return `<option value="${escapeAttr(id)}">${escapeHtml(player?.name || id)}</option>`;
    }).join("");
    block.innerHTML = `<div><span class="skill-label">${escapeHtml(text("addonGroup"))}</span><strong>${escapeHtml(text("sadistAction"))}</strong><p>${escapeHtml(text("sadistActionHelp"))}</p></div><div class="role-action-fields"><label>${escapeHtml(text("sadistTarget"))}<select id="sadistAddonTarget">${options}</select></label><button id="sadistAddonSubmit" class="button button-secondary" type="button">${escapeHtml(text("sadistSubmit"))}</button></div>`;
    area.append(block);
    block.querySelector("#sadistAddonSubmit")?.addEventListener("click", () => {
      const targetId = block.querySelector("#sadistAddonTarget")?.value;
      if (!targetId) return;
      sendCommand({ type: "addon_action", addon: "sadist_leader", effect: "probe_masochist", targetId });
    });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[ch]);
  }
  function escapeAttr(value) { return escapeHtml(value); }

  document.querySelector("#settingsForm")?.addEventListener("submit", () => {
    const select = document.querySelector("#winConditionSelect");
    if (select && latestState?.phase === "lobby" && latestState.me?.isHost) {
      sendCommand({ type: "configure_settings", settings: { winCondition: select.value } });
    }
  }, true);

  document.querySelector("#languageSelect")?.addEventListener("change", () => setTimeout(() => {
    ensureWinConditionControl();
    syncWolfLeaderHint();
    scheduleAddonDomSync();
  }, 0));

  document.querySelector("#roleCatalog")?.addEventListener("input", () => setTimeout(syncAddonSetupTotal, 0), true);

  const roleCatalog = document.querySelector("#roleCatalog");
  if (roleCatalog) new MutationObserver(() => {
    syncAddonRoleCatalog();
    syncAddonSetupTotal();
  }).observe(roleCatalog, { childList: true, subtree: true });

  const actionArea = document.querySelector("#actionArea");
  if (actionArea) new MutationObserver(() => {
    removeLegacySheriffSecondVoteUi();
    syncWolfLeaderHint();
    syncAddonAction();
  }).observe(actionArea, { childList: true, subtree: true });

  const playersBox = document.querySelector("#players");
  if (playersBox) new MutationObserver(() => syncPublicAddonPills()).observe(playersBox, { childList: true, subtree: true });

  const pendingAIBox = document.querySelector("#pendingAIBox");
  if (pendingAIBox) new MutationObserver(() => {
    suppressManualAIApproval();
  }).observe(pendingAIBox, { childList: true, subtree: true });

  applyDeepSeekDefault();
  ensureWinConditionControl();
  suppressManualAIApproval();
  removeLegacySheriffSecondVoteUi();
  scheduleAddonDomSync();
  connect();
})();
