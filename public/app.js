const $ = (selector) => document.querySelector(selector);
const landing = $("#landing");
const game = $("#game");
const leaveButton = $("#leaveButton");
const toast = $("#toast");
let session = readSession();
let state = null;
let ws = null;
let reconnectTimer = null;

const roleNames = { werewolf: "狼人", villager: "村民", seer: "預言家", witch: "女巫", guard: "守衛" };
const phaseNames = { lobby: "大廳", night: "夜晚", debate: "依序辯論", vote: "放逐投票", ended: "遊戲結束" };
const providerDefaults = { openai: "gpt-5.6-luna", gemini: "gemini-3.6-flash", deepseek: "deepseek-v4-flash", "openai-compatible": "" };

$("#createForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const data = await api("/api/rooms", { method: "POST", body: { name: form.get("name"), maxPlayers: Number(form.get("maxPlayers")) } });
    setSession(data.roomId, data.token, data.playerId);
    await enterRoom();
  } catch (error) { showError(error); }
});

$("#joinForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const roomId = String(form.get("roomId") || "").trim().toUpperCase();
  try {
    const data = await api(`/api/rooms/${roomId}/join`, { method: "POST", body: { name: form.get("name") } });
    setSession(roomId, data.token, data.playerId);
    await enterRoom();
  } catch (error) { showError(error); }
});

$("#addAIForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!session) return;
  const form = new FormData(event.currentTarget);
  try {
    await api(`/api/rooms/${session.roomId}/ai`, {
      method: "POST",
      body: { token: session.token, name: form.get("name"), provider: form.get("provider"), model: form.get("model") }
    });
    event.currentTarget.reset();
    $("#aiProvider").value = "openai";
    $("#aiModel").value = providerDefaults.openai;
    showToast("AI 玩家已加入");
  } catch (error) { showError(error); }
});

$("#aiProvider").addEventListener("change", (event) => {
  $("#aiModel").value = providerDefaults[event.target.value] ?? "";
});

$("#startButton").addEventListener("click", () => send({ type: "start" }));
$("#copyRoom").addEventListener("click", async () => {
  if (!session) return;
  await navigator.clipboard?.writeText(session.roomId);
  showToast("房間代碼已複製");
});

leaveButton.addEventListener("click", () => {
  clearTimeout(reconnectTimer);
  ws?.close();
  ws = null;
  localStorage.removeItem("werewolf-session");
  session = null;
  state = null;
  location.reload();
});

async function enterRoom() {
  if (!session) return;
  try {
    state = await api(`/api/rooms/${session.roomId}/state?token=${encodeURIComponent(session.token)}`);
    landing.classList.add("hidden");
    game.classList.remove("hidden");
    leaveButton.classList.remove("hidden");
    render();
    connectWebSocket();
  } catch (error) {
    localStorage.removeItem("werewolf-session");
    session = null;
    landing.classList.remove("hidden");
    game.classList.add("hidden");
    showError(error);
  }
}

function connectWebSocket() {
  if (!session) return;
  clearTimeout(reconnectTimer);
  ws?.close();
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}/api/rooms/${session.roomId}/ws?token=${encodeURIComponent(session.token)}`);
  ws.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === "state") { state = payload.state; render(); }
      if (payload.type === "error") showToast(payload.message, true);
      if (payload.type === "notice") showToast(payload.message);
    } catch { showToast("收到無法解析的伺服器訊息", true); }
  });
  ws.addEventListener("close", (event) => {
    if (session && event.code !== 1000) reconnectTimer = setTimeout(connectWebSocket, 1500);
  });
}

function render() {
  if (!state) return;
  $("#roomCode").textContent = state.roomId;
  $("#phaseBadge").textContent = phaseNames[state.phase] ?? state.phase;
  $("#roundLabel").textContent = state.phase === "lobby" ? `${state.players.length}/${state.maxPlayers} 人` : `第 ${state.round} 輪`;
  $("#roleLabel").textContent = state.me.role ? roleNames[state.me.role] : "尚未分配";
  renderPlayers();
  renderMessages();
  renderHostPanel();
  renderActionArea();
  renderNotice();
}

function renderPlayers() {
  const teammateIds = new Set(state.me.wolfTeammates || []);
  $("#players").innerHTML = state.players.map((p) => {
    const badges = [];
    if (p.isHost) badges.push('<span class="pill host">房主</span>');
    if (p.isAI) badges.push(`<span class="pill ai">AI ${escapeHtml(p.ai?.provider || "")}</span>`);
    if (!p.alive) badges.push('<span class="pill dead">出局</span>');
    if (teammateIds.has(p.id)) badges.push('<span class="pill host">狼人隊友</span>');
    if (state.phase === "debate" && state.currentSpeakerId === p.id) badges.push('<span class="pill speaker">發言中</span>');
    if (state.debateCompleted?.includes(p.id) && state.phase === "debate") badges.push('<span class="pill done">已發言</span>');
    const role = p.role ? `<span class="role-reveal">${roleNames[p.role] || p.role}</span>` : "";
    return `<div class="player ${p.alive ? "" : "dead"}"><div class="player-name"><strong>${escapeHtml(p.name)}</strong>${badges.join("")}</div>${role}</div>`;
  }).join("");
}

function renderMessages() {
  const box = $("#messages");
  box.innerHTML = state.messages.map((m) => `<article class="message ${m.kind === "system" ? "system" : "speech"}">
    <div class="message-head"><strong>${escapeHtml(m.playerName)}</strong><span>${formatTime(m.createdAt)}</span></div>
    <p>${escapeHtml(m.content)}</p>
  </article>`).join("");
  box.scrollTop = box.scrollHeight;
}

function renderHostPanel() {
  const panel = $("#hostPanel");
  const isLobbyHost = state.me.isHost && state.phase === "lobby";
  panel.classList.toggle("hidden", !isLobbyHost);
  $("#startButton").disabled = state.players.length < 5;
}

function renderActionArea() {
  const area = $("#actionArea");
  if (state.phase === "lobby") {
    area.innerHTML = '<div class="info-card"><strong>等待房主開始。</strong><br>至少 5 人。開始後固定採「夜晚 → 依序辯論 → 放逐投票」流程。</div>';
    return;
  }
  if (state.phase === "ended") {
    const label = state.winner === "werewolf" ? "狼人陣營" : "村民陣營";
    area.innerHTML = `<div class="info-card"><strong>${label}獲勝。</strong><br>所有玩家身份已在右側揭露。</div>`;
    return;
  }
  if (!state.me.alive) {
    area.innerHTML = '<div class="info-card"><strong>你已出局。</strong><br>可以觀戰公開辯論紀錄，但不能再發言、投票或執行夜晚技能。</div>';
    return;
  }
  if (state.phase === "debate") {
    renderDebateAction(area);
    return;
  }
  if (state.phase === "vote") {
    renderVoteAction(area);
    return;
  }
  renderNightAction(area);
}

function renderDebateAction(area) {
  const currentName = nameOf(state.currentSpeakerId);
  const progress = Math.min(state.debateIndex + 1, state.debateOrder.length);
  const order = state.debateOrder.map((id, index) => {
    const status = index < state.debateIndex ? "✓" : index === state.debateIndex ? "▶" : "·";
    return `${status} ${nameOf(id)}`;
  }).join(" → ");
  if (state.currentSpeakerId !== state.me.id) {
    const current = state.players.find((p) => p.id === state.currentSpeakerId);
    area.innerHTML = `<div class="info-card"><strong>辯論 ${progress}/${state.debateOrder.length}：等待 ${escapeHtml(currentName)} 發言。</strong><br>${current?.isAI ? "AI 正在依照公開紀錄整理推理。" : "非當前發言者不能插話或提前投票。"}</div><div class="speech-order">${escapeHtml(order)}</div>`;
    return;
  }
  area.innerHTML = `<div class="info-card"><strong>輪到你正式發言。</strong><br>請提出可被檢驗的理由、回應前面玩家，並給出目前站邊或懷疑方向。送出後即結束你的本輪發言。</div>
    <div class="speech-order">${escapeHtml(order)}</div>
    <label>正式辯論內容<textarea id="debateSpeech" maxlength="700" rows="5" placeholder="例如：我先回應 3 號剛才的邏輯……目前我比較懷疑……理由是……"></textarea></label>
    <button id="submitSpeech" class="primary" type="button">送出並結束本輪發言</button>`;
  $("#submitSpeech").addEventListener("click", () => {
    const content = $("#debateSpeech").value.trim();
    if (content.length < 2) return showToast("正式發言至少需要 2 個字元", true);
    send({ type: "debate_speech", content });
  });
}

function renderVoteAction(area) {
  if (state.votesCast.includes(state.me.id)) {
    area.innerHTML = '<div class="info-card"><strong>你已投票。</strong> 等待其他存活玩家完成投票。</div>';
    return;
  }
  const options = aliveTargets(false).map(optionHtml).join("");
  const aiRule = state.aiVotingUnlocked ? "AI 已可依辯論內容投票。" : "你若是第一位真人投票者，投出後才會解鎖 AI 投票，避免 AI 搶先帶票。";
  area.innerHTML = `<div class="info-card"><strong>辯論已完整結束，現在才可放逐。</strong><br>${escapeHtml(aiRule)}</div><div class="action-line"><label>放逐目標<select id="voteTarget">${options}</select></label><button id="voteButton" class="primary" type="button">確認投票</button></div>`;
  $("#voteButton").addEventListener("click", () => send({ type: "vote", targetId: $("#voteTarget").value }));
}

function renderNightAction(area) {
  const role = state.me.role;
  if (state.nightSubmitted.includes(state.me.id)) {
    area.innerHTML = '<div class="info-card"><strong>夜晚行動已提交。</strong> 等待其他角色完成。</div>';
    return;
  }
  if (role === "villager") {
    area.innerHTML = '<div class="info-card"><strong>村民沒有夜晚技能。</strong> 等待天亮後進入正式辯論。</div>';
    return;
  }
  if (role === "werewolf") {
    const teammates = new Set(state.me.wolfTeammates || []);
    const options = aliveTargets(false).filter((p) => !teammates.has(p.id)).map(optionHtml).join("");
    area.innerHTML = `<div class="action-line"><label>狼人擊殺目標<select id="nightTarget">${options}</select></label><button id="nightButton" class="primary" type="button">提交擊殺</button></div>`;
    $("#nightButton").addEventListener("click", () => send({ type: "night_action", action: { kind: "werewolf", targetId: $("#nightTarget").value } }));
    return;
  }
  if (role === "seer") {
    const options = aliveTargets(false).map(optionHtml).join("");
    const known = Object.entries(state.me.seerResults || {}).map(([id, team]) => `${nameOf(id)}：${team === "werewolf" ? "狼人陣營" : "村民陣營"}`).join("；");
    area.innerHTML = `${known ? `<div class="info-card"><strong>已知查驗：</strong>${escapeHtml(known)}</div>` : ""}<div class="action-line"><label>查驗目標<select id="nightTarget">${options}</select></label><button id="nightButton" class="primary" type="button">提交查驗</button></div>`;
    $("#nightButton").addEventListener("click", () => send({ type: "night_action", action: { kind: "seer", targetId: $("#nightTarget").value } }));
    return;
  }
  if (role === "guard") {
    const options = state.players.filter((p) => p.alive && p.id !== state.me.guardLastTarget).map(optionHtml).join("");
    const previous = state.me.guardLastTarget ? `上一夜守護：${nameOf(state.me.guardLastTarget)}；本夜不可連守同一人。` : "第一夜可守護任一存活玩家。";
    area.innerHTML = `<div class="info-card">${escapeHtml(previous)}</div><div class="action-line"><label>守護目標<select id="nightTarget">${options}</select></label><button id="nightButton" class="primary" type="button">提交守護</button></div>`;
    $("#nightButton").addEventListener("click", () => send({ type: "night_action", action: { kind: "guard", targetId: $("#nightTarget").value } }));
    return;
  }
  if (role === "witch") {
    const victim = state.me.witchKnownVictim ? nameOf(state.me.witchKnownVictim) : "尚未確定";
    const poisonOptions = aliveTargets(false).map(optionHtml).join("");
    const canHeal = Boolean(state.me.witchHealAvailable && state.me.witchKnownVictim && state.me.witchCanHealKnownVictim);
    const selfSaveNote = state.me.witchKnownVictim === state.me.id && !state.me.witchCanHealKnownVictim ? "；本局規則此時不可自救" : "";
    area.innerHTML = `<div class="info-card">狼人擊殺目標：<strong>${escapeHtml(victim)}</strong><br>解藥：${state.me.witchHealAvailable ? "可用" : "已使用"}${escapeHtml(selfSaveNote)}；毒藥：${state.me.witchPoisonAvailable ? "可用" : "已使用"}</div>
      <div class="action-line">
        <button id="witchHeal" class="primary" type="button" ${canHeal ? "" : "disabled"}>使用解藥</button>
        <label>毒藥目標<select id="witchPoison" ${!state.me.witchPoisonAvailable ? "disabled" : ""}>${poisonOptions}</select></label>
        <button id="witchPoisonButton" class="secondary" type="button" ${!state.me.witchPoisonAvailable ? "disabled" : ""}>使用毒藥</button>
        <button id="witchPass" class="ghost" type="button">本夜不用藥</button>
      </div>`;
    $("#witchHeal").addEventListener("click", () => send({ type: "night_action", action: { kind: "witch", action: { type: "heal" } } }));
    $("#witchPoisonButton").addEventListener("click", () => send({ type: "night_action", action: { kind: "witch", action: { type: "poison", targetId: $("#witchPoison").value } } }));
    $("#witchPass").addEventListener("click", () => send({ type: "night_action", action: { kind: "witch", action: { type: "pass" } } }));
  }
}

function renderNotice() {
  const panel = $("#noticePanel");
  let text = "";
  if (state.phase === "night" && state.me.role === "werewolf" && state.me.wolfTeammates?.length) text = `你的狼人隊友：${state.me.wolfTeammates.map(nameOf).join("、")}`;
  if ((state.phase === "debate" || state.phase === "vote") && state.lastNightDeaths.length) text = `昨夜死亡：${state.lastNightDeaths.map(nameOf).join("、")}`;
  if ((state.phase === "debate" || state.phase === "vote") && !state.lastNightDeaths.length && state.round > 0) text = "昨夜是平安夜。請以公開資訊進行辯論，不要把無理由跟票當成推理。";
  panel.textContent = text;
  panel.classList.toggle("hidden", !text);
}

function aliveTargets(includeSelf) {
  return state.players.filter((p) => p.alive && (includeSelf || p.id !== state.me.id));
}
function optionHtml(p) { return `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`; }
function nameOf(id) { return state.players.find((p) => p.id === id)?.name || "未知玩家"; }

function send(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) { showToast("連線尚未就緒，請稍後重試", true); return; }
  ws.send(JSON.stringify(payload));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function setSession(roomId, token, playerId) {
  session = { roomId, token, playerId };
  localStorage.setItem("werewolf-session", JSON.stringify(session));
}
function readSession() {
  try { return JSON.parse(localStorage.getItem("werewolf-session") || "null"); } catch { return null; }
}
function showToast(message, error = false) {
  toast.textContent = String(message);
  toast.classList.toggle("error", error);
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 3600);
}
function showError(error) { showToast(error instanceof Error ? error.message : String(error), true); }
function formatTime(ts) { return new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit" }).format(new Date(ts)); }
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
}

if (session) enterRoom();
