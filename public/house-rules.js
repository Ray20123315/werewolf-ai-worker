(() => {
  const roomId = location.pathname.toUpperCase().match(/^\/([A-Z2-9]{6})\/?$/)?.[1] || "";
  if (!roomId) return;

  const LABELS = {
    "zh-TW": {
      winLabel: "狼人勝利條件",
      edge: "屠邊：民邊或神邊任一邊全滅",
      all: "屠城：所有非狼人對手全滅",
      winHelp: "屠邊較快：初始存在的村民邊或神職邊任一邊被清空，狼人即勝。屠城較嚴格：所有非狼人對手都必須出局。",
      sheriffSecond: "警長第 2 張放逐票",
      aiRunning: "AI 正在自動執行",
      wolfLeader: "本夜狼刀主控"
    },
    "zh-CN": {
      winLabel: "狼人胜利条件",
      edge: "屠边：民边或神边任一边全灭",
      all: "屠城：所有非狼人对手全灭",
      winHelp: "屠边较快：初始存在的村民边或神职边任一边被清空，狼人即胜。屠城较严格：所有非狼人对手都必须出局。",
      sheriffSecond: "警长第 2 张放逐票",
      aiRunning: "AI 正在自动执行",
      wolfLeader: "本夜狼刀主控"
    },
    en: {
      winLabel: "Werewolf win condition",
      edge: "Edge elimination: wipe civilians or gods",
      all: "Full elimination: wipe every non-werewolf opponent",
      winHelp: "Edge elimination is faster: wolves win when an initially present civilian or god edge is wiped out. Full elimination requires every non-werewolf opponent to be eliminated.",
      sheriffSecond: "Sheriff ballot 2",
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

  function applyDeepSeekDefault() {
    const provider = document.querySelector("#aiProvider");
    const model = document.querySelector("#aiModel");
    if (!provider || !model || provider.dataset.houseDefaultApplied === "1") return;
    provider.dataset.houseDefaultApplied = "1";
    provider.value = "deepseek";
    model.value = "deepseek-v4-flash";
    document.querySelector("#aiBaseUrlRow")?.classList.add("hidden");
  }

  function ensureWinConditionControl() {
    const form = document.querySelector("#settingsForm");
    if (!form) return;
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
    document.querySelector("#winConditionLabel").textContent = text("winLabel");
    select.options[0].textContent = text("edge");
    select.options[1].textContent = text("all");
    document.querySelector("#winConditionHelp").textContent = text("winHelp");
    if (latestState?.settings?.winCondition) select.value = latestState.settings.winCondition;
    select.disabled = latestState ? latestState.phase !== "lobby" || !latestState.me?.isHost : false;
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
        syncSheriffVoteUi();
        syncWolfLeaderHint();
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

  function isMeSheriff() {
    if (!latestState?.me?.id) return false;
    return latestState.players?.some((player) => player.id === latestState.me.id && player.isSheriff);
  }

  function syncSheriffVoteUi() {
    const first = document.querySelector("#voteTarget");
    const button = document.querySelector("#voteButton");
    if (!first || !button || latestState?.phase !== "vote" || !isMeSheriff() || (latestState.votesCast || []).includes(latestState.me.id)) return;
    let second = document.querySelector("#sheriffVoteTarget2");
    if (!second) {
      const label = document.createElement("label");
      label.id = "sheriffVoteTarget2Label";
      label.dataset.noTranslate = "";
      const span = document.createElement("span");
      span.textContent = text("sheriffSecond");
      second = document.createElement("select");
      second.id = "sheriffVoteTarget2";
      second.innerHTML = first.innerHTML;
      label.append(span, second);
      button.parentElement?.insertBefore(label, button);
    } else {
      second.previousElementSibling && (second.previousElementSibling.textContent = text("sheriffSecond"));
    }
  }

  function syncWolfLeaderHint() {
    const old = document.querySelector("#wolfLeaderHint");
    old?.remove();
    if (latestState?.phase !== "night" || !latestState.me?.wolfLeaderId) return;
    const leader = latestState.players?.find((p) => p.id === latestState.me.wolfLeaderId);
    if (!leader) return;
    const area = document.querySelector("#actionArea");
    if (!area) return;
    const hint = document.createElement("div");
    hint.id = "wolfLeaderHint";
    hint.className = "intel-card";
    hint.dataset.noTranslate = "";
    hint.innerHTML = `<strong>${text("wolfLeader")}</strong><p data-no-translate>${escapeHtml(leader.name)}</p>`;
    area.prepend(hint);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("#voteButton");
    if (!button || latestState?.phase !== "vote" || !isMeSheriff()) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const first = document.querySelector("#voteTarget")?.value;
    const second = document.querySelector("#sheriffVoteTarget2")?.value || first;
    if (!first || !second) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    sendCommand({ type: "vote", targetId: `${first}|${second}` });
  }, true);

  document.querySelector("#settingsForm")?.addEventListener("submit", () => {
    const select = document.querySelector("#winConditionSelect");
    if (select && latestState?.phase === "lobby" && latestState.me?.isHost) {
      sendCommand({ type: "configure_settings", settings: { winCondition: select.value } });
    }
  }, true);

  document.querySelector("#languageSelect")?.addEventListener("change", () => setTimeout(() => {
    ensureWinConditionControl();
    syncSheriffVoteUi();
    syncWolfLeaderHint();
  }, 0));

  const actionArea = document.querySelector("#actionArea");
  if (actionArea) new MutationObserver(() => {
    syncSheriffVoteUi();
    syncWolfLeaderHint();
  }).observe(actionArea, { childList: true, subtree: true });

  applyDeepSeekDefault();
  ensureWinConditionControl();
  connect();
})();
