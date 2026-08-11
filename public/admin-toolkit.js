(() => {
  const TOKEN_KEY = "werewolf-admin-token";
  const nativeFetch = window.fetch.bind(window);
  const capture = { overview: null, rooms: [], errors: [], errorQuery: "" };
  let autoRefreshTimer = null;

  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    try {
      const requestUrl = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      const url = new URL(requestUrl, location.href);
      if (response.ok && url.pathname.startsWith("/api/admin/")) {
        const data = await response.clone().json();
        if (url.pathname === "/api/admin/overview") capture.overview = data;
        if (url.pathname === "/api/admin/rooms" && Array.isArray(data.rooms)) capture.rooms = data.rooms;
        if (url.pathname === "/api/admin/errors" && Array.isArray(data.errors)) {
          capture.errors = data.errors;
          capture.errorQuery = url.search;
          setTimeout(decorateDiagnostics, 40);
        }
      }
    } catch { /* diagnostics are best effort and must never block admin requests */ }
    return response;
  };

  document.addEventListener("submit", async (event) => {
    const formElement = event.target;
    if (!(formElement instanceof HTMLFormElement)) return;
    if (formElement.id !== "registerRoomForm" && formElement.id !== "adminNoticeForm") return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const formData = new FormData(formElement);
    try {
      if (formElement.id === "registerRoomForm") {
        const roomId = String(formData.get("roomId") || "").trim().toUpperCase();
        await adminRequest("/api/admin/rooms/register", { method: "POST", body: { roomId } });
        formElement.reset();
        showToast(`${roomId} ${text("加入追蹤")}`);
        document.querySelector("#refreshAdmin")?.click();
        return;
      }

      const roomId = selectedRoomId();
      const content = String(formData.get("content") || "");
      if (!roomId) throw new Error(text("找不到目前房號"));
      await adminRequest(`/api/admin/rooms/${roomId}/notice`, { method: "POST", body: { content } });
      formElement.reset();
      showToast(text("公告已送出"));
      document.querySelector("[data-detail-refresh]")?.click();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), true);
    }
  }, true);

  document.addEventListener("DOMContentLoaded", () => {
    injectUtilities();
    localizeUtilities();
    document.querySelector("#languageSelect")?.addEventListener("change", () => setTimeout(localizeUtilities, 0));
  });
  if (document.readyState !== "loading") {
    injectUtilities();
    localizeUtilities();
  }

  function injectUtilities() {
    if (document.querySelector("#adminToolkitActions")) return;
    const section = document.querySelector(".admin-errors-section");
    if (!section) return;
    const toolbar = document.createElement("div");
    toolbar.id = "adminToolkitActions";
    toolbar.className = "admin-toolkit-actions";
    toolbar.innerHTML = `
      <button id="adminResetFilters" class="button button-ghost compact" type="button"></button>
      <button id="adminCopyDiagnostics" class="button button-ghost compact" type="button"></button>
      <button id="adminExportDiagnostics" class="button button-ghost compact" type="button"></button>
      <button id="adminAutoRefresh" class="button button-ghost compact" type="button"></button>`;
    section.querySelector("#adminErrorFilters")?.after(toolbar);
    document.querySelector("#adminResetFilters")?.addEventListener("click", resetFilters);
    document.querySelector("#adminCopyDiagnostics")?.addEventListener("click", copyDiagnostics);
    document.querySelector("#adminExportDiagnostics")?.addEventListener("click", exportDiagnostics);
    document.querySelector("#adminAutoRefresh")?.addEventListener("click", toggleAutoRefresh);
  }

  function resetFilters() {
    const defaults = { adminErrorSearch: "", adminErrorRoom: "", adminErrorCategory: "", adminErrorSource: "", adminErrorHours: "24", adminErrorGrouped: "1", adminRoomSearch: "", adminRoomActivity: "all" };
    for (const [id, value] of Object.entries(defaults)) {
      const node = document.getElementById(id);
      if (!node) continue;
      node.value = value;
      node.dispatchEvent(new Event(node.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    }
    showToast(text("篩選已重置"));
  }

  async function copyDiagnostics() {
    const lines = diagnosticSummaryLines();
    const value = lines.join("\n");
    try { await navigator.clipboard.writeText(value); }
    catch { fallbackCopy(value); }
    showToast(text("診斷摘要已複製"));
  }

  function exportDiagnostics() {
    const payload = {
      exportedAt: new Date().toISOString(),
      query: capture.errorQuery,
      overview: capture.overview,
      errors: capture.errors
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `werewolf-admin-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(text("診斷 JSON 已匯出"));
  }

  function toggleAutoRefresh() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    } else {
      autoRefreshTimer = setInterval(() => document.querySelector("#refreshAdmin")?.click(), 30_000);
      document.querySelector("#refreshAdmin")?.click();
    }
    localizeUtilities();
  }

  function decorateDiagnostics() {
    const rows = [...document.querySelectorAll("#adminErrorsBody tr")];
    capture.errors.forEach((error, index) => {
      const row = rows[index];
      const message = row?.querySelector(".admin-error-message");
      if (!message || message.querySelector(".admin-diagnostic-meta")) return;
      const meta = document.createElement("small");
      meta.className = `admin-diagnostic-meta severity-${error.severity || "info"}`;
      const duration = Number(error.durationMs || 0) > 0 ? ` · ${text("持續")} ${formatDuration(error.durationMs)}` : "";
      const burst = error.burst ? ` · ${text("短時間爆量")}` : "";
      meta.textContent = `${String(error.severity || "info").toUpperCase()} · ${error.signature || "—"}${duration}${burst}`;
      message.append(meta);
    });
  }

  function diagnosticSummaryLines() {
    const overview = capture.overview || {};
    const lines = [
      `${text("狼人殺後台診斷")}`,
      `${text("匯出時間")}: ${new Date().toLocaleString()}`,
      `${text("追蹤房間")}: ${overview.roomCount ?? "—"}`,
      `${text("活躍房間")}: ${overview.activeRoomCount ?? "—"}`,
      `${text("24 小時錯誤")}: ${overview.errorCount24h ?? "—"}`,
      `${text("目前查詢")}: ${capture.errorQuery || "—"}`
    ];
    for (const error of capture.errors.slice(0, 20)) lines.push(`[${String(error.severity || "info").toUpperCase()}] ${error.signature || "—"} ${error.roomId || "—"} ${error.category || "—"}: ${error.message || ""}${error.occurrences ? ` ×${error.occurrences}` : ""}`);
    return lines;
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

  function selectedRoomId() {
    const value = String(document.querySelector("#adminRoomDetail .admin-room-meta strong")?.textContent || "").trim().toUpperCase();
    return /^[A-Z2-9]{6}$/.test(value) ? value : "";
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

  function locale() {
    const value = localStorage.getItem("werewolf-locale") || document.querySelector("#languageSelect")?.value;
    return value === "zh-CN" || value === "en" ? value : "zh-TW";
  }

  const COPY = {
    "重置篩選": ["重置篩選", "重置筛选", "Reset filters"],
    "複製診斷": ["複製診斷", "复制诊断", "Copy diagnostics"],
    "匯出 JSON": ["匯出 JSON", "导出 JSON", "Export JSON"],
    "啟用 30 秒自動刷新": ["啟用 30 秒自動刷新", "启用 30 秒自动刷新", "Enable 30s auto-refresh"],
    "停止自動刷新": ["停止自動刷新", "停止自动刷新", "Stop auto-refresh"],
    "篩選已重置": ["篩選已重置", "筛选已重置", "Filters reset"],
    "診斷摘要已複製": ["診斷摘要已複製", "诊断摘要已复制", "Diagnostic summary copied"],
    "診斷 JSON 已匯出": ["診斷 JSON 已匯出", "诊断 JSON 已导出", "Diagnostic JSON exported"],
    "找不到目前房號": ["找不到目前房號", "找不到当前房号", "Current room code not found"],
    "公告已送出": ["公告已送出", "公告已发送", "Notice sent"],
    "持續": ["持續", "持续", "duration"],
    "短時間爆量": ["短時間爆量", "短时间爆量", "burst"],
    "狼人殺後台診斷": ["狼人殺後台診斷", "狼人杀后台诊断", "Werewolf admin diagnostics"],
    "匯出時間": ["匯出時間", "导出时间", "Exported"],
    "追蹤房間": ["追蹤房間", "追踪房间", "Tracked rooms"],
    "活躍房間": ["活躍房間", "活跃房间", "Active rooms"],
    "24 小時錯誤": ["24 小時錯誤", "24 小时错误", "Errors in 24h"],
    "目前查詢": ["目前查詢", "当前查询", "Current query"],
    "加入追蹤": ["加入追蹤", "加入追踪", "tracked"],
    "管理員 Token 無效": ["管理員 Token 無效", "管理员 Token 无效", "Invalid admin token"]
  };

  function text(key) {
    const item = COPY[key];
    if (!item) return key;
    return item[locale() === "zh-CN" ? 1 : locale() === "en" ? 2 : 0];
  }

  function localizeUtilities() {
    const values = {
      adminResetFilters: text("重置篩選"),
      adminCopyDiagnostics: text("複製診斷"),
      adminExportDiagnostics: text("匯出 JSON"),
      adminAutoRefresh: text(autoRefreshTimer ? "停止自動刷新" : "啟用 30 秒自動刷新")
    };
    for (const [id, value] of Object.entries(values)) { const node = document.getElementById(id); if (node) node.textContent = value; }
  }

  function formatDuration(ms) {
    const seconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    return `${Math.round(minutes / 60)}h`;
  }

  function fallbackCopy(value) {
    const area = document.createElement("textarea");
    area.value = value;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
})();
