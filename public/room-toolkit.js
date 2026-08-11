(() => {
  const game = document.querySelector("#game");
  const players = document.querySelector("#players");
  const messages = document.querySelector("#messages");
  if (!game || !players || !messages) return;

  const STORAGE_PREFIX = "werewolf-room-toolkit:";
  const labels = {
    "zh-TW": {
      playerSearch: "搜尋玩家",
      playerPlaceholder: "名稱、標籤或身份…",
      playerFilter: "玩家篩選",
      all: "全部",
      alive: "存活",
      dead: "出局",
      ai: "AI",
      human: "真人",
      spectator: "觀戰",
      playerSort: "排序",
      defaultSort: "房內順序",
      nameSort: "名稱",
      statusSort: "狀態",
      clear: "清除篩選",
      shown: "顯示",
      messageSearch: "搜尋訊息",
      messagePlaceholder: "玩家、內容或翻譯文字…",
      messageFilter: "訊息類型",
      chat: "聊天",
      speech: "正式發言",
      system: "系統",
      role: "角色資訊",
      latest: "最新訊息",
      unread: "未讀",
      copyCode: "複製房號",
      share: "分享房間",
      copied: "房號已複製",
      linkCopied: "房間連結已複製",
      shareTitle: "狼人殺房間",
      compact: "精簡模式",
      normal: "一般模式",
      check: "連線檢查",
      checking: "檢查中…",
      online: "房間正常",
      offline: "房間暫時無法連線",
      latency: "延遲",
      synced: "最近同步",
      justNow: "剛剛",
      secondsAgo: "秒前",
      formal: "正式",
      aliveStat: "存活",
      aiStat: "AI",
      spectatorStat: "觀戰",
      roomTools: "房間工具",
      noMatch: "沒有符合篩選的項目",
      inspected: "查驗",
      hiddenInspection: "被隱藏"
    },
    "zh-CN": {
      playerSearch: "搜索玩家", playerPlaceholder: "名称、标签或身份…", playerFilter: "玩家筛选", all: "全部", alive: "存活", dead: "出局", ai: "AI", human: "真人", spectator: "观战", playerSort: "排序", defaultSort: "房内顺序", nameSort: "名称", statusSort: "状态", clear: "清除筛选", shown: "显示", messageSearch: "搜索消息", messagePlaceholder: "玩家、内容或翻译文字…", messageFilter: "消息类型", chat: "聊天", speech: "正式发言", system: "系统", role: "角色信息", latest: "最新消息", unread: "未读", copyCode: "复制房号", share: "分享房间", copied: "房号已复制", linkCopied: "房间链接已复制", shareTitle: "狼人杀房间", compact: "精简模式", normal: "一般模式", check: "连接检查", checking: "检查中…", online: "房间正常", offline: "房间暂时无法连接", latency: "延迟", synced: "最近同步", justNow: "刚刚", secondsAgo: "秒前", formal: "正式", aliveStat: "存活", aiStat: "AI", spectatorStat: "观战", roomTools: "房间工具", noMatch: "没有符合筛选的项目", inspected: "查验", hiddenInspection: "被隐藏"
    },
    en: {
      playerSearch: "Search players", playerPlaceholder: "Name, tag, or role…", playerFilter: "Player filter", all: "All", alive: "Alive", dead: "Out", ai: "AI", human: "Human", spectator: "Spectator", playerSort: "Sort", defaultSort: "Room order", nameSort: "Name", statusSort: "Status", clear: "Clear filters", shown: "Shown", messageSearch: "Search messages", messagePlaceholder: "Player, content, or translated text…", messageFilter: "Message type", chat: "Chat", speech: "Formal speech", system: "System", role: "Role info", latest: "Latest", unread: "unread", copyCode: "Copy code", share: "Share room", copied: "Room code copied", linkCopied: "Room link copied", shareTitle: "Werewolf room", compact: "Compact mode", normal: "Normal mode", check: "Connection check", checking: "Checking…", online: "Room reachable", offline: "Room unreachable", latency: "Latency", synced: "Last sync", justNow: "just now", secondsAgo: "s ago", formal: "Formal", aliveStat: "Alive", aiStat: "AI", spectatorStat: "Spectators", roomTools: "Room tools", noMatch: "No matching items", inspected: "Checked", hiddenInspection: "Hidden"
    }
  };

  const languageSelect = document.querySelector("#languageSelect");
  const playerCard = players.closest(".players-card");
  const chatCard = messages.closest(".chat-card");
  const roomBanner = document.querySelector(".room-banner");
  const roomCodeRow = document.querySelector(".room-code-row");
  let lastMutationAt = Date.now();
  let lastMessageCount = 0;
  let unreadCount = 0;
  let playerApplying = false;
  let inspectionTimer = null;
  let inspectionRequestSeq = 0;
  let inspectionView = null;
  let roleLabels = new Map();
  let roleNames = new Set();

  injectInspectionStyle();
  injectPlayerTools();
  injectMessageTools();
  injectRoomTools();
  bindEvents();
  applyCompactPreference();
  localize();
  applyPlayerView();
  applyMessageView();
  updateStats();
  updateLatestButton();
  scheduleInspectionRefresh(0);

  const playerObserver = new MutationObserver(() => {
    if (playerApplying) return;
    markSynced();
    applyPlayerView();
    updateStats();
    scheduleInspectionRefresh(30);
  });
  playerObserver.observe(players, { childList: true, subtree: false });

  const messageObserver = new MutationObserver(() => {
    markSynced();
    const count = messages.children.length;
    if (count > lastMessageCount && !nearBottom(messages)) unreadCount += count - lastMessageCount;
    lastMessageCount = count;
    applyMessageView();
    updateLatestButton();
  });
  messageObserver.observe(messages, { childList: true, subtree: false });
  lastMessageCount = messages.children.length;

  messages.addEventListener("scroll", () => {
    if (nearBottom(messages)) {
      unreadCount = 0;
      updateLatestButton();
    }
  }, { passive: true });

  window.addEventListener("online", updateNetworkBadge);
  window.addEventListener("offline", updateNetworkBadge);
  languageSelect?.addEventListener("change", () => setTimeout(() => { localize(); applyPlayerView(); applyMessageView(); updateStats(); renderInspectionBadges(); }, 0));
  setInterval(updateSyncAge, 5_000);
  updateNetworkBadge();

  function locale() {
    const value = localStorage.getItem("werewolf-locale") || languageSelect?.value;
    return value === "zh-CN" || value === "en" ? value : "zh-TW";
  }

  function t(key) { return labels[locale()]?.[key] ?? labels["zh-TW"][key] ?? key; }

  function injectInspectionStyle() {
    if (document.querySelector("#roomInspectionBadgeStyle")) return;
    const style = document.createElement("style");
    style.id = "roomInspectionBadgeStyle";
    style.textContent = `
      .pill.private-inspection { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 800; }
      .pill.private-inspection::before { content: "◆"; font-size: .7em; margin-right: 3px; }
      .room-compact-mode .pill.private-inspection { max-width: 150px; }
      @media (max-width: 680px) { .pill.private-inspection { max-width: 160px; } }
    `;
    document.head.append(style);
  }

  function injectPlayerTools() {
    if (!playerCard || document.querySelector("#roomPlayerTools")) return;
    const tools = document.createElement("div");
    tools.id = "roomPlayerTools";
    tools.className = "room-toolkit player-toolkit";
    tools.innerHTML = `
      <input id="roomPlayerSearch" type="search" maxlength="60" />
      <select id="roomPlayerFilter">
        <option value="all"></option><option value="alive"></option><option value="dead"></option><option value="ai"></option><option value="human"></option><option value="spectator"></option>
      </select>
      <select id="roomPlayerSort">
        <option value="default"></option><option value="name"></option><option value="status"></option>
      </select>
      <button id="roomPlayerClear" class="icon-button" type="button"></button>
      <span id="roomPlayerCount" class="room-toolkit-count"></span>`;
    playerCard.querySelector(".section-heading")?.after(tools);
  }

  function injectMessageTools() {
    if (!chatCard || document.querySelector("#roomMessageTools")) return;
    const tools = document.createElement("div");
    tools.id = "roomMessageTools";
    tools.className = "room-toolkit message-toolkit";
    tools.innerHTML = `
      <input id="roomMessageSearch" type="search" maxlength="100" />
      <select id="roomMessageFilter">
        <option value="all"></option><option value="chat"></option><option value="speech"></option><option value="system"></option><option value="role"></option>
      </select>
      <button id="roomJumpLatest" class="icon-button" type="button"></button>`;
    messages.before(tools);
  }

  function injectRoomTools() {
    if (roomCodeRow && !document.querySelector("#roomCopyCode")) {
      const copy = document.createElement("button");
      copy.id = "roomCopyCode";
      copy.className = "icon-button";
      copy.type = "button";
      const share = document.createElement("button");
      share.id = "roomShare";
      share.className = "icon-button";
      share.type = "button";
      roomCodeRow.append(copy, share);
    }
    if (!roomBanner || document.querySelector("#roomQuickTools")) return;
    const tools = document.createElement("section");
    tools.id = "roomQuickTools";
    tools.className = "panel room-quick-tools";
    tools.innerHTML = `
      <div class="room-toolkit-stat"><span data-tool-label="formal"></span><strong id="roomFormalCount">0</strong></div>
      <div class="room-toolkit-stat"><span data-tool-label="aliveStat"></span><strong id="roomAliveCount">0</strong></div>
      <div class="room-toolkit-stat"><span data-tool-label="aiStat"></span><strong id="roomAICount">0</strong></div>
      <div class="room-toolkit-stat"><span data-tool-label="spectatorStat"></span><strong id="roomSpectatorCount">0</strong></div>
      <div class="room-toolkit-sync"><span id="roomNetworkBadge" class="status-dot"></span><small id="roomLastSync"></small></div>
      <div class="room-toolkit-actions"><button id="roomConnectionCheck" class="icon-button" type="button"></button><button id="roomCompactToggle" class="icon-button" type="button"></button></div>`;
    roomBanner.after(tools);
  }

  function bindEvents() {
    document.querySelector("#roomPlayerSearch")?.addEventListener("input", applyPlayerView);
    document.querySelector("#roomPlayerFilter")?.addEventListener("change", applyPlayerView);
    document.querySelector("#roomPlayerSort")?.addEventListener("change", applyPlayerView);
    document.querySelector("#roomPlayerClear")?.addEventListener("click", () => {
      document.querySelector("#roomPlayerSearch").value = "";
      document.querySelector("#roomPlayerFilter").value = "all";
      document.querySelector("#roomPlayerSort").value = "default";
      applyPlayerView();
    });
    document.querySelector("#roomMessageSearch")?.addEventListener("input", applyMessageView);
    document.querySelector("#roomMessageFilter")?.addEventListener("change", applyMessageView);
    document.querySelector("#roomJumpLatest")?.addEventListener("click", () => {
      messages.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });
      unreadCount = 0;
      updateLatestButton();
    });
    document.querySelector("#roomCopyCode")?.addEventListener("click", copyRoomCode);
    document.querySelector("#roomShare")?.addEventListener("click", shareRoom);
    document.querySelector("#roomConnectionCheck")?.addEventListener("click", checkConnection);
    document.querySelector("#roomCompactToggle")?.addEventListener("click", toggleCompact);
  }

  function applyPlayerView() {
    const search = String(document.querySelector("#roomPlayerSearch")?.value || "").trim().toLocaleLowerCase();
    const filter = document.querySelector("#roomPlayerFilter")?.value || "all";
    const sort = document.querySelector("#roomPlayerSort")?.value || "default";
    const rows = [...players.querySelectorAll(":scope > .player-row")];
    const decorated = rows.map((row, index) => ({ row, index, name: playerName(row), status: playerStatusRank(row) }));
    if (sort === "name") decorated.sort((a, b) => a.name.localeCompare(b.name, locale()) || a.index - b.index);
    if (sort === "status") decorated.sort((a, b) => a.status - b.status || a.name.localeCompare(b.name, locale()) || a.index - b.index);
    if (sort !== "default" && decorated.some((item, index) => item.row !== rows[index])) {
      playerApplying = true;
      for (const item of decorated) players.append(item.row);
      queueMicrotask(() => { playerApplying = false; });
    }
    let shown = 0;
    for (const { row } of decorated) {
      const text = row.textContent.toLocaleLowerCase();
      const dead = row.classList.contains("is-dead") && !row.querySelector(".pill.spectator");
      const spectator = Boolean(row.querySelector(".pill.spectator"));
      const ai = Boolean(row.querySelector(".pill.ai"));
      const alive = !dead && !spectator;
      const matchesFilter = filter === "all" || (filter === "alive" && alive) || (filter === "dead" && dead) || (filter === "ai" && ai) || (filter === "human" && !ai) || (filter === "spectator" && spectator);
      const visible = (!search || text.includes(search)) && matchesFilter;
      row.classList.toggle("room-toolkit-hidden", !visible);
      if (visible) shown += 1;
    }
    const count = document.querySelector("#roomPlayerCount");
    if (count) count.textContent = `${t("shown")} ${shown}/${rows.length}`;
  }

  function scheduleInspectionRefresh(delay = 40) {
    clearTimeout(inspectionTimer);
    inspectionTimer = setTimeout(refreshPrivateInspections, delay);
  }

  async function refreshPrivateInspections() {
    const code = roomCode();
    const session = roomSession(code);
    if (!code || !session?.token || !players.children.length) return;
    const seq = ++inspectionRequestSeq;
    try {
      const [stateResponse] = await Promise.all([
        fetch(`/api/rooms/${code}/state?token=${encodeURIComponent(session.token)}`, { cache: "no-store" }),
        ensureRoleLabels()
      ]);
      if (!stateResponse.ok) return;
      const next = await stateResponse.json();
      if (seq !== inspectionRequestSeq || !next?.me || !Array.isArray(next.players)) return;
      inspectionView = next;
      renderInspectionBadges();
    } catch { /* private inspection decoration must never block the room UI */ }
  }

  async function ensureRoleLabels() {
    if (roleLabels.size) return;
    try {
      const response = await fetch("/api/roles", { cache: "force-cache" });
      if (!response.ok) return;
      const data = await response.json();
      const roles = Array.isArray(data.roles) ? data.roles : [];
      roleLabels = new Map(roles.map((role) => [String(role.id), String(role.name || role.id)]));
      roleNames = new Set(roles.map((role) => String(role.name || "")).filter(Boolean));
    } catch { /* role ids remain readable as a fallback */ }
  }

  function renderInspectionBadges() {
    players.querySelectorAll(".pill.private-inspection").forEach((node) => node.remove());
    const view = inspectionView;
    if (!view?.me || !Array.isArray(view.players)) return;
    const rowsByName = new Map([...players.querySelectorAll(":scope > .player-row")].map((row) => [playerName(row), row]));
    for (const player of view.players) {
      const values = inspectionValuesFor(player);
      if (!values.length) continue;
      const row = rowsByName.get(String(player.name || ""));
      const nameBox = row?.querySelector(".player-name");
      if (!nameBox) continue;
      for (const value of values) {
        const badge = document.createElement("span");
        badge.className = "pill private-inspection";
        badge.dataset.noTranslate = "";
        badge.title = `${t("inspected")}：${value}`;
        badge.textContent = value;
        nameBox.append(badge);
      }
    }
    applyPlayerView();
  }

  function inspectionValuesFor(player) {
    const out = [];
    const faction = inspectionView?.me?.seerResults?.[player.id];
    if (faction) out.push(factionInspectionLabel(faction));

    const results = inspectionView?.me?.roleResults || {};
    const direct = results[player.id];
    const captain = results[`role:${player.id}`];
    const directLabel = identityResultLabel(direct);
    const captainLabel = captainIdentityLabel(captain, player.name);
    if (directLabel) out.push(directLabel);
    if (captainLabel) out.push(captainLabel);
    return [...new Set(out.filter(Boolean))];
  }

  function factionInspectionLabel(value) {
    if (value === "hidden") return t("hiddenInspection");
    const names = {
      "zh-TW": { village: "好人陣營", werewolf: "狼人陣營", spirit: "怨靈陣營", neutral: "特殊／第三方", blood: "血族陣營" },
      "zh-CN": { village: "好人阵营", werewolf: "狼人阵营", spirit: "怨灵阵营", neutral: "特殊／第三方", blood: "血族阵营" },
      en: { village: "Village", werewolf: "Werewolf", spirit: "Spirit", neutral: "Neutral", blood: "Blood" }
    };
    return names[locale()]?.[value] || String(value);
  }

  function identityResultLabel(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    const raw = value.trim();
    if (raw === "被隱藏" || raw === "被隐藏") return t("hiddenInspection");
    if (roleLabels.has(raw)) return roleLabels.get(raw);
    if (roleNames.has(raw)) return raw;
    for (const prefix of ["被放逐者陣營：", "被放逐者阵营：", "上一夜狼刀死者職業：", "上一夜狼刀死者职业："]) {
      if (raw.startsWith(prefix)) return raw.slice(prefix.length).trim();
    }
    if (["不是吸血狼", "查到偽狼／叛狼", "查到伪狼／叛狼", "不是偽狼／叛狼", "不是伪狼／叛狼"].includes(raw)) return raw;
    return "";
  }

  function captainIdentityLabel(value, playerNameValue) {
    if (typeof value !== "string" || !value.trim()) return "";
    const raw = value.trim();
    const prefixes = [`${playerNameValue}：`, `${playerNameValue}:`];
    const prefix = prefixes.find((item) => raw.startsWith(item));
    const role = prefix ? raw.slice(prefix.length).trim() : "";
    if (!role) return "";
    return roleLabels.get(role) || role;
  }

  function roomSession(code) {
    if (!code) return null;
    try { return JSON.parse(localStorage.getItem(`werewolf-session:${code}`) || "null"); }
    catch { return null; }
  }

  function applyMessageView() {
    const search = String(document.querySelector("#roomMessageSearch")?.value || "").trim().toLocaleLowerCase();
    const filter = document.querySelector("#roomMessageFilter")?.value || "all";
    for (const message of messages.querySelectorAll(":scope > .message")) {
      const kind = [...message.classList].find((name) => name.startsWith("message-"))?.slice(8) || "chat";
      const visible = (filter === "all" || kind === filter) && (!search || message.textContent.toLocaleLowerCase().includes(search));
      message.classList.toggle("room-toolkit-hidden", !visible);
    }
  }

  function updateStats() {
    const rows = [...players.querySelectorAll(":scope > .player-row")];
    const spectator = rows.filter((row) => row.querySelector(".pill.spectator")).length;
    const ai = rows.filter((row) => row.querySelector(".pill.ai")).length;
    const formal = rows.length - spectator;
    const alive = rows.filter((row) => !row.classList.contains("is-dead") && !row.querySelector(".pill.spectator")).length;
    setText("#roomFormalCount", formal);
    setText("#roomAliveCount", alive);
    setText("#roomAICount", ai);
    setText("#roomSpectatorCount", spectator);
  }

  function playerName(row) { return String(row.querySelector(".player-name strong")?.textContent || "").trim(); }
  function playerStatusRank(row) {
    if (row.querySelector(".pill.speaker")) return 0;
    if (row.querySelector(".pill.host")) return 1;
    if (row.querySelector(".pill.sheriff")) return 2;
    if (row.querySelector(".pill.spectator")) return 5;
    if (row.classList.contains("is-dead")) return 6;
    return 3;
  }

  async function copyRoomCode() {
    const code = roomCode();
    if (!code) return;
    try { await navigator.clipboard.writeText(code); toast(t("copied")); }
    catch { fallbackCopy(code); toast(t("copied")); }
  }

  async function shareRoom() {
    const code = roomCode();
    if (!code) return;
    const url = `${location.origin}/${code}`;
    if (navigator.share) {
      try { await navigator.share({ title: t("shareTitle"), text: `${t("shareTitle")} ${code}`, url }); return; }
      catch (error) { if (error?.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); }
    catch { fallbackCopy(url); }
    toast(t("linkCopied"));
  }

  async function checkConnection() {
    const button = document.querySelector("#roomConnectionCheck");
    const code = roomCode();
    if (!button || !code) return;
    button.disabled = true;
    button.textContent = t("checking");
    const started = performance.now();
    try {
      const response = await fetch(`/api/rooms/${code}/info`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await response.json();
      const latency = Math.max(0, Math.round(performance.now() - started));
      const badge = document.querySelector("#roomNetworkBadge");
      if (badge) { badge.textContent = `${t("online")} · ${t("latency")} ${latency}ms`; badge.classList.remove("blocked"); }
      markSynced();
    } catch {
      const badge = document.querySelector("#roomNetworkBadge");
      if (badge) { badge.textContent = t("offline"); badge.classList.add("blocked"); }
    } finally {
      button.disabled = false;
      button.textContent = t("check");
    }
  }

  function updateNetworkBadge() {
    const badge = document.querySelector("#roomNetworkBadge");
    if (!badge) return;
    badge.textContent = navigator.onLine ? t("online") : t("offline");
    badge.classList.toggle("blocked", !navigator.onLine);
  }

  function toggleCompact() {
    const enabled = !document.body.classList.contains("room-compact-mode");
    document.body.classList.toggle("room-compact-mode", enabled);
    localStorage.setItem(`${STORAGE_PREFIX}compact`, enabled ? "1" : "0");
    localize();
  }

  function applyCompactPreference() {
    document.body.classList.toggle("room-compact-mode", localStorage.getItem(`${STORAGE_PREFIX}compact`) === "1");
  }

  function markSynced() { lastMutationAt = Date.now(); updateSyncAge(); }
  function updateSyncAge() {
    const node = document.querySelector("#roomLastSync");
    if (!node) return;
    const seconds = Math.max(0, Math.floor((Date.now() - lastMutationAt) / 1000));
    node.textContent = `${t("synced")}：${seconds < 2 ? t("justNow") : `${seconds}${t("secondsAgo")}`}`;
  }

  function updateLatestButton() {
    const button = document.querySelector("#roomJumpLatest");
    if (!button) return;
    button.textContent = unreadCount > 0 ? `${t("latest")} · ${unreadCount} ${t("unread")}` : t("latest");
    button.classList.toggle("room-has-unread", unreadCount > 0);
  }

  function localize() {
    const search = document.querySelector("#roomPlayerSearch"); if (search) search.placeholder = t("playerPlaceholder");
    const msgSearch = document.querySelector("#roomMessageSearch"); if (msgSearch) msgSearch.placeholder = t("messagePlaceholder");
    setOptionLabels("#roomPlayerFilter", ["all", "alive", "dead", "ai", "human", "spectator"]);
    setOptionLabels("#roomPlayerSort", ["defaultSort", "nameSort", "statusSort"]);
    setOptionLabels("#roomMessageFilter", ["all", "chat", "speech", "system", "role"]);
    setText("#roomPlayerClear", t("clear"));
    setText("#roomCopyCode", t("copyCode"));
    setText("#roomShare", t("share"));
    setText("#roomConnectionCheck", t("check"));
    setText("#roomCompactToggle", document.body.classList.contains("room-compact-mode") ? t("normal") : t("compact"));
    document.querySelectorAll("[data-tool-label]").forEach((node) => { node.textContent = t(node.dataset.toolLabel); });
    updateLatestButton();
    updateSyncAge();
    updateNetworkBadge();
  }

  function setOptionLabels(selector, keys) {
    const select = document.querySelector(selector);
    if (!select) return;
    [...select.options].forEach((option, index) => { option.textContent = t(keys[index]); });
  }
  function setText(selector, value) { const node = document.querySelector(selector); if (node) node.textContent = String(value); }
  function nearBottom(box) { return box.scrollHeight - box.scrollTop - box.clientHeight < 90; }
  function roomCode() { return String(document.querySelector("#roomCode")?.textContent || location.pathname.match(/^\/([A-Z2-9]{6})\/?$/i)?.[1] || "").trim().toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6); }
  function fallbackCopy(value) { const area = document.createElement("textarea"); area.value = value; area.style.position = "fixed"; area.style.opacity = "0"; document.body.append(area); area.select(); document.execCommand("copy"); area.remove(); }
  function toast(message) { const box = document.querySelector("#toast"); if (!box) return; box.textContent = String(message); box.classList.remove("hidden"); clearTimeout(toast.timer); toast.timer = setTimeout(() => box.classList.add("hidden"), 3200); }
})();