(() => {
  const roomId = location.pathname.toUpperCase().match(/^\/([A-Z2-9]{6})\/?$/)?.[1] || "";
  if (!roomId) return;

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
      wolfLeader: "本夜狼刀主控"
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
      wolfLeader: "本夜狼刀主控"
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
      wolfLeader: "Wolf kill leader tonight"
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

  document.querySelector("#settingsForm")?.addEventListener("submit", () => {
    const select = document.querySelector("#winConditionSelect");
    if (select && latestState?.phase === "lobby" && latestState.me?.isHost) {
      sendCommand({ type: "configure_settings", settings: { winCondition: select.value } });
    }
  }, true);

  document.querySelector("#languageSelect")?.addEventListener("change", () => setTimeout(() => {
    ensureWinConditionControl();
    syncWolfLeaderHint();
  }, 0));

  const actionArea = document.querySelector("#actionArea");
  if (actionArea) new MutationObserver(() => {
    removeLegacySheriffSecondVoteUi();
    syncWolfLeaderHint();
  }).observe(actionArea, { childList: true, subtree: true });

  const pendingAIBox = document.querySelector("#pendingAIBox");
  if (pendingAIBox) new MutationObserver(() => {
    suppressManualAIApproval();
  }).observe(pendingAIBox, { childList: true, subtree: true });

  applyDeepSeekDefault();
  ensureWinConditionControl();
  suppressManualAIApproval();
  removeLegacySheriffSecondVoteUi();
  connect();
})();
