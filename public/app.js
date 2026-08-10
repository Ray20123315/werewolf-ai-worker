const $ = (selector) => document.querySelector(selector);
const landing = $("#landing");
const game = $("#game");
const leaveButton = $("#leaveButton");
const toast = $("#toast");
const roleForm = $("#roleForm");
const addAIForm = $("#addAIForm");
const credentialForm = $("#credentialForm");
let session = readSession();
let state = null;
let ws = null;
let reconnectTimer = null;
let aiRunInFlight = null;
let toastTimer = null;

const roleNames = { werewolf: "狼人", villager: "村民", seer: "預言家", witch: "女巫", guard: "守衛" };
const phaseNames = { lobby: "大廳", night: "夜晚", debate: "正式辯論", vote: "放逐投票", ended: "遊戲結束" };
const operationNames = { night_action: "夜晚行動", debate_speech: "正式發言", vote: "投票" };
const providerDefaults = {
  openai: "gpt-5.6-luna",
  gemini: "gemini-3.6-flash",
  deepseek: "deepseek-v4-flash",
  "openai-compatible": ""
};

$("#createForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const data = await api("/api/rooms", { method: "POST", body: { name: form.get("name") } });
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

addAIForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!session) return;
  const form = new FormData(event.currentTarget);
  const provider = String(form.get("provider") || "");
  const apiKey = String(form.get("apiKey") || "").trim();
  if (!apiKey) return showToast("請輸入你自己的 API Key", true);
  const body = {
    token: session.token,
    name: form.get("name"),
    provider,
    model: form.get("model")
  };
  if (provider === "openai-compatible") body.baseUrl = form.get("baseUrl");
  try {
    const data = await api(`/api/rooms/${session.roomId}/ai`, { method: "POST", body });
    setAIKey(data.playerId, apiKey);
    event.currentTarget.reset();
    $("#aiProvider").value = "openai";
    $("#aiModel").value = providerDefaults.openai;
    syncProviderFields();
    showToast("AI 玩家已加入；API Key 只保留在這個瀏覽器工作階段");
  } catch (error) { showError(error); }
});

$("#aiProvider").addEventListener("change", () => {
  const provider = $("#aiProvider").value;
  $("#aiModel").value = providerDefaults[provider] ?? "";
  syncProviderFields();
});

roleForm.addEventListener("input", () => { roleForm.dataset.dirty = "1"; });
roleForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const roles = Object.fromEntries(["werewolf", "villager", "seer", "witch", "guard"].map((key) => [key, Number(form.get(key))]));
  send({ type: "configure_roles", roles });
  roleForm.dataset.dirty = "";
});

credentialForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const playerId = $("#credentialPlayer").value;
  const key = $("#credentialKey").value.trim();
  if (!playerId || !key) return showToast("請選擇 AI 並輸入 API Key", true);
  setAIKey(playerId, key);
  $("#credentialKey").value = "";
  renderHostPanel();
  showToast("API Key 已保留在此瀏覽器工作階段");
  void maybeRunPendingAI();
});

$("#chatForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#chatInput");
  const content = input.value.trim();
  if (!content) return;
  send({ type: "chat", content });
  input.value = "";
});

$("#startButton").addEventListener("click", () => send({ type: "start" }));
$("#copyRoom").addEventListener("click", async () => {
  if (!session) return;
  try {
    await navigator.clipboard?.writeText(session.roomId);
    showToast("房間代碼已複製");
  } catch { showToast("無法存取剪貼簿，請手動複製房間代碼", true); }
});

leaveButton.addEventListener("click", () => {
  clearTimeout(reconnectTimer);
  ws?.close(1000, "leave");
  ws = null;
  if (session) clearAIRoomKeys(session.roomId);
  localStorage.removeItem("werewolf-session");
  session = null;
  state = null;
  location.reload();
});

syncProviderFields();
if (session) void enterRoom();

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
    state = null;
    landing.classList.remove("hidden");
    game.classList.add("hidden");
    leaveButton.classList.add("hidden");
    showError(error);
  }
}

function connectWebSocket() {
  if (!session) return;
  clearTimeout(reconnectTimer);
  ws?.close();
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}/api/rooms/${session.roomId}/ws?token=${encodeURIComponent(session.token)}`);
  ws.addEventListener("open", () => updateActionStatus("已連線"));
  ws.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === "state") {
        state = payload.state;
        render();
      } else if (payload.type === "error") showToast(payload.message, true);
      else if (payload.type === "notice") showToast(payload.message);
    } catch { showToast("收到無法解析的伺服器訊息", true); }
  });
  ws.addEventListener("close", (event) => {
    updateActionStatus("重新連線中");
    if (session && event.code !== 1000) reconnectTimer = setTimeout(connectWebSocket, 1500);
  });
  ws.addEventListener("error", () => updateActionStatus("連線異常"));
}

function render() {
  if (!state) return;
  $("#roomCode").textContent = state.roomId;
  $("#phaseBadge").textContent = phaseNames[state.phase] ?? state.phase;
  $("#roundLabel").textContent = state.phase === "lobby" ? "等待開始" : `第 ${state.round} 輪`;
  $("#playerCountLabel").textContent = `${state.players.length} 人 · 無固定上限`;
  $("#roleLabel").textContent = state.me.role ? roleNames[state.me.role] : "尚未分配";
  $("#playerCounter").textContent = String(state.players.length);
  renderPlayers();
  renderMessages();
  renderHostPanel();
  renderActionArea();
  renderChatState();
  renderNotice();
  updateActionStatus(ws?.readyState === WebSocket.OPEN ? "已同步" : "連線中");
  void maybeRunPendingAI();
}

function renderPlayers() {
  const teammateIds = new Set(state.me.wolfTeammates || []);
  $("#players").innerHTML = state.players.map((player, index) => {
    const badges = [];
    if (player.isHost) badges.push('<span class="pill host">房主</span>');
    if (player.isAI) badges.push(`<span class="pill ai">AI · ${escapeHtml(player.ai?.provider || "")}</span>`);
    if (!player.alive) badges.push('<span class="pill dead">出局</span>');
    if (teammateIds.has(player.id)) badges.push('<span class="pill wolf">狼人隊友</span>');
    if (state.phase === "debate" && state.currentSpeakerId === player.id) badges.push('<span class="pill speaker">發言中</span>');
    if (state.phase === "debate" && state.debateCompleted?.includes(player.id)) badges.push('<span class="pill done">已發言</span>');
    const role = player.role ? `<span class="role-reveal">${escapeHtml(roleNames[player.role] || player.role)}</span>` : "";
    return `<article class="player-row ${player.alive ? "" : "is-dead"}">
      <span class="seat-number">${String(index + 1).padStart(2, "0")}</span>
      <div class="player-main"><div class="player-name"><strong>${escapeHtml(player.name)}</strong>${badges.join("")}</div>${player.isAI && player.ai ? `<small>${escapeHtml(player.ai.model)}</small>` : ""}</div>
      ${role}
    </article>`;
  }).join("");
}

function renderMessages() {
  const box = $("#messages");
  const wasNearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.innerHTML = state.messages.map((message) => {
    const label = message.kind === "speech" ? "正式發言" : message.kind === "chat" ? "聊天" : "系統";
    return `<article class="message message-${message.kind}">
      <div class="message-head"><div><strong>${escapeHtml(message.playerName)}</strong><span class="message-kind">${label}</span></div><time>${formatTime(message.createdAt)}</time></div>
      <p>${escapeHtml(message.content)}</p>
    </article>`;
  }).join("") || '<div class="empty-state">還沒有訊息。先在大廳打聲招呼吧。</div>';
  if (wasNearBottom || state.messages.length < 8) box.scrollTop = box.scrollHeight;
}

function renderHostPanel() {
  const panel = $("#hostPanel");
  const isHost = Boolean(state.me.isHost);
  panel.classList.toggle("hidden", !isHost);
  if (!isHost) return;

  const isLobby = state.phase === "lobby";
  roleForm.closest("details").classList.toggle("hidden", !isLobby);
  addAIForm.closest("details").classList.toggle("hidden", !isLobby);
  $("#startButton").closest(".start-zone").classList.toggle("hidden", !isLobby);

  if (isLobby && roleForm.dataset.dirty !== "1") {
    for (const role of ["werewolf", "villager", "seer", "witch", "guard"]) roleForm.elements[role].value = String(state.roleSetup[role] ?? 0);
  }
  $("#roleValidation").textContent = state.roleSetupError || "角色總數與玩家數一致即可開始；預言家、女巫、守衛目前各最多 1 名。";
  $("#roleValidation").classList.toggle("is-error", Boolean(state.roleSetupError));
  $("#startButton").disabled = !state.canStart;
  $("#startHint").textContent = state.roleSetupError || "角色配置有效，可以開始遊戲。";

  const aiPlayers = state.players.filter((player) => player.isAI);
  const credentialSection = $("#credentialSection");
  credentialSection.classList.toggle("hidden", aiPlayers.length === 0);
  if (aiPlayers.length > 0) {
    const select = $("#credentialPlayer");
    const selected = select.value;
    select.innerHTML = aiPlayers.map((player) => `<option value="${escapeAttr(player.id)}">${escapeHtml(player.name)} · ${escapeHtml(player.ai?.provider || "AI")}</option>`).join("");
    if (aiPlayers.some((player) => player.id === selected)) select.value = selected;
    $("#credentialList").innerHTML = aiPlayers.map((player) => {
      const hasKey = Boolean(getAIKey(player.id));
      return `<div class="credential-row"><span>${escapeHtml(player.name)}</span><strong class="${hasKey ? "has-key" : "missing-key"}">${hasKey ? "此分頁已有 Key" : "需要 API Key"}</strong></div>`;
    }).join("");
  }
}

function renderActionArea() {
  const area = $("#actionArea");
  if (state.phase === "lobby") {
    area.innerHTML = `<div class="phase-card"><span>LOBBY</span><strong>等待玩家加入與房主設定角色。</strong><p>純真人房不需要任何 API。至少 3 人且角色配置有效後即可開始。</p></div>`;
    return;
  }
  if (state.phase === "ended") {
    const label = state.winner === "werewolf" ? "狼人陣營" : "村民陣營";
    area.innerHTML = `<div class="phase-card winner-card"><span>GAME OVER</span><strong>${label}獲勝</strong><p>身份已公開，可以留在聊天室復盤。</p></div>`;
    return;
  }
  if (!state.me.alive) {
    area.innerHTML = '<div class="phase-card"><span>SPECTATOR</span><strong>你已出局。</strong><p>可以繼續觀看公開紀錄，但對局進行中不能發言、投票或執行夜晚技能。</p></div>';
    return;
  }
  if (state.phase === "debate") return renderDebateAction(area);
  if (state.phase === "vote") return renderVoteAction(area);
  renderNightAction(area);
}

function renderDebateAction(area) {
  const currentName = nameOf(state.currentSpeakerId);
  const progress = Math.min(state.debateIndex + 1, state.debateOrder.length);
  const order = state.debateOrder.map((id, index) => {
    const marker = index < state.debateIndex ? "✓" : index === state.debateIndex ? "▶" : "·";
    return `${marker} ${nameOf(id)}`;
  }).join("  →  ");
  if (state.currentSpeakerId !== state.me.id) {
    const current = state.players.find((player) => player.id === state.currentSpeakerId);
    const waiting = current?.isAI ? "等待房主瀏覽器以 BYOK 驅動 AI 發言。" : "等待該玩家送出正式發言；自由聊天室仍可交流。";
    area.innerHTML = `<div class="phase-card"><span>DEBATE ${progress}/${state.debateOrder.length}</span><strong>現在輪到 ${escapeHtml(currentName)}</strong><p>${waiting}</p></div><div class="speech-order">${escapeHtml(order)}</div>`;
    return;
  }
  area.innerHTML = `<div class="phase-card active-turn"><span>YOUR TURN</span><strong>輪到你正式發言。</strong><p>自由聊天不會推進順位；下方正式發言送出後才算完成本輪。</p></div>
    <div class="speech-order">${escapeHtml(order)}</div>
    <label class="field"><span>正式辯論內容</span><textarea id="debateSpeech" maxlength="700" rows="5" placeholder="說明你的推理、回應前面玩家，並提出目前懷疑方向…"></textarea></label>
    <button id="submitSpeech" class="button button-primary" type="button">送出正式發言</button>`;
  $("#submitSpeech").addEventListener("click", () => {
    const content = $("#debateSpeech").value.trim();
    if (content.length < 2) return showToast("正式發言至少需要 2 個字元", true);
    send({ type: "debate_speech", content });
  });
}

function renderVoteAction(area) {
  if (state.votesCast.includes(state.me.id)) {
    area.innerHTML = '<div class="phase-card"><span>VOTE LOCKED</span><strong>你已完成投票。</strong><p>等待其他存活玩家完成投票。</p></div>';
    return;
  }
  const options = aliveTargets(false).map(optionHtml).join("");
  const aiText = state.aiVotingUnlocked ? "AI 已可進行投票。" : "若場上仍有真人，AI 會等至少一名真人先投票。";
  area.innerHTML = `<div class="phase-card"><span>VOTE</span><strong>正式辯論完成，進入放逐投票。</strong><p>${escapeHtml(aiText)}</p></div>
    <div class="action-line"><label class="field"><span>放逐目標</span><select id="voteTarget">${options}</select></label><button id="voteButton" class="button button-primary" type="button">確認投票</button></div>`;
  $("#voteButton").addEventListener("click", () => send({ type: "vote", targetId: $("#voteTarget").value }));
}

function renderNightAction(area) {
  const role = state.me.role;
  if (state.nightSubmitted.includes(state.me.id)) {
    area.innerHTML = '<div class="phase-card night-card"><span>NIGHT</span><strong>夜晚行動已提交。</strong><p>等待其他需要行動的角色。</p></div>';
    return;
  }
  if (role === "villager") {
    area.innerHTML = '<div class="phase-card night-card"><span>NIGHT</span><strong>村民沒有夜晚技能。</strong><p>等待天亮。夜晚期間公開聊天關閉。</p></div>';
    return;
  }
  if (role === "werewolf") {
    const teammates = new Set(state.me.wolfTeammates || []);
    const options = aliveTargets(false).filter((player) => !teammates.has(player.id)).map(optionHtml).join("");
    area.innerHTML = `<div class="phase-card night-card"><span>WEREWOLF</span><strong>選擇今晚的擊殺目標。</strong></div><div class="action-line"><label class="field"><span>目標</span><select id="nightTarget">${options}</select></label><button id="nightButton" class="button button-primary" type="button">提交</button></div>`;
    $("#nightButton").addEventListener("click", () => send({ type: "night_action", action: { kind: "werewolf", targetId: $("#nightTarget").value } }));
    return;
  }
  if (role === "seer") {
    const options = aliveTargets(false).map(optionHtml).join("");
    const known = Object.entries(state.me.seerResults || {}).map(([id, team]) => `${nameOf(id)}：${team === "werewolf" ? "狼人陣營" : "村民陣營"}`).join("；");
    area.innerHTML = `${known ? `<div class="intel-card"><strong>已知查驗</strong><p>${escapeHtml(known)}</p></div>` : ""}<div class="action-line"><label class="field"><span>查驗目標</span><select id="nightTarget">${options}</select></label><button id="nightButton" class="button button-primary" type="button">提交查驗</button></div>`;
    $("#nightButton").addEventListener("click", () => send({ type: "night_action", action: { kind: "seer", targetId: $("#nightTarget").value } }));
    return;
  }
  if (role === "guard") {
    const options = state.players.filter((player) => player.alive && player.id !== state.me.guardLastTarget).map(optionHtml).join("");
    const previous = state.me.guardLastTarget ? `上一夜守護：${nameOf(state.me.guardLastTarget)}；本夜不可連守。` : "第一夜可守護任一存活玩家。";
    area.innerHTML = `<div class="phase-card night-card"><span>GUARD</span><strong>選擇守護目標。</strong><p>${escapeHtml(previous)}</p></div><div class="action-line"><label class="field"><span>守護目標</span><select id="nightTarget">${options}</select></label><button id="nightButton" class="button button-primary" type="button">提交守護</button></div>`;
    $("#nightButton").addEventListener("click", () => send({ type: "night_action", action: { kind: "guard", targetId: $("#nightTarget").value } }));
    return;
  }
  if (role === "witch") {
    const victim = state.me.witchKnownVictim ? nameOf(state.me.witchKnownVictim) : "尚未確定";
    const poisonOptions = aliveTargets(false).map(optionHtml).join("");
    const healDisabled = !state.me.witchCanHealKnownVictim;
    const poisonDisabled = !state.me.witchPoisonAvailable;
    area.innerHTML = `<div class="phase-card night-card"><span>WITCH</span><strong>狼人擊殺目標：${escapeHtml(victim)}</strong><p>解藥 ${state.me.witchHealAvailable ? "可用" : "已使用"}；毒藥 ${state.me.witchPoisonAvailable ? "可用" : "已使用"}。</p></div>
      <div class="witch-actions">
        <button id="witchHeal" class="button button-secondary" type="button" ${healDisabled ? "disabled" : ""}>使用解藥</button>
        <div class="action-line"><label class="field"><span>毒藥目標</span><select id="poisonTarget" ${poisonDisabled ? "disabled" : ""}>${poisonOptions}</select></label><button id="witchPoison" class="button button-secondary" type="button" ${poisonDisabled ? "disabled" : ""}>使用毒藥</button></div>
        <button id="witchPass" class="button button-ghost" type="button">今晚不使用藥水</button>
      </div>`;
    $("#witchHeal")?.addEventListener("click", () => send({ type: "night_action", action: { kind: "witch", action: { type: "heal" } } }));
    $("#witchPoison")?.addEventListener("click", () => send({ type: "night_action", action: { kind: "witch", action: { type: "poison", targetId: $("#poisonTarget").value } } }));
    $("#witchPass")?.addEventListener("click", () => send({ type: "night_action", action: { kind: "witch", action: { type: "pass" } } }));
  }
}

function renderChatState() {
  const canChat = state.phase !== "night" && (state.phase === "lobby" || state.phase === "ended" || state.me.alive);
  $("#chatInput").disabled = !canChat;
  $("#chatButton").disabled = !canChat;
  $("#chatInput").placeholder = canChat ? "輸入公開聊天訊息…" : state.phase === "night" ? "夜晚期間公開聊天關閉" : "已出局玩家目前只能觀看";
  $("#chatHint").textContent = state.phase === "night"
    ? "夜晚期間為避免資訊外洩，公開聊天暫停。"
    : "聊天不會推進正式辯論順位；只有「正式發言」會完成你的辯論回合。";
}

function renderNotice() {
  const panel = $("#noticePanel");
  const notices = [];
  if (state.phase === "lobby" && state.roleSetupError) notices.push(`角色配置：${state.roleSetupError}`);
  if (state.me.isHost && state.pendingAI) {
    const player = state.players.find((item) => item.id === state.pendingAI.playerId);
    if (player && !getAIKey(player.id)) notices.push(`${player.name} 正等待${operationNames[state.pendingAI.operation] || "AI 操作"}，請在「AI API Key 管理」重新輸入該 AI 的 Key。`);
  }
  if (state.lastNightDeaths?.length) notices.push(`上一夜死亡：${state.lastNightDeaths.map(nameOf).join("、")}`);
  if (state.lastVoteEliminated) notices.push(`上一輪放逐：${nameOf(state.lastVoteEliminated)}`);
  panel.textContent = notices.join("　｜　");
  panel.classList.toggle("hidden", notices.length === 0);
}

async function maybeRunPendingAI() {
  if (!session || !state?.me?.isHost || !state.pendingAI) return;
  const task = state.pendingAI;
  const player = state.players.find((item) => item.id === task.playerId);
  if (!player) return;
  const apiKey = getAIKey(player.id);
  if (!apiKey) return;
  const taskKey = `${state.roomId}:${state.round}:${state.phase}:${task.playerId}:${task.operation}:${state.debateIndex}:${state.votesCast.length}:${state.nightSubmitted.length}`;
  if (aiRunInFlight === taskKey) return;
  aiRunInFlight = taskKey;
  updateActionStatus(`AI ${operationNames[task.operation] || "處理中"}`);
  try {
    await api(`/api/rooms/${session.roomId}/ai/run`, {
      method: "POST",
      body: { token: session.token, playerId: task.playerId, apiKey }
    });
  } catch (error) {
    showError(error);
  } finally {
    aiRunInFlight = null;
  }
}

function syncProviderFields() {
  const custom = $("#aiProvider").value === "openai-compatible";
  $("#aiBaseUrlField").classList.toggle("hidden", !custom);
  $("#aiBaseUrl").required = custom;
}

function aliveTargets(includeSelf = true) {
  return state.players.filter((player) => player.alive && (includeSelf || player.id !== state.me.id));
}

function optionHtml(player) {
  return `<option value="${escapeAttr(player.id)}">${escapeHtml(player.name)}</option>`;
}

function nameOf(id) {
  if (!id) return "未知玩家";
  return state?.players?.find((player) => player.id === id)?.name ?? "未知玩家";
}

function send(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return showToast("連線尚未就緒，請稍後再試", true);
  ws.send(JSON.stringify(payload));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function setSession(roomId, token, playerId) {
  session = { roomId, token, playerId };
  localStorage.setItem("werewolf-session", JSON.stringify(session));
}

function readSession() {
  try {
    const raw = JSON.parse(localStorage.getItem("werewolf-session") || "null");
    if (raw && typeof raw.roomId === "string" && typeof raw.token === "string" && typeof raw.playerId === "string") return raw;
  } catch {}
  return null;
}

function aiKeyStorageKey(playerId) {
  return `werewolf-ai-key:${session?.roomId || "unknown"}:${playerId}`;
}

function setAIKey(playerId, key) {
  sessionStorage.setItem(aiKeyStorageKey(playerId), key);
}

function getAIKey(playerId) {
  return sessionStorage.getItem(aiKeyStorageKey(playerId)) || "";
}

function clearAIRoomKeys(roomId) {
  const prefix = `werewolf-ai-key:${roomId}:`;
  for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
    const key = sessionStorage.key(i);
    if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
  }
}

function showError(error) {
  showToast(error instanceof Error ? error.message : "發生未知錯誤", true);
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.remove("hidden");
  toastTimer = setTimeout(() => toast.classList.add("hidden"), isError ? 6500 : 3500);
}

function updateActionStatus(text) {
  const element = $("#actionStatus");
  if (element) element.textContent = text;
}

function formatTime(value) {
  return new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}
