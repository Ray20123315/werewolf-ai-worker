(() => {
  const form = document.querySelector("#addAIForm");
  if (!form) return;

  const PROVIDER_DEFAULTS = {
    openai: "gpt-5.6-luna",
    gemini: "gemini-3.6-flash",
    deepseek: "deepseek-v4-flash",
    "openai-compatible": ""
  };

  function roomId() {
    return location.pathname.toUpperCase().match(/^\/([A-Z2-9]{6})\/?$/)?.[1] || "";
  }

  function roomSession(id) {
    if (!id) return null;
    try {
      return JSON.parse(localStorage.getItem(`werewolf-session:${id}`) || "null");
    } catch {
      return null;
    }
  }

  function parseApiKeyPool(value) {
    return [...new Set(String(value || "").split(/[\n,;]+/g).map((item) => item.trim()).filter(Boolean))].slice(0, 8);
  }

  function aiKeyStorageKey(id) {
    return `werewolf-ai-keys:${id || "none"}`;
  }

  function readAIKeys(id) {
    try {
      const raw = JSON.parse(sessionStorage.getItem(aiKeyStorageKey(id)) || "{}");
      return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    } catch {
      return {};
    }
  }

  function writeAIKeys(id, keys) {
    sessionStorage.setItem(aiKeyStorageKey(id), JSON.stringify(keys));
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

  function resetForm() {
    form.reset();
    const provider = document.querySelector("#aiProvider");
    const model = document.querySelector("#aiModel");
    const baseRow = document.querySelector("#aiBaseUrlRow");
    if (provider) provider.value = "openai";
    if (model) model.value = PROVIDER_DEFAULTS.openai;
    baseRow?.classList.add("hidden");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    const id = roomId();
    const session = roomSession(id);
    if (!id || !session?.token) {
      showToast("找不到房間登入狀態，請重新登入後再加入 AI。", true);
      return;
    }

    const data = new FormData(form);
    const provider = String(data.get("provider") || "");
    const apiKeys = parseApiKeyPool(data.get("apiKeys"));
    if (!apiKeys.length) {
      showToast("請至少輸入 1 組 API Key", true);
      return;
    }

    const submit = form.querySelector("button[type='submit']");
    if (submit) submit.disabled = true;

    try {
      const response = await fetch(`/api/rooms/${id}/ai`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: session.token,
          name: data.get("name"),
          provider,
          model: data.get("model"),
          ...(provider === "openai-compatible" ? { baseUrl: data.get("baseUrl") } : {})
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      if (!body.playerId) throw new Error("AI 加入回傳缺少 playerId");

      const keys = readAIKeys(id);
      keys[body.playerId] = apiKeys;
      writeAIKeys(id, keys);
      resetForm();
      showToast(`AI 已加入；${apiKeys.length} 組 API Key 只保留在這個瀏覽器 session`);

      // Re-read authoritative room state after the successful POST instead of
      // relying on timing of a WebSocket broadcast to prove that the AI joined.
      setTimeout(() => location.reload(), 350);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), true);
      if (submit) submit.disabled = false;
    }
  }

  form.addEventListener("submit", handleSubmit, { capture: true });
})();