(() => {
  const TOKEN_KEY = "werewolf-admin-token";
  const DISBAND_SENTINEL = "__disband_room__";
  const nativeFetch = window.fetch.bind(window);
  const snapshots = new Map();
  let decorating = false;

  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    try {
      const requestUrl = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      const url = new URL(requestUrl, location.href);
      const match = url.pathname.match(/^\/api\/admin\/rooms\/([A-Z2-9]{6})$/);
      if (response.ok && match) {
        const data = await response.clone().json();
        snapshots.set(match[1], data);
        queueDecoration();
      }
    } catch { /* best effort UI decoration */ }
    return response;
  };

  const observer = new MutationObserver(queueDecoration);
  const start = () => {
    const detail = document.querySelector("#adminRoomDetail");
    if (detail) observer.observe(detail, { childList: true, subtree: true });
    queueDecoration();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  function queueDecoration() {
    if (decorating) return;
    decorating = true;
    queueMicrotask(() => {
      try { decorateRoomDetail(); }
      finally { decorating = false; }
    });
  }

  function decorateRoomDetail() {
    const detail = document.querySelector("#adminRoomDetail");
    if (!detail || detail.classList.contains("admin-empty")) return;
    const roomId = selectedRoomId(detail);
    if (!roomId) return;
    const snapshot = snapshots.get(roomId);

    const actions = detail.querySelector(".admin-detail-actions");
    if (actions && !actions.querySelector("[data-admin-disband]") ) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button compact admin-disband-button";
      button.dataset.adminDisband = roomId;
      button.textContent = text("解散房間");
      button.addEventListener("click", () => disbandRoom(roomId));
      actions.append(button);
    }

    if (!snapshot || snapshot.phase === "lobby" || !Array.isArray(snapshot.players)) return;
    const rows = [...detail.querySelectorAll(".admin-player")];
    rows.forEach((row, index) => {
      const player = snapshot.players[index];
      if (!player || row.querySelector(".admin-player-role-meta")) return;
      const copy = row.querySelector(".admin-player-copy");
      if (!copy) return;
      const meta = document.createElement("div");
      meta.className = "admin-player-role-meta";
      const chips = [];
      if (player.roleName || player.role) chips.push(chip(`${text("職位")}：${player.roleName || player.role}`, "primary"));
      if (player.mechanicalFaction) chips.push(chip(`${text("機械陣營")}：${factionLabel(player.mechanicalFaction)}`, "faction"));
      if (player.winningAllegiance) chips.push(chip(`${text("勝利歸屬")}：${factionLabel(player.winningAllegiance)}`));
      if (Array.isArray(player.addonRoles) && player.addonRoles.length) chips.push(chip(`Addon：${player.addonRoles.join("、")}`));
      if (Array.isArray(player.loverGroupIds) && player.loverGroupIds.length) chips.push(chip(`CP：${player.loverGroupIds.map((id) => playerName(snapshot, id)).join("、")}`));
      meta.innerHTML = chips.join("");
      copy.append(meta);
    });
  }

  async function disbandRoom(roomId) {
    const confirmed = window.confirm(`${text("確定解散房間")} ${roomId}？\n${text("解散後房間狀態會永久刪除，所有連線也會中斷。")}`);
    if (!confirmed) return;
    try {
      await adminRequest(`/api/admin/rooms/${roomId}/kick`, { method: "POST", body: { playerId: DISBAND_SENTINEL } });
      snapshots.delete(roomId);
      showToast(`${roomId} ${text("已解散")}`);
      document.querySelector("#refreshAdmin")?.click();
      const detail = document.querySelector("#adminRoomDetail");
      if (detail) {
        detail.className = "admin-empty";
        detail.textContent = text("選擇一個房間查看。");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), true);
    }
  }

  async function adminRequest(path, options = {}) {
    const token = sessionStorage.getItem(TOKEN_KEY) || "";
    if (!token) throw new Error(text("管理員 Token 無效"));
    const response = await nativeFetch(path, {
      method: options.method || "GET",
      headers: { authorization: `Bearer ${token}`, ...(options.body ? { "content-type": "application/json" } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  function selectedRoomId(detail) {
    const value = String(detail.querySelector(".admin-room-meta strong")?.textContent || "").trim().toUpperCase();
    return /^[A-Z2-9]{6}$/.test(value) ? value : "";
  }

  function playerName(snapshot, id) {
    return snapshot.players.find((player) => player.id === id)?.name || id;
  }

  function chip(value, extra = "") {
    return `<span class="admin-role-chip ${extra}">${escapeHtml(value)}</span>`;
  }

  function factionLabel(value) {
    const labels = {
      village: ["好人", "好人", "Village"],
      werewolf: ["狼人", "狼人", "Werewolf"],
      spirit: ["靈體", "灵体", "Spirit"],
      neutral: ["中立", "中立", "Neutral"],
      blood: ["血族", "血族", "Blood"]
    };
    const item = labels[value];
    return item ? item[localeIndex()] : String(value || "—");
  }

  function localeIndex() {
    const locale = localStorage.getItem("werewolf-locale") || document.querySelector("#languageSelect")?.value;
    return locale === "zh-CN" ? 1 : locale === "en" ? 2 : 0;
  }

  const COPY = {
    "解散房間": ["解散房間", "解散房间", "Disband room"],
    "確定解散房間": ["確定解散房間", "确定解散房间", "Disband room"],
    "解散後房間狀態會永久刪除，所有連線也會中斷。": ["解散後房間狀態會永久刪除，所有連線也會中斷。", "解散后房间状态会永久删除，所有连接也会中断。", "This permanently deletes the room state and disconnects all clients."],
    "已解散": ["已解散", "已解散", "disbanded"],
    "職位": ["職位", "职位", "Role"],
    "機械陣營": ["機械陣營", "机械阵营", "Mechanical faction"],
    "勝利歸屬": ["勝利歸屬", "胜利归属", "Winning allegiance"],
    "選擇一個房間查看。": ["選擇一個房間查看。", "选择一个房间查看。", "Select a room to inspect."],
    "管理員 Token 無效": ["管理員 Token 無效", "管理员 Token 无效", "Invalid admin token"]
  };

  function text(key) {
    const item = COPY[key];
    return item ? item[localeIndex()] : key;
  }

  function showToast(message, error = false) {
    const toast = document.querySelector("#adminToast");
    if (!toast) return;
    toast.textContent = String(message);
    toast.classList.remove("hidden");
    toast.classList.toggle("error", error);
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.add("hidden"), 4200);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[ch]);
  }
})();
