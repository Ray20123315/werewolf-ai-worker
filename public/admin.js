import { getLocale, intlLocale, knownText, localizeDom, setLocale, siteTitle } from "./i18n.js";

const $ = (selector) => document.querySelector(selector);
const TOKEN_KEY = "werewolf-admin-token";
let adminToken = sessionStorage.getItem(TOKEN_KEY) || "";
let overview = null;
let rooms = [];
let errors = [];
let selectedRoom = null;

const languageSelect = $("#languageSelect");
languageSelect.value = getLocale();
languageSelect.addEventListener("change", async (event) => {
  setLocale(event.target.value);
  await localizeDom(document);
  renderAll();
});
document.title = `${knownText("管理後台")} · ${siteTitle()}`;
await localizeDom(document);

$("#adminLoginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const token = String(form.get("token") || "").trim();
  if (!token) return;
  adminToken = token;
  try {
    await adminApi("/api/admin/overview");
    sessionStorage.setItem(TOKEN_KEY, token);
    showDashboard();
    await refreshAll();
  } catch (error) {
    adminToken = "";
    sessionStorage.removeItem(TOKEN_KEY);
    showToast(error instanceof Error ? error.message : String(error), true);
  }
});

$("#refreshAdmin").addEventListener("click", refreshAll);
$("#logoutAdmin").addEventListener("click", () => {
  adminToken = "";
  sessionStorage.removeItem(TOKEN_KEY);
  overview = null; rooms = []; errors = []; selectedRoom = null;
  $("#adminDashboard").classList.add("hidden");
  $("#adminLogin").classList.remove("hidden");
});

$("#registerRoomForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const roomId = String(form.get("roomId") || "").trim().toUpperCase();
  try {
    await adminApi("/api/admin/rooms/register", { method: "POST", body: { roomId } });
    event.currentTarget.reset();
    showToast(`${roomId} ${knownText("加入追蹤")}`);
    await refreshAll();
  } catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
});

if (adminToken) {
  try { await adminApi("/api/admin/overview"); showDashboard(); await refreshAll(); }
  catch { adminToken = ""; sessionStorage.removeItem(TOKEN_KEY); }
}

function showDashboard() {
  $("#adminLogin").classList.add("hidden");
  $("#adminDashboard").classList.remove("hidden");
}

async function refreshAll() {
  try {
    [overview, rooms, { errors }] = await Promise.all([
      adminApi("/api/admin/overview"),
      loadAllTrackedRooms(),
      adminApi("/api/admin/errors?limit=200")
    ]);
    renderAll();
    if (selectedRoom?.roomId) await openRoom(selectedRoom.roomId);
  } catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
}

function renderAll() {
  if (!overview) return;
  document.title = `${knownText("管理後台")} · ${siteTitle()}`;
  $("#adminRoomCount").textContent = String(overview.roomCount ?? rooms.length);
  $("#adminTranslationState").textContent = knownText(overview.translationConfigured ? "已設定" : "未設定");
  $("#adminErrorCount").textContent = String(errors.length);
  renderRooms();
  renderErrors();
  renderRoomDetail();
}

function renderRooms() {
  const body = $("#adminRoomsBody");
  body.innerHTML = rooms.length ? rooms.map((room) => `<tr><td data-no-translate><strong>${escapeHtml(room.roomId)}</strong></td><td>${escapeHtml(formatTime(room.firstSeenAt))}</td><td>${escapeHtml(formatTime(room.lastSeenAt))}</td><td><button class="button button-ghost compact" data-open-room="${escapeAttr(room.roomId)}" type="button">${escapeHtml(knownText("查看"))}</button></td></tr>`).join("") : `<tr><td colspan="4" class="admin-empty">—</td></tr>`;
  body.querySelectorAll("[data-open-room]").forEach((button) => button.addEventListener("click", () => openRoom(button.dataset.openRoom)));
}

function renderErrors() {
  const body = $("#adminErrorsBody");
  body.innerHTML = errors.length ? errors.map((error) => `<tr><td>${escapeHtml(formatTime(error.createdAt))}</td><td data-no-translate>${escapeHtml(error.roomId || "—")}</td><td>${escapeHtml(error.category)}</td><td>${escapeHtml(error.source)}</td><td title="${escapeAttr(error.detail || "")}">${escapeHtml(error.message)}</td></tr>`).join("") : `<tr><td colspan="5" class="admin-empty">—</td></tr>`;
}

async function openRoom(roomId) {
  try {
    selectedRoom = await adminApi(`/api/admin/rooms/${roomId}`);
    renderRoomDetail();
  } catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
}

function renderRoomDetail() {
  const box = $("#adminRoomDetail");
  if (!selectedRoom) { box.className = "admin-empty"; box.textContent = "—"; return; }
  box.className = "";
  const room = selectedRoom;
  box.innerHTML = `<div class="admin-room-meta">
    <div><span>${escapeHtml(knownText("房號"))}</span><strong data-no-translate>${escapeHtml(room.roomId)}</strong></div>
    <div><span>${escapeHtml(knownText("階段"))}</span><strong>${escapeHtml(room.phase)}</strong></div>
    <div><span>${escapeHtml(knownText("玩家"))}</span><strong>${escapeHtml(room.playerCount)}</strong></div>
    <div><span>${escapeHtml(knownText("連線"))}</span><strong>${escapeHtml(room.websocketCount)}</strong></div>
  </div>
  <div class="admin-player-list">${(room.players || []).map((player) => adminPlayerHtml(player)).join("")}</div>
  <form id="adminNoticeForm" class="admin-notice-form"><label>${escapeHtml(knownText("系統公告"))}<input name="content" maxlength="300" required /></label><button class="button button-secondary" type="submit">${escapeHtml(knownText("發送公告"))}</button></form>`;
  box.querySelectorAll("[data-admin-kick]").forEach((button) => button.addEventListener("click", async () => {
    try { await adminApi(`/api/admin/rooms/${room.roomId}/kick`, { method: "POST", body: { playerId: button.dataset.adminKick } }); await openRoom(room.roomId); await refreshRoomListOnly(); }
    catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
  }));
  box.querySelectorAll("[data-admin-moderator]").forEach((button) => button.addEventListener("click", async () => {
    try { await adminApi(`/api/admin/rooms/${room.roomId}/moderator`, { method: "POST", body: { playerId: button.dataset.adminModerator, enabled: button.dataset.enabled === "true" } }); await openRoom(room.roomId); }
    catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
  }));
  $("#adminNoticeForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try { await adminApi(`/api/admin/rooms/${room.roomId}/notice`, { method: "POST", body: { content: form.get("content") } }); event.currentTarget.reset(); showToast(knownText("發送公告")); await openRoom(room.roomId); }
    catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
  });
}

function adminPlayerHtml(player) {
  const tags = [player.isHost ? knownText("房主") : "", player.isModerator ? knownText("管理員") : "", player.isAI ? "AI" : "", player.isSpectator ? knownText("觀戰") : "", !player.alive && !player.isSpectator ? knownText("出局") : ""].filter(Boolean).join(" · ");
  const actions = player.isHost ? "" : `<div class="admin-player-actions">${!player.isAI ? `<button class="button button-ghost compact" data-admin-moderator="${escapeAttr(player.id)}" data-enabled="${player.isModerator ? "false" : "true"}" type="button">${escapeHtml(knownText(player.isModerator ? "取消管理員" : "設為管理員"))}</button>` : ""}<button class="button button-ghost compact" data-admin-kick="${escapeAttr(player.id)}" type="button">${escapeHtml(knownText("踢出"))}</button></div>`;
  return `<div class="admin-player"><div class="admin-player-copy"><strong data-no-translate>${escapeHtml(player.name)}</strong><small>${escapeHtml(tags || "—")}</small></div>${actions}</div>`;
}

async function loadAllTrackedRooms() {
  const all = [];
  let offset = 0;
  const limit = 250;
  for (;;) {
    const result = await adminApi(`/api/admin/rooms?limit=${limit}&offset=${offset}`);
    const page = Array.isArray(result.rooms) ? result.rooms : [];
    all.push(...page);
    offset += page.length;
    if (page.length < limit || offset >= Number(result.total || 0)) break;
  }
  return all;
}

async function refreshRoomListOnly() {
  rooms = await loadAllTrackedRooms();
  renderRooms();
}

async function adminApi(path, options = {}) {
  if (!adminToken) throw new Error("管理員 Token 無效");
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: { authorization: `Bearer ${adminToken}`, ...(options.body ? { "content-type": "application/json" } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function formatTime(value) { try { return new Intl.DateTimeFormat(intlLocale(), { dateStyle: "short", timeStyle: "medium" }).format(new Date(value)); } catch { return ""; } }
function showToast(message, error = false) { const toast = $("#adminToast"); toast.textContent = String(message); toast.classList.remove("hidden"); toast.classList.toggle("error", error); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.add("hidden"), 4200); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[ch]); }
function escapeAttr(value) { return escapeHtml(value); }
