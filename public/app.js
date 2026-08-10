const $ = (selector) => document.querySelector(selector);
const landing = $("#landing");
const roomGate = $("#roomGate");
const game = $("#game");
const leaveButton = $("#leaveButton");
const toast = $("#toast");

const providerDefaults = { openai: "gpt-5.6-luna", gemini: "gemini-3.6-flash", deepseek: "deepseek-v4-flash", "openai-compatible": "" };
const phaseNames = { lobby: "大廳", sheriff: "警長選舉", night: "夜晚", debate: "正式辯論", vote: "放逐投票", reaction: "死亡／放逐反應", ended: "遊戲結束" };
const factionNames = { village: "好人陣營", werewolf: "狼人陣營", spirit: "怨靈陣營", neutral: "特殊／第三方", blood: "血族陣營" };
const factionOrder = ["village", "werewolf", "spirit", "blood", "neutral"];

let roleList = [];
let roleById = new Map();
let roomId = roomIdFromPath();
let session = roomId ? readSession(roomId) : null;
let state = null;
let ws = null;
let reconnectTimer = null;
let roomInfo = null;

await bootstrap();

async function bootstrap() {
  try {
    const roles = await api("/api/roles");
    roleList = roles.roles || [];
    roleById = new Map(roleList.map((role) => [role.id, role]));
    $("#roleCountFact").textContent = String(roleList.length);
  } catch (error) {
    showError(error);
  }

  if (!roomId) {
    landing.classList.remove("hidden");
    return;
  }
  await openRoomRoute();
}

async function openRoomRoute() {
  try {
    roomInfo = await api(`/api/rooms/${roomId}/info`);
    $("#gateRoomCode").textContent = roomId;
    document.title = `${roomId} · 狼人議會`;
    const needsPassword = Boolean(roomInfo.requiresRoomPassword);
    $("#roomPasswordNotice").classList.toggle("hidden", !needsPassword);
    document.querySelectorAll(".room-password-field").forEach((el) => el.classList.toggle("hidden", !needsPassword));
    if (session) {
      try {
        await enterRoom();
        return;
      } catch {
        clearSession(roomId);
        session = null;
      }
    }
    showGate();
  } catch (error) {
    showGate();
    $("#gateHint").textContent = "找不到這個房間，或房間暫時無法讀取。";
    showError(error);
  }
}

$("#createForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const data = await api("/api/rooms", {
      method: "POST",
      body: {
        name: form.get("name"),
        playerPassword: form.get("playerPassword"),
        roomPassword: form.get("roomPassword") || undefined
      }
    });
    saveSession(data.roomId, data.token, data.playerId);
    location.href = `/${data.roomId}`;
  } catch (error) { showError(error); }
});

$("#goRoomForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const code = normalizeRoomId(form.get("roomId"));
  if (!code) return showToast("房號格式不正確", true);
  location.href = `/${code}`;
});

$("#joinForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!roomId) return;
  const form = new FormData(event.currentTarget);
  try {
    const data = await api(`/api/rooms/${roomId}/join`, {
      method: "POST",
      body: {
        name: form.get("name"), playerPassword: form.get("playerPassword"), roomPassword: form.get("roomPassword") || undefined
      }
    });
    setSession(roomId, data.token, data.playerId);
    await enterRoom();
    showToast(data.spectator ? "已以觀戰者身份加入；下一局會轉正式玩家" : "人物已建立");
  } catch (error) { showError(error); }
});

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!roomId) return;
  const form = new FormData(event.currentTarget);
  try {
    const data = await api(`/api/rooms/${roomId}/login`, {
      method: "POST",
      body: {
        name: form.get("name"), playerPassword: form.get("playerPassword"), roomPassword: form.get("roomPassword") || undefined
      }
    });
    setSession(roomId, data.token, data.playerId);
    await enterRoom();
    showToast("已找回原本人物");
  } catch (error) { showError(error); }
});

leaveButton.addEventListener("click", () => {
  if (!roomId) return;
  clearTimeout(reconnectTimer);
  ws?.close(1000, "Local logout");
  ws = null;
  clearSession(roomId);
  session = null;
  state = null;
  showGate();
});

$("#copyRoom").addEventListener("click", async () => {
  if (!roomId) return;
  const link = `${location.origin}/${roomId}`;
  await navigator.clipboard?.writeText(link);
  showToast("房間連結已複製");
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
$("#resetButton").addEventListener("click", () => send({ type: "reset" }));

$("#settingsForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  send({
    type: "configure_settings",
    settings: {
      sheriffEnabled: form.get("sheriffEnabled") === "on",
      deathInfo: form.get("deathInfo"),
      tieRule: form.get("tieRule")
    }
  });
  showToast("房規已送出");
});

$("#roleSetupForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const roles = {};
  document.querySelectorAll("[data-role-count]").forEach((input) => {
    const value = Math.max(0, Number.parseInt(input.value || "0", 10) || 0);
    if (value > 0) roles[input.dataset.roleCount] = value;
  });
  send({ type: "configure_roles", roles });
  showToast("角色配置已送出");
});

$("#zeroRoles").addEventListener("click", () => {
  document.querySelectorAll("[data-role-count]").forEach((input) => { input.value = "0"; });
  updateRoleTotalFromInputs();
});

$("#roleSearch").addEventListener("input", (event) => filterRoleCatalog(event.target.value));

$("#aiProvider").addEventListener("change", (event) => {
  const provider = event.target.value;
  $("#aiModel").value = providerDefaults[provider] ?? "";
  $("#aiBaseUrlRow").classList.toggle("hidden", provider !== "openai-compatible");
});

$("#addAIForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!session || !roomId) return;
  const form = new FormData(event.currentTarget);
  const provider = String(form.get("provider"));
  try {
    const result = await api(`/api/rooms/${roomId}/ai`, {
      method: "POST",
      body: {
        token: session.token,
        name: form.get("name"),
        provider,
        model: form.get("model"),
        ...(provider === "openai-compatible" ? { baseUrl: form.get("baseUrl") } : {})
      }
    });
    const keys = readAIKeys();
    keys[result.playerId] = String(form.get("apiKey") || "");
    writeAIKeys(keys);
    event.currentTarget.reset();
    $("#aiProvider").value = "openai";
    $("#aiModel").value = providerDefaults.openai;
    $("#aiBaseUrlRow").classList.add("hidden");
    showToast("AI 已加入；API Key 只保留在這個瀏覽器 session");
  } catch (error) { showError(error); }
});

async function enterRoom() {
  if (!session || !roomId) throw new Error("沒有登入 session");
  state = await api(`/api/rooms/${roomId}/state?token=${encodeURIComponent(session.token)}`);
  landing.classList.add("hidden");
  roomGate.classList.add("hidden");
  game.classList.remove("hidden");
  leaveButton.classList.remove("hidden");
  render();
  connectWebSocket();
}

function showGate() {
  landing.classList.add("hidden");
  game.classList.add("hidden");
  roomGate.classList.remove("hidden");
  leaveButton.classList.add("hidden");
}

function connectWebSocket() {
  if (!session || !roomId) return;
  clearTimeout(reconnectTimer);
  ws?.close();
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}/api/rooms/${roomId}/ws?token=${encodeURIComponent(session.token)}`);
  ws.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === "state") { state = payload.state; render(); }
      if (payload.type === "error") showToast(payload.message, true);
      if (payload.type === "notice") showToast(payload.message);
    } catch { showToast("收到無法解析的伺服器訊息", true); }
  });
  ws.addEventListener("close", (event) => {
    if (!session) return;
    if (event.code === 4003 || event.code === 4001) {
      clearSession(roomId);
      session = null;
      state = null;
      showGate();
      showToast(event.code === 4003 ? "你已被踢出；可重新建立人物加入" : "登入已更新，請重新登入", true);
      return;
    }
    if (event.code !== 1000) reconnectTimer = setTimeout(connectWebSocket, 1500);
  });
}

function render() {
  if (!state) return;
  $("#roomCode").textContent = state.roomId;
  $("#phaseLabel").textContent = phaseNames[state.phase] ?? state.phase;
  $("#roundLabel").textContent = state.phase === "lobby" ? `${formalPlayers().length} 名正式玩家` : state.round ? `第 ${state.round} 輪` : "開局流程";
  $("#roleLabel").textContent = state.me.role ? roleName(state.me.role) : state.me.isSpectator ? "觀戰者" : "尚未分配";
  $("#factionLabel").textContent = state.me.faction ? factionNames[state.me.faction] ?? state.me.faction : "—";
  renderPlayers();
  renderMessages();
  renderActionArea();
  renderHostPanel();
  renderNotice();
  renderChatState();
  renderLegacyPasswordUpgrade();
}

function renderPlayers() {
  const teammateIds = new Set(state.me.wolfTeammates || []);
  $("#players").innerHTML = state.players.map((p) => {
    const tags = [];
    if (p.isHost) tags.push('<span class="pill host">房主</span>');
    if (p.isSheriff) tags.push('<span class="pill sheriff">警長</span>');
    if (p.isAI) tags.push('<span class="pill ai">AI</span>');
    if (p.isSpectator) tags.push('<span class="pill spectator">觀戰</span>');
    if (!p.alive && !p.isSpectator) tags.push('<span class="pill dead">出局</span>');
    if (teammateIds.has(p.id)) tags.push('<span class="pill wolf">狼隊友</span>');
    if (state.phase === "debate" && state.currentSpeakerId === p.id) tags.push('<span class="pill speaker">發言中</span>');
    const reveal = p.role ? `<small class="role-reveal">${escapeHtml(roleName(p.role))}</small>` : "";
    const kick = state.me.isHost && p.id !== state.me.id ? `<button class="kick-button" data-kick="${p.id}" type="button">踢出</button>` : "";
    return `<article class="player-row ${!p.alive ? "is-dead" : ""}"><div><div class="player-name"><strong>${escapeHtml(p.name)}</strong>${tags.join("")}</div>${reveal}</div>${kick}</article>`;
  }).join("");
  document.querySelectorAll("[data-kick]").forEach((button) => button.addEventListener("click", () => {
    if (confirm(`確定踢出 ${nameOf(button.dataset.kick)}？被踢者不是永久封鎖，可重新加入。`)) send({ type: "kick", targetId: button.dataset.kick });
  }));
}

function renderMessages() {
  const box = $("#messages");
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.innerHTML = state.messages.map((m) => `<article class="message message-${m.kind}"><div class="message-head"><strong>${escapeHtml(m.playerName)}</strong><span>${formatTime(m.createdAt)}</span></div><p>${escapeHtml(m.content)}</p></article>`).join("");
  if (atBottom) box.scrollTop = box.scrollHeight;
}

function renderActionArea() {
  const area = $("#actionArea");
  if (state.phase === "reaction") {
    area.innerHTML = `<div class="phase-card active-turn"><span>REACTION</span><strong>你有死亡／放逐觸發技能待處理</strong><p>這是伺服器狀態的一部分，處理完才繼續流程。</p></div>${state.roleAction ? genericActionHtml(state.roleAction) : '<div class="phase-card"><strong>等待其他玩家處理反應技能。</strong></div>'}`;
    bindGenericRoleAction();
    return;
  }
  if (state.phase === "lobby") {
    area.innerHTML = `<div class="phase-card"><span>LOBBY</span><strong>等待房主完成角色配置。</strong><p>正式玩家 ${formalPlayers().length} 人；角色總數必須相同，且狼人陣營少於其他玩家總數。AI 不是必需品。</p></div>`;
    return;
  }
  if (state.phase === "sheriff") return renderSheriffAction(area);
  if (state.phase === "ended") {
    area.innerHTML = `<div class="phase-card winner-card"><span>GAME OVER</span><strong>${escapeHtml(state.winnerLabel || `${factionNames[state.winner] || state.winner}獲勝`)}</strong><p>身份已公開。房主可回大廳開始下一局。</p></div>`;
    return;
  }
  if (state.me.isSpectator) {
    area.innerHTML = '<div class="phase-card"><strong>你目前是觀戰者。</strong><p>進行中的這局不會重新抽角色；下一局回大廳後才能成為正式玩家。</p></div>';
    return;
  }
  if (!state.me.alive) {
    area.innerHTML = '<div class="phase-card"><strong>你已出局。</strong><p>可以閱讀公開紀錄，但不能再聊天干擾存活玩家或執行一般技能。</p></div>';
    return;
  }
  if (state.phase === "night") return renderNightAction(area);
  if (state.phase === "debate") return renderDebateAction(area);
  if (state.phase === "vote") return renderVoteAction(area);
}

function renderSheriffAction(area) {
  if (state.me.isSpectator || !state.me.alive) {
    area.innerHTML = '<div class="phase-card"><strong>警長選舉進行中。</strong></div>';
    return;
  }
  const candidates = state.sheriff.candidates || [];
  const alreadyVoted = Boolean(state.sheriff.votes?.[state.me.id]);
  const isCandidate = candidates.includes(state.me.id);
  area.innerHTML = `<div class="phase-card active-turn"><span>SHERIFF ELECTION · ROUND ${state.sheriff.electionRound}</span><strong>警長選舉</strong><p>第一高票成為警長；平票重選一次，再平票則本局無警長。</p></div>
    <div class="action-line"><button id="candidateToggle" class="button button-ghost" type="button">${isCandidate ? "退出候選" : "加入候選"}</button></div>
    ${alreadyVoted ? '<div class="phase-card"><strong>你已投警長票。</strong></div>' : `<div class="action-line"><label>投給候選人<select id="sheriffTarget">${candidates.filter((id) => id !== state.me.id).map((id) => optionFor(id)).join("")}</select></label><button id="sheriffVote" class="button button-primary" type="button">投警長票</button></div>`}
    ${state.roleAction ? genericActionHtml(state.roleAction) : ""}`;
  $("#candidateToggle")?.addEventListener("click", () => send({ type: "sheriff_candidate", running: !isCandidate }));
  $("#sheriffVote")?.addEventListener("click", () => send({ type: "sheriff_vote", targetId: $("#sheriffTarget").value }));
  bindGenericRoleAction();
}

function renderNightAction(area) {
  const blocks = [`<div class="phase-card night-card"><span>NIGHT ${state.round}</span><strong>秘密技能階段</strong><p>公開聊天室暫停。技能由伺服器統一結算，不靠距離、武器、追逐或 PvP。</p></div>`];
  const role = state.me.role;
  const submitted = new Set(state.nightSubmitted || []);

  if (state.canSubmitWolfVote) {
    if (state.wolfVoteSubmitted) blocks.push('<div class="intel-card"><strong>狼刀票已提交。</strong></div>');
    else {
      const teammateIds = new Set(state.me.wolfTeammates || []);
      const options = alivePlayers().filter((p) => p.id !== state.me.id && !teammateIds.has(p.id)).map((p) => optionFor(p.id)).join("");
      blocks.push(`<div class="skill-box"><div><span class="skill-label">狼隊共同刀人</span><strong>選擇狼刀目標</strong></div><div class="action-line"><select id="wolfTarget">${options}</select><button id="wolfVoteButton" class="button button-primary" type="button">提交狼刀票</button></div></div>`);
    }
  }

  if (role === "seer") {
    if (submitted.has(state.me.id)) blocks.push('<div class="intel-card"><strong>查驗已提交。</strong></div>');
    else blocks.push(coreTargetSkill("預言家查驗", "seerTarget", "提交查驗", alivePlayers().filter((p) => p.id !== state.me.id)));
  } else if (role === "guard") {
    if (submitted.has(state.me.id)) blocks.push('<div class="intel-card"><strong>守護已提交。</strong></div>');
    else blocks.push(coreTargetSkill("守衛守護", "guardTarget", "提交守護", alivePlayers().filter((p) => p.id !== state.me.guardLastTarget)));
  } else if (role === "witch") {
    if (submitted.has(state.me.id)) blocks.push('<div class="intel-card"><strong>女巫行動已提交。</strong></div>');
    else blocks.push(witchActionHtml());
  }

  if (state.roleAction) {
    if (state.roleActionSubmitted) blocks.push(`<div class="intel-card"><strong>${escapeHtml(state.roleAction.label)}技能已提交。</strong></div>`);
    else blocks.push(genericActionHtml(state.roleAction));
  }

  if (blocks.length === 1) blocks.push('<div class="phase-card"><strong>你的身份本夜沒有必須操作的技能。</strong><p>等待其他玩家完成夜間行動。</p></div>');
  area.innerHTML = blocks.join("");

  $("#wolfVoteButton")?.addEventListener("click", () => send({ type: "night_action", action: { kind: "werewolf", targetId: $("#wolfTarget").value } }));
  $("#coreSkillButton")?.addEventListener("click", () => {
    if (role === "seer") send({ type: "night_action", action: { kind: "seer", targetId: $("#seerTarget").value } });
    if (role === "guard") send({ type: "night_action", action: { kind: "guard", targetId: $("#guardTarget").value } });
  });
  $("#witchButton")?.addEventListener("click", () => {
    const choice = $("#witchChoice").value;
    if (choice === "heal") send({ type: "night_action", action: { kind: "witch", action: { type: "heal" } } });
    else if (choice === "poison") send({ type: "night_action", action: { kind: "witch", action: { type: "poison", targetId: $("#witchTarget").value } } });
    else send({ type: "night_action", action: { kind: "witch", action: { type: "pass" } } });
  });
  bindGenericRoleAction();
}

function renderDebateAction(area) {
  const current = state.currentSpeakerId;
  const currentName = nameOf(current);
  const order = state.debateOrder.map((id, index) => `${index < state.debateIndex ? "✓" : index === state.debateIndex ? "▶" : "·"} ${nameOf(id)}`).join(" → ");
  const blocks = [];
  if (state.roleAction) blocks.push(genericActionHtml(state.roleAction));
  if (current !== state.me.id) {
    blocks.push(`<div class="phase-card"><span>DEBATE ${Math.min(state.debateIndex + 1, state.debateOrder.length)} / ${state.debateOrder.length}</span><strong>等待 ${escapeHtml(currentName)} 正式發言。</strong><p>自由聊天可以交流，但不會推進正式發言順位。</p></div><div class="speech-order">${escapeHtml(order)}</div>`);
  } else {
    blocks.push(`<div class="phase-card active-turn"><span>YOUR TURN</span><strong>輪到你正式發言</strong><p>請回應前面邏輯、指出可驗證的矛盾或站邊。送出才算完成本輪發言。</p></div><div class="speech-order">${escapeHtml(order)}</div><label>正式辯論內容<textarea id="debateSpeech" rows="5" maxlength="900" placeholder="我目前懷疑……因為……前面的資訊與……矛盾。"></textarea></label><button id="submitSpeech" class="button button-primary" type="button">送出正式發言</button>`);
  }
  area.innerHTML = blocks.join("");
  $("#submitSpeech")?.addEventListener("click", () => {
    const content = $("#debateSpeech").value.trim();
    if (content.length < 2) return showToast("正式發言至少 2 個字元", true);
    send({ type: "debate_speech", content });
  });
  bindGenericRoleAction();
}

function renderVoteAction(area) {
  const blocks = [`<div class="phase-card"><span>VOTE</span><strong>所有正式發言已完成，現在才開放放逐票。</strong><p>平票規則：${tieRuleLabel(state.settings.tieRule)}。</p></div>`];
  if (state.roleAction) blocks.push(genericActionHtml(state.roleAction));
  if ((state.votesCast || []).includes(state.me.id)) blocks.push('<div class="intel-card"><strong>你已投票，等待其他存活玩家。</strong></div>');
  else {
    const candidates = (state.voteCandidateIds?.length ? alivePlayers().filter((p) => state.voteCandidateIds.includes(p.id)) : alivePlayers()).filter((p) => p.id !== state.me.id);
    blocks.push(`<div class="action-line"><label>放逐目標<select id="voteTarget">${candidates.map((p) => optionFor(p.id)).join("")}</select></label><button id="voteButton" class="button button-primary" type="button">確認投票</button></div>`);
  }
  area.innerHTML = blocks.join("");
  $("#voteButton")?.addEventListener("click", () => send({ type: "vote", targetId: $("#voteTarget").value }));
  bindGenericRoleAction();
}

function coreTargetSkill(title, selectId, buttonLabel, players) {
  return `<div class="skill-box"><div><span class="skill-label">${escapeHtml(title)}</span><strong>${escapeHtml(title)}</strong></div><div class="action-line"><select id="${selectId}">${players.map((p) => optionFor(p.id)).join("")}</select><button id="coreSkillButton" class="button button-primary" type="button">${escapeHtml(buttonLabel)}</button></div></div>`;
}

function witchActionHtml() {
  const options = ['<option value="pass">今晚不用藥</option>'];
  if (state.me.witchHealAvailable && state.me.witchKnownVictim && state.me.witchCanHealKnownVictim) options.unshift(`<option value="heal">使用解藥救 ${escapeHtml(nameOf(state.me.witchKnownVictim))}</option>`);
  if (state.me.witchPoisonAvailable) options.unshift('<option value="poison">使用毒藥</option>');
  const poisonTargets = alivePlayers().filter((p) => p.id !== state.me.id).map((p) => optionFor(p.id)).join("");
  return `<div class="skill-box"><div><span class="skill-label">女巫</span><strong>一手生、一手死；每晚最多一種</strong></div><div class="witch-grid"><select id="witchChoice">${options.join("")}</select><select id="witchTarget">${poisonTargets}</select><button id="witchButton" class="button button-primary" type="button">提交女巫行動</button></div></div>`;
}

function genericActionHtml(prompt) {
  const targets = genericTargets(prompt.targetMode);
  const needsOne = !["none"].includes(prompt.targetMode);
  const needsTwo = String(prompt.targetMode).startsWith("two_");
  const optional = prompt.targetMode === "optional_alive_other";
  const optionSelect = prompt.options?.length ? `<label>技能模式<select id="roleOption">${prompt.options.map((value) => `<option value="${escapeAttr(value)}">${escapeHtml(optionLabel(value))}</option>`).join("")}</select></label>` : "";
  const first = needsOne ? `<label>目標 1<select id="roleTarget1">${optional ? '<option value="">不指定目標</option>' : ""}${targets.map((p) => optionFor(p.id)).join("")}</select></label>` : "";
  const second = needsTwo ? `<label>目標 2<select id="roleTarget2">${targets.map((p) => optionFor(p.id)).join("")}</select></label>` : "";
  const passButton = prompt.timing === "night" && prompt.oncePerGame ? '<button id="rolePassButton" class="button button-ghost" type="button">保留技能，本晚略過</button>' : "";
  return `<div class="skill-box role-skill"><div><span class="skill-label">${escapeHtml(prompt.label)} · ${escapeHtml(prompt.timing.toUpperCase())}</span><strong>${escapeHtml(roleName(prompt.role))}</strong><p>${escapeHtml(prompt.description)}</p></div><div class="role-action-fields">${optionSelect}${first}${second}<button id="roleActionButton" class="button button-secondary" type="button">提交角色技能</button>${passButton}</div></div>`;
}

function bindGenericRoleAction() {
  const button = $("#roleActionButton");
  if (!button || !state.roleAction) return;
  button.addEventListener("click", () => {
    const ids = [];
    const one = $("#roleTarget1")?.value;
    const two = $("#roleTarget2")?.value;
    if (one) ids.push(one);
    if (two) ids.push(two);
    if (ids.length === 2 && ids[0] === ids[1]) return showToast("兩個目標不能相同", true);
    send({ type: "role_action", effect: state.roleAction.effect, targetIds: ids, option: $("#roleOption")?.value || undefined });
  });
  $("#rolePassButton")?.addEventListener("click", () => send({ type: "role_action", effect: state.roleAction.effect, targetIds: [], option: "__pass__" }));
}

function genericTargets(mode) {
  if (mode === "one_dead") return formalPlayers().filter((p) => !p.alive);
  if (mode === "two_any") return formalPlayers().filter((p) => p.id !== state.me.id);
  let list = alivePlayers();
  if (["one_alive_other", "optional_alive_other", "two_alive_other"].includes(mode)) list = list.filter((p) => p.id !== state.me.id);
  if (mode === "one_alive_non_wolf") {
    const wolves = new Set([state.me.id, ...(state.me.wolfTeammates || [])]);
    list = list.filter((p) => !wolves.has(p.id));
  }
  return list;
}

function renderHostPanel() {
  const panel = $("#hostPanel");
  panel.classList.toggle("hidden", !state.me.isHost);
  if (!state.me.isHost) return;
  const lobby = state.phase === "lobby";
  panel.querySelectorAll("#settingsForm input, #settingsForm select, #roleSetupForm input, #zeroRoles").forEach((el) => { el.disabled = !lobby; });
  $("#settingsForm").elements.sheriffEnabled.checked = Boolean(state.settings.sheriffEnabled);
  $("#settingsForm").elements.deathInfo.value = state.settings.deathInfo;
  $("#settingsForm").elements.tieRule.value = state.settings.tieRule;
  renderRoleCatalog();
  $("#startButton").classList.toggle("hidden", !lobby);
  $("#startButton").disabled = !state.canStart;
  $("#resetButton").classList.toggle("hidden", state.phase !== "ended");
  $("#roleSetupError").textContent = state.roleSetupError || "";
  $("#roleSetupError").classList.toggle("hidden", !state.roleSetupError);
  renderPendingAI();
}

function renderRoleCatalog() {
  const box = $("#roleCatalog");
  if (!box) return;
  const query = $("#roleSearch").value.trim().toLowerCase();
  const groups = factionOrder.map((faction) => {
    const roles = roleList.filter((role) => role.faction === faction).filter((role) => roleMatches(role, query));
    if (!roles.length) return "";
    return `<section class="role-group" data-role-group="${faction}"><div class="role-group-head"><strong>${escapeHtml(factionNames[faction] || faction)}</strong><span>${roles.length} 種</span></div>${roles.map((role) => roleCard(role)).join("")}</section>`;
  }).join("");
  box.innerHTML = groups || '<p class="empty-state">沒有符合搜尋的角色。</p>';
  box.querySelectorAll("[data-role-count]").forEach((input) => input.addEventListener("input", updateRoleTotalFromInputs));
  updateRoleTotalFromInputs();
}

function roleCard(role) {
  const count = state.roleSetup?.[role.id] ?? 0;
  const adaptation = role.debateAdaptation ? `<small class="adaptation">辯論改寫：${escapeHtml(role.debateAdaptation)}</small>` : "";
  return `<article class="role-card" data-role-card="${role.id}"><div class="role-copy"><div class="role-title"><strong>${escapeHtml(role.name)}</strong><span>${role.source === "official" ? "原作" : role.source === "adapted" ? "辯論改寫" : "討論角色"}</span></div><p>${escapeHtml(role.summary)}</p>${adaptation}</div><label class="count-box"><span>數量</span><input data-role-count="${role.id}" type="number" min="0" step="1" value="${count}" /></label></article>`;
}

function filterRoleCatalog(query) { renderRoleCatalog(query); }
function roleMatches(role, query) {
  if (!query) return true;
  return `${role.name} ${role.id} ${role.summary} ${factionNames[role.faction] || role.faction} ${role.debateAdaptation || ""}`.toLowerCase().includes(query.toLowerCase());
}

function updateRoleTotalFromInputs() {
  const total = [...document.querySelectorAll("[data-role-count]")].reduce((sum, input) => sum + (Number.parseInt(input.value || "0", 10) || 0), 0);
  const formal = formalPlayers().length;
  $("#roleSetupTotal").textContent = `${total} / ${formal}`;
  $("#roleSetupTotal").classList.toggle("bad", total !== formal);
}

function renderPendingAI() {
  const box = $("#pendingAIBox");
  if (!state.pendingAI) return box.classList.add("hidden");
  const player = state.players.find((p) => p.id === state.pendingAI.playerId);
  const key = readAIKeys()[state.pendingAI.playerId];
  box.classList.remove("hidden");
  box.innerHTML = `<strong>AI 待辦：${escapeHtml(player?.name || "AI")}</strong><p>${escapeHtml(state.pendingAI.operation)} · ${key ? "本 session 已有 API Key" : "缺少 API Key，請重新加入該 AI 或在此瀏覽器設定"}</p><button id="runAIButton" class="button button-primary full" type="button" ${key ? "" : "disabled"}>執行這次 AI 操作</button>`;
  $("#runAIButton")?.addEventListener("click", async () => {
    try {
      await api(`/api/rooms/${roomId}/ai/run`, { method: "POST", body: { token: session.token, playerId: state.pendingAI.playerId, apiKey: key } });
      showToast("AI 操作已完成");
    } catch (error) { showError(error); }
  });
}

function renderLegacyPasswordUpgrade() {
  let panel = $("#legacyPasswordUpgrade");
  if (state.me.hasPassword || state.me.isSpectator && state.me.isAI) {
    panel?.remove();
    return;
  }
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "legacyPasswordUpgrade";
    panel.className = "panel legacy-password";
    document.querySelector(".game-main")?.prepend(panel);
  }
  panel.innerHTML = `<strong>這是升級前建立的人物，尚未設定人物密碼。</strong><p>為避免之後清除瀏覽器資料就無法找回，請現在設定至少 4 個字元的簡單密碼。</p><div class="action-line"><input id="legacyPasswordInput" type="password" minlength="4" maxlength="72" autocomplete="new-password" placeholder="設定人物密碼"><button id="legacyPasswordButton" class="button button-primary" type="button">設定密碼</button></div>`;
  $("#legacyPasswordButton")?.addEventListener("click", () => {
    const password = $("#legacyPasswordInput")?.value || "";
    if (password.trim().length < 4) return showToast("人物密碼至少 4 個字元", true);
    send({ type: "set_password", password });
  });
}

function renderNotice() {
  const notices = [];
  if (state.roleSetupError && state.me.isHost) notices.push(state.roleSetupError);
  if (state.me.isSpectator) notices.push("你是觀戰者：這局不能取得新角色，下一局才轉正式玩家。 ");
  if (state.phase === "night") notices.push("夜晚公開聊天室已暫停，避免資訊洩漏。 ");
  $("#noticePanel").textContent = notices.join("　");
  $("#noticePanel").classList.toggle("hidden", notices.length === 0);
}

function renderChatState() {
  const blocked = state.phase === "night" || (state.me.isSpectator && !["lobby", "ended"].includes(state.phase)) || (!state.me.alive && !["lobby", "ended"].includes(state.phase));
  $("#chatInput").disabled = blocked;
  $("#chatForm").querySelector("button").disabled = blocked;
  $("#chatStatus").textContent = blocked ? "本階段不可聊天" : "可自由聊天";
  $("#chatStatus").classList.toggle("blocked", blocked);
}

function formalPlayers() { return (state?.players || []).filter((p) => !p.isSpectator); }
function alivePlayers() { return formalPlayers().filter((p) => p.alive); }
function roleName(id) { return roleById.get(id)?.name || id; }
function nameOf(id) { return state?.players.find((p) => p.id === id)?.name || "未知玩家"; }
function optionFor(id) { return `<option value="${escapeAttr(id)}">${escapeHtml(nameOf(id))}</option>`; }
function tieRuleLabel(rule) { return ({ no_elimination: "平票無人出局", revote: "全場重投", pk_revote: "平票玩家 PK 後重投" })[rule] || rule; }
function optionLabel(value) { return ({ heal: "解藥", poison: "毒藥", pass: "跳過", nullify: "使技能失效", freeze: "凍結", detonate: "引爆凍結", day: "白陽祝福", night: "夜陰祝福", block: "封鎖技能", substitute: "死亡替換", village: "支持好人", werewolf: "支持狼人", spirit: "支持怨靈" })[value] || value; }

function send(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return showToast("WebSocket 尚未連線", true);
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

function roomIdFromPath() {
  const match = location.pathname.toUpperCase().match(/^\/([A-Z2-9]{6})\/?$/);
  return match?.[1] || null;
}
function normalizeRoomId(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z2-9]{6}$/.test(code) ? code : null;
}
function sessionKey(id) { return `werewolf-session:${id}`; }
function readSession(id) { try { return JSON.parse(localStorage.getItem(sessionKey(id)) || "null"); } catch { return null; } }
function saveSession(id, token, playerId) { localStorage.setItem(sessionKey(id), JSON.stringify({ roomId: id, token, playerId })); }
function setSession(id, token, playerId) { saveSession(id, token, playerId); session = { roomId: id, token, playerId }; }
function clearSession(id) { localStorage.removeItem(sessionKey(id)); }
function aiKeyStorageKey() { return `werewolf-ai-keys:${roomId || "none"}`; }
function readAIKeys() { try { return JSON.parse(sessionStorage.getItem(aiKeyStorageKey()) || "{}"); } catch { return {}; } }
function writeAIKeys(keys) { sessionStorage.setItem(aiKeyStorageKey(), JSON.stringify(keys)); }

function formatTime(value) { try { return new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)); } catch { return ""; } }
function showToast(message, isError = false) { toast.textContent = String(message); toast.classList.remove("hidden"); toast.classList.toggle("error", isError); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.add("hidden"), 3600); }
function showError(error) { showToast(error instanceof Error ? error.message : String(error), true); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[ch]); }
function escapeAttr(value) { return escapeHtml(value); }
