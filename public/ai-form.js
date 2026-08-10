(() => {
  const form = document.querySelector("#addAIForm");
  if (!form) return;

  const BATCH_MAX = 100;
  const PROVIDER_DEFAULTS = {
    openai: "gpt-5.6-luna",
    gemini: "gemini-3.6-flash",
    deepseek: "deepseek-v4-flash",
    "openai-compatible": ""
  };
  const LABELS = {
    "zh-TW": {
      nameBase: "AI 名稱基底",
      count: "批量數量",
      hint: "名稱會自動加上流水號，例如名稱基底 Gemini、數量 5，會建立 Gemini1～Gemini5。單批最多 100 隻。",
      namePlaceholder: "例如：Gemini",
      submit: "批量加入 AI 玩家",
      missingSession: "找不到房間登入狀態，請重新登入後再加入 AI。",
      missingKeys: "請至少輸入 1 組 API Key",
      invalidCount: "批量數量必須是 1～100 的整數",
      invalidBase: "請輸入 AI 名稱基底",
      baseTooLong: "AI 名稱基底太長；加上最大流水號後必須在 24 字元內",
      duplicateGenerated: "批量產生的 AI 名稱重複，請縮短或更換名稱基底",
      existingName: (name) => `AI 名稱「${name}」已存在，請更換名稱基底或數量`,
      joined: (count, keyCount) => `已加入 ${count} 隻 AI；${keyCount} 組 API Key 保留在目前瀏覽器 session，表單內容未清除`,
      partial: (done, total, name, reason) => `已加入 ${done}/${total} 隻；${name} 加入失敗：${reason}`
    },
    "zh-CN": {
      nameBase: "AI 名称前缀",
      count: "批量数量",
      hint: "名称会自动加上序号，例如名称前缀 Gemini、数量 5，会建立 Gemini1～Gemini5。单批最多 100 个。",
      namePlaceholder: "例如：Gemini",
      submit: "批量加入 AI 玩家",
      missingSession: "找不到房间登录状态，请重新登录后再加入 AI。",
      missingKeys: "请至少输入 1 组 API Key",
      invalidCount: "批量数量必须是 1～100 的整数",
      invalidBase: "请输入 AI 名称前缀",
      baseTooLong: "AI 名称前缀太长；加上最大序号后必须在 24 个字符内",
      duplicateGenerated: "批量生成的 AI 名称重复，请缩短或更换名称前缀",
      existingName: (name) => `AI 名称“${name}”已存在，请更换名称前缀或数量`,
      joined: (count, keyCount) => `已加入 ${count} 个 AI；${keyCount} 组 API Key 保留在当前浏览器 session，表单内容未清除`,
      partial: (done, total, name, reason) => `已加入 ${done}/${total} 个；${name} 加入失败：${reason}`
    },
    en: {
      nameBase: "AI name prefix",
      count: "Batch size",
      hint: "A numeric suffix is added automatically. For example, prefix Gemini with batch size 5 creates Gemini1 through Gemini5. Maximum 100 per batch.",
      namePlaceholder: "Example: Gemini",
      submit: "Add AI players in batch",
      missingSession: "Room login state was not found. Sign in again before adding AI players.",
      missingKeys: "Enter at least one API key.",
      invalidCount: "Batch size must be an integer from 1 to 100.",
      invalidBase: "Enter an AI name prefix.",
      baseTooLong: "The AI name prefix is too long; the largest numbered name must fit within 24 characters.",
      duplicateGenerated: "Generated AI names collide. Shorten or change the name prefix.",
      existingName: (name) => `AI name “${name}” already exists. Change the prefix or batch size.`,
      joined: (count, keyCount) => `Added ${count} AI players. ${keyCount} API key(s) remain in this browser session and the form was kept unchanged.`,
      partial: (done, total, name, reason) => `Added ${done}/${total}. Failed to add ${name}: ${reason}`
    }
  };

  function locale() {
    const value = localStorage.getItem("werewolf-locale");
    return value === "zh-CN" || value === "en" ? value : "zh-TW";
  }

  function t(key, ...args) {
    const value = LABELS[locale()]?.[key] ?? LABELS["zh-TW"][key];
    return typeof value === "function" ? value(...args) : value;
  }

  function localizeForm() {
    const nameLabel = document.querySelector("#aiNameBaseLabel");
    const countLabel = document.querySelector("#aiCountLabel");
    const hint = document.querySelector("#aiBatchHint");
    const name = form.querySelector("input[name='name']");
    const submitLabel = document.querySelector("#aiSubmitLabel");
    if (nameLabel) nameLabel.textContent = t("nameBase");
    if (countLabel) countLabel.textContent = t("count");
    if (hint) hint.textContent = t("hint");
    if (name) name.placeholder = t("namePlaceholder");
    if (submitLabel) submitLabel.textContent = t("submit");
  }

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

  function normalizeName(raw) {
    const display = String(raw || "").normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 24);
    return { display, key: display.toLocaleLowerCase("zh-Hant-TW") };
  }

  function generatedNames(baseRaw, count) {
    const base = String(baseRaw || "").normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!base) throw new Error(t("invalidBase"));
    if (`${base}${count}`.length > 24) throw new Error(t("baseTooLong"));
    const names = Array.from({ length: count }, (_, index) => normalizeName(`${base}${index + 1}`));
    if (names.some((item) => !item.display)) throw new Error(t("invalidBase"));
    if (new Set(names.map((item) => item.key)).size !== names.length) throw new Error(t("duplicateGenerated"));
    return names;
  }

  function showToast(message, error = false) {
    const toast = document.querySelector("#toast");
    if (!toast) return;
    toast.textContent = String(message);
    toast.classList.remove("hidden");
    toast.classList.toggle("error", error);
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.add("hidden"), 5200);
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  async function assertNamesAvailable(id, token, names) {
    const state = await requestJson(`/api/rooms/${id}/state?token=${encodeURIComponent(token)}`);
    const existing = new Set((state.players || []).map((player) => normalizeName(player.name).key));
    const conflict = names.find((item) => existing.has(item.key));
    if (conflict) throw new Error(t("existingName", conflict.display));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    const id = roomId();
    const session = roomSession(id);
    if (!id || !session?.token) {
      showToast(t("missingSession"), true);
      return;
    }

    const data = new FormData(form);
    const provider = String(data.get("provider") || "");
    const apiKeys = parseApiKeyPool(data.get("apiKeys"));
    if (!apiKeys.length) {
      showToast(t("missingKeys"), true);
      return;
    }

    const count = Number(data.get("count"));
    if (!Number.isInteger(count) || count < 1 || count > BATCH_MAX) {
      showToast(t("invalidCount"), true);
      return;
    }

    let names;
    try {
      names = generatedNames(data.get("name"), count);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), true);
      return;
    }

    const submit = form.querySelector("button[type='submit']");
    if (submit) submit.disabled = true;
    form.setAttribute("aria-busy", "true");

    let completed = 0;
    let currentName = names[0]?.display || "AI";
    try {
      await assertNamesAvailable(id, session.token, names);
      const keys = readAIKeys(id);
      for (const item of names) {
        currentName = item.display;
        const body = await requestJson(`/api/rooms/${id}/ai`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            token: session.token,
            name: item.display,
            provider,
            model: data.get("model"),
            ...(provider === "openai-compatible" ? { baseUrl: data.get("baseUrl") } : {})
          })
        });
        if (!body.playerId) throw new Error("AI 加入回傳缺少 playerId");
        keys[body.playerId] = apiKeys;
        writeAIKeys(id, keys);
        completed += 1;
      }
      showToast(t("joined", completed, apiKeys.length));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      showToast(completed > 0 ? t("partial", completed, count, currentName, reason) : reason, true);
    } finally {
      form.removeAttribute("aria-busy");
      if (submit) submit.disabled = false;
    }
  }

  localizeForm();
  document.querySelector("#languageSelect")?.addEventListener("change", () => setTimeout(localizeForm, 0));
  form.addEventListener("submit", handleSubmit, { capture: true });
})();