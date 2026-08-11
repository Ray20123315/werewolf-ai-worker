import { getLocale, intlLocale, knownText, localizeDom, setLocale, siteTitle } from "./i18n.js";

const $ = (selector) => document.querySelector(selector);
const TOKEN_KEY = "werewolf-admin-token";
const ERROR_PAGE_SIZE = 80;
const ACTIVE_WINDOW_MS = 15 * 60_000;
let adminToken = sessionStorage.getItem(TOKEN_KEY) || "";
let overview = null;
let rooms = [];
let roomsTotal = 0;
let errors = [];
let errorsTotal = 0;
let errorOffset = 0;
let selectedRoom = null;
let roomLoadSeq = 0;
let errorLoadSeq = 0;

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
  overview = null; rooms = []; errors = []; selectedRoom = null; roomsTotal = 0; errorsTotal = 0; errorOffset = 0;
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

const roomSearchDebounced = debounce(async () => { await loadRooms(); renderRooms(); }, 220);
$("#adminRoomSearch").addEventListener("input", roomSearchDebounced);
$("#adminRoomActivity").addEventListener("change", async () => { await loadRooms(); renderRooms(); });

const errorFilterDebounced = debounce(resetAndLoadErrors, 260);
$("#adminErrorSearch").addEventListener("input", errorFilterDebounced);
$("#adminErrorRoom").addEventListener("input", (event) => {
  event.currentTarget.value = event.currentTarget.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
  errorFilterDebounced();
});
for (const selector of ["#adminErrorCategory", "#adminErrorSource", "#adminErrorHours", "#adminErrorGrouped"]) {
  $(selector).addEventListener("change", resetAndLoadErrors);
}
$("#adminErrorsPrev").addEventListener("click", async () => {
  errorOffset = Math.max(0, errorOffset - ERROR_PAGE_SIZE);
  await loadErrors(); renderErrors();
});
$("#adminErrorsNext").addEventListener("click", async () => {
  if (errorOffset + ERROR_PAGE_SIZE >= errorsTotal) return;
  errorOffset += ERROR_PAGE_SIZE;
  await loadErrors(); renderErrors();
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
    overview = await adminApi("/api/admin/overview");
    syncDiagnosticFilterOptions();
    await Promise.all([loadRooms(), loadErrors()]);
    if (selectedRoom?.roomId) {
      try { selectedRoom = await adminApi(`/api/admin/rooms/${selectedRoom.roomId}`); }
      catch { selectedRoom = null; }
    }
    renderAll();
    $("#adminLastUpdated").textContent = `${knownText("更新時間")} ${formatTime(Date.now())}`;
  } catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
}

async function loadRooms() {
  const seq = ++roomLoadSeq;
  const params = new URLSearchParams({ limit: "250", offset: "0", activeWindowMinutes: "15" });
  const search = $("#adminRoomSearch").value.trim().toUpperCase();
  const activity = $("#adminRoomActivity").value;
  if (search) params.set("q", search);
  if (activity !== "all") params.set("activity", activity);
  const result = await adminApi(`/api/admin/rooms?${params}`);
  if (seq !== roomLoadSeq) return;
  rooms = Array.isArray(result.rooms) ? result.rooms : [];
  roomsTotal = Number(result.total || 0);
}

async function loadErrors() {
  const seq = ++errorLoadSeq;
  const params = new URLSearchParams({ limit: String(ERROR_PAGE_SIZE), offset: String(errorOffset) });
  const q = $("#adminErrorSearch").value.trim();
  const roomId = $("#adminErrorRoom").value.trim().toUpperCase();
  const category = $("#adminErrorCategory").value;
  const source = $("#adminErrorSource").value;
  const hours = $("#adminErrorHours").value;
  const grouped = $("#adminErrorGrouped").value;
  if (q) params.set("q", q);
  if (/^[A-Z2-9]{6}$/.test(roomId)) params.set("roomId", roomId);
  if (category) params.set("category", category);
  if (source) params.set("source", source);
  params.set("hours", hours);
  params.set("grouped", grouped);
  const result = await adminApi(`/api/admin/errors?${params}`);
  if (seq !== errorLoadSeq) return;
  errors = Array.isArray(result.errors) ? result.errors : [];
  errorsTotal = Number(result.total || 0);
  if (errorOffset > 0 && errorOffset >= errorsTotal) {
    errorOffset = Math.max(0, Math.floor(Math.max(0, errorsTotal - 1) / ERROR_PAGE_SIZE) * ERROR_PAGE_SIZE);
    return loadErrors();
  }
}

async function resetAndLoadErrors() {
  errorOffset = 0;
  try { await loadErrors(); renderErrors(); }
  catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
}

function renderAll() {
  if (!overview) return;
  document.title = `${knownText("管理後台")} · ${siteTitle()}`;
  $("#adminRoomCount").textContent = String(overview.roomCount ?? 0);
  $("#adminActiveRoomCount").textContent = String(overview.activeRoomCount ?? 0);
  $("#adminTranslationState").textContent = knownText(overview.translationConfigured ? "已設定" : "未設定");
  $("#adminErrorCount").textContent = String(overview.errorCount24h ?? 0);
  $("#adminErrorRoomCount").textContent = `${Number(overview.errorRoomCount24h || 0)} ${knownText("個房間受影響")}`;
  syncDiagnosticFilterOptions();
  renderRooms();
  renderErrors();
  renderRoomDetail();
}

function renderRooms() {
  const body = $("#adminRoomsBody");
  $("#adminRoomsResultCount").textContent = `${roomsTotal} ${knownText("筆")}`;
  if (!rooms.length) {
    body.innerHTML = `<tr><td colspan="5" class="admin-empty">${escapeHtml(knownText("沒有符合條件的房間"))}</td></tr>`;
    return;
  }
  body.innerHTML = rooms.map((room) => {
    const active = Date.now() - Number(room.lastSeenAt || 0) <= ACTIVE_WINDOW_MS;
    return `<tr>
      <td data-label="${escapeAttr(knownText("房號"))}" data-no-translate><strong>${escapeHtml(room.roomId)}</strong></td>
      <td data-label="${escapeAttr(knownText("狀態"))}"><span class="admin-status ${active ? "active" : "stale"}">${escapeHtml(knownText(active ? "活躍" : "閒置"))}</span></td>
      <td data-label="${escapeAttr(knownText("首次追蹤"))}">${escapeHtml(formatTime(room.firstSeenAt))}</td>
      <td data-label="${escapeAttr(knownText("最後活動"))}">${escapeHtml(formatTime(room.lastSeenAt))}</td>
      <td data-label="${escapeAttr(knownText("操作"))}"><div class="admin-row-actions"><button class="button button-ghost compact" data-open-room="${escapeAttr(room.roomId)}" type="button">${escapeHtml(knownText("查看"))}</button><button class="button button-ghost compact" data-room-errors="${escapeAttr(room.roomId)}" type="button">${escapeHtml(knownText("錯誤"))}</button></div></td>
    </tr>`;
  }).join("");
  body.querySelectorAll("[data-open-room]").forEach((button) => button.addEventListener("click", () => openRoom(button.dataset.openRoom)));
  body.querySelectorAll("[data-room-errors]").forEach((button) => button.addEventListener("click", () => focusErrorsForRoom(button.dataset.roomErrors)));
}

function renderErrors() {
  const body = $("#adminErrorsBody");
  const grouped = $("#adminErrorGrouped").value === "1";
  $("#adminErrorsResultCount").textContent = `${errorsTotal} ${knownText(grouped ? "組" : "筆")}`;
  const page = errorsTotal ? Math.floor(errorOffset / ERROR_PAGE_SIZE) + 1 : 0;
  const pages = errorsTotal ? Math.ceil(errorsTotal / ERROR_PAGE_SIZE) : 0;
  $("#adminErrorsPage").textContent = `${knownText("第")} ${page} / ${pages} ${knownText("頁")}`;
  $("#adminErrorsPrev").disabled = errorOffset <= 0;
  $("#adminErrorsNext").disabled = errorOffset + ERROR_PAGE_SIZE >= errorsTotal;
  renderErrorSummary();

  if (!errors.length) {
    body.innerHTML = `<tr><td colspan="6" class="admin-empty">${escapeHtml(knownText("沒有符合條件的錯誤"))}</td></tr>`;
    return;
  }
  body.innerHTML = errors.map((error) => {
    const occurrences = Number(error.occurrences || 1);
    const detail = error.detail || "";
    const first = error.firstCreatedAt && Number(error.firstCreatedAt) !== Number(error.createdAt)
      ? `${knownText("首次")} ${formatTime(error.firstCreatedAt)}` : "";
    return `<tr>
      <td data-label="${escapeAttr(knownText("最近發生"))}">${escapeHtml(formatTime(error.createdAt))}</td>
      <td data-label="${escapeAttr(knownText("房號"))}" data-no-translate>${escapeHtml(error.roomId || "—")}</td>
      <td data-label="${escapeAttr(knownText("錯誤分類"))}">${escapeHtml(error.category)}</td>
      <td data-label="${escapeAttr(knownText("來源"))}">${escapeHtml(error.source)}</td>
      <td data-label="${escapeAttr(knownText("次數"))}"><span class="admin-count-badge">${occurrences}</span></td>
      <td data-label="${escapeAttr(knownText("訊息"))}"><div class="admin-error-message"><strong>${escapeHtml(error.message)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}${first ? `<small>${escapeHtml(first)}</small>` : ""}</div></td>
    </tr>`;
  }).join("");
}

function renderErrorSummary() {
  const box = $("#adminErrorSummary");
  if (!overview) { box.innerHTML = ""; return; }
  const categories = Array.isArray(overview.errorByCategory) ? overview.errorByCategory.slice(0, 5) : [];
  const sources = Array.isArray(overview.errorBySource) ? overview.errorBySource.slice(0, 3) : [];
  const chips = [
    ...categories.map((item) => `<span class="admin-summary-chip">${escapeHtml(item.key)} <b>${escapeHtml(item.count)}</b></span>`),
    ...sources.map((item) => `<span class="admin-summary-chip">${escapeHtml(item.key)} <b>${escapeHtml(item.count)}</b></span>`)
  ];
  box.innerHTML = chips.join("");
}

async function openRoom(roomId) {
  try {
    selectedRoom = await adminApi(`/api/admin/rooms/${roomId}`);
    renderRoomDetail();
  } catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
}

function renderRoomDetail() {
  const box = $("#adminRoomDetail");
  if (!selectedRoom) { box.className = "admin-empty"; box.textContent = knownText("選擇一個房間查看。"); return; }
  box.className = "";
  const room = selectedRoom;
  box.innerHTML = `<div class="admin-room-meta">
    <div><span>${escapeHtml(knownText("房號"))}</span><strong data-no-translate>${escapeHtml(room.roomId)}</strong></div>
    <div><span>${escapeHtml(knownText("階段"))}</span><strong>${escapeHtml(phaseLabel(room.phase))}</strong></div>
    <div><span>${escapeHtml(knownText("玩家"))}</span><strong>${escapeHtml(room.playerCount)}</strong></div>
    <div><span>${escapeHtml(knownText("連線"))}</span><strong>${escapeHtml(room.websocketCount)}</strong></div>
  </div>
  <div class="admin-detail-actions">
    <button class="button button-ghost compact" data-detail-refresh type="button">${escapeHtml(knownText("重新載入"))}</button>
    <button class="button button-ghost compact" data-copy-room type="button">${escapeHtml(knownText("複製房號"))}</button>
    <button class="button button-ghost compact" data-detail-errors type="button">${escapeHtml(knownText("只看此房錯誤"))}</button>
  </div>
  <div class="admin-player-list">${(room.players || []).map((player) => adminPlayerHtml(player)).join("")}</div>
  <form id="adminNoticeForm" class="admin-notice-form"><label>${escapeHtml(knownText("系統公告"))}<input name="content" maxlength="300" required /></label><button class="button button-secondary" type="submit">${escapeHtml(knownText("發送公告"))}</button></form>`;

  box.querySelector("[data-detail-refresh]")?.addEventListener("click", () => openRoom(room.roomId));
  box.querySelector("[data-copy-room]")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(room.roomId); showToast(`${room.roomId} ${knownText("已複製")}`); }
    catch { showToast(knownText("無法複製房號"), true); }
  });
  box.querySelector("[data-detail-errors]")?.addEventListener("click", () => focusErrorsForRoom(room.roomId));
  box.querySelectorAll("[data-admin-kick]").forEach((button) => button.addEventListener("click", async () => {
    try { await adminApi(`/api/admin/rooms/${room.roomId}/kick`, { method: "POST", body: { playerId: button.dataset.adminKick } }); await openRoom(room.roomId); await loadRooms(); renderRooms(); }
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

async function focusErrorsForRoom(roomId) {
  $("#adminErrorRoom").value = String(roomId || "").toUpperCase();
  errorOffset = 0;
  try {
    await loadErrors();
    renderErrors();
    $(".admin-errors-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
}

function adminPlayerHtml(player) {
  const tags = [player.isHost ? knownText("房主") : "", player.isModerator ? knownText("管理員") : "", player.isAI ? "AI" : "", player.isSpectator ? knownText("觀戰") : "", !player.alive && !player.isSpectator ? knownText("出局") : ""].filter(Boolean).join(" · ");
  const actions = player.isHost ? "" : `<div class="admin-player-actions">${!player.isAI ? `<button class="button button-ghost compact" data-admin-moderator="${escapeAttr(player.id)}" data-enabled="${player.isModerator ? "false" : "true"}" type="button">${escapeHtml(knownText(player.isModerator ? "取消管理員" : "設為管理員"))}</button>` : ""}<button class="button button-ghost compact" data-admin-kick="${escapeAttr(player.id)}" type="button">${escapeHtml(knownText("踢出"))}</button></div>`;
  return `<div class="admin-player"><div class="admin-player-copy"><strong data-no-translate>${escapeHtml(player.name)}</strong><small>${escapeHtml(tags || "—")}</small></div>${actions}</div>`;
}

function syncDiagnosticFilterOptions() {
  if (!overview) return;
  replaceOptions($("#adminErrorCategory"), knownText("全部分類"), overview.errorByCategory);
  replaceOptions($("#adminErrorSource"), knownText("全部來源"), overview.errorBySource);
}

function replaceOptions(select, allLabel, items) {
  const current = select.value;
  const options = [`<option value="">${escapeHtml(allLabel)}</option>`];
  for (const item of Array.isArray(items) ? items : []) options.push(`<option value="${escapeAttr(item.key)}">${escapeHtml(item.key)} (${escapeHtml(item.count)})</option>`);
  select.innerHTML = options.join("");
  if ([...select.options].some((option) => option.value === current)) select.value = current;
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

function phaseLabel(value) {
  const key = String(value || "").toUpperCase();
  const translated = knownText(key);
  return translated === key ? String(value || "—") : translated;
}
function formatTime(value) { try { return new Intl.DateTimeFormat(intlLocale(), { dateStyle: "short", timeStyle: "medium" }).format(new Date(value)); } catch { return ""; } }
function showToast(message, error = false) { const toast = $("#adminToast"); toast.textContent = String(message); toast.classList.remove("hidden"); toast.classList.toggle("error", error); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.add("hidden"), 4200); }
function debounce(fn, delay) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); }; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[ch]); }
function escapeAttr(value) { return escapeHtml(value); }
