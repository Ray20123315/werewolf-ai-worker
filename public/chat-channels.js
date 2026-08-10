(() => {
  const LABELS = {
    "zh-TW": { public: "公開", werewolf: "狼人", lovers: "情侶", channel: "聊天頻道", secret: "秘密聊天", publicBlocked: "夜晚公開聊天暫停", available: "可聊天", reconnecting: "秘密聊天重新連線中" },
    "zh-CN": { public: "公开", werewolf: "狼人", lovers: "情侣", channel: "聊天频道", secret: "秘密聊天", publicBlocked: "夜晚公开聊天暂停", available: "可聊天", reconnecting: "秘密聊天重新连接中" },
    en: { public: "Public", werewolf: "Werewolf", lovers: "Lovers", channel: "Chat channel", secret: "Secret chat", publicBlocked: "Public chat is paused at night", available: "Chat available", reconnecting: "Secret chat reconnecting" }
  };

  let latestState = null;
  let lastChannels = ["public"];
  let channelSocket = null;
  let channelSocketToken = "";
  let reconnectTimer = 0;

  const locale = () => {
    const value = localStorage.getItem("werewolf-locale");
    return value === "zh-CN" || value === "en" ? value : "zh-TW";
  };
  const text = (key) => LABELS[locale()][key] || key;

  function currentRoomId() {
    return location.pathname.toUpperCase().match(/^\/([A-Z2-9]{6})\/?$/)?.[1] || "";
  }

  function currentToken() {
    const id = currentRoomId();
    if (!id) return "";
    try {
      return JSON.parse(localStorage.getItem(`werewolf-session:${id}`) || "null")?.token || "";
    } catch {
      return "";
    }
  }

  function ensureSelector() {
    const form = document.querySelector("#chatForm");
    if (!form) return null;
    let select = document.querySelector("#chatChannel");
    if (!select) {
      select = document.createElement("select");
      select.id = "chatChannel";
      select.setAttribute("aria-label", text("channel"));
      select.style.maxWidth = "9rem";
      form.insertBefore(select, form.firstChild);
      select.addEventListener("change", syncChatAvailability);
    }
    renderOptions(select);
    return select;
  }

  function renderOptions(select) {
    const current = select.value || "public";
    const html = lastChannels.map((channel) => `<option value="${channel}">${text(channel)}</option>`).join("");
    if (select.innerHTML !== html) select.innerHTML = html;
    select.value = lastChannels.includes(current) ? current : "public";
    const aria = text("channel");
    if (select.getAttribute("aria-label") !== aria) select.setAttribute("aria-label", aria);
  }

  function setDisabled(element, disabled) {
    if (element && element.disabled !== disabled) element.disabled = disabled;
  }

  function syncChatAvailability() {
    const select = ensureSelector();
    const input = document.querySelector("#chatInput");
    const button = document.querySelector("#chatForm button[type='submit']");
    const status = document.querySelector("#chatStatus");
    if (!select || !input || !button || !status || !latestState) return;

    const channel = select.value || "public";
    const secret = channel !== "public";
    const activeGame = !["lobby", "ended"].includes(latestState.phase);
    const blockedByLife = Boolean(latestState.me?.isSpectator || (!latestState.me?.alive && activeGame));
    const blocked = blockedByLife || (!secret && latestState.phase === "night");
    setDisabled(input, blocked);
    setDisabled(button, blocked);

    const nextStatus = blocked
      ? text("publicBlocked")
      : secret
        ? `${text("secret")} · ${text(channel)}`
        : text("available");
    if (status.textContent !== nextStatus) status.textContent = nextStatus;
    status.classList.toggle("blocked", blocked);
  }

  function decorateMessages() {
    if (!latestState) return;
    const rows = [...document.querySelectorAll("#messages .message")];
    const messages = latestState.messages || [];
    rows.forEach((row, index) => {
      row.querySelector("[data-chat-channel-badge]")?.remove();
      const channel = messages[index]?.channel;
      if (!channel || channel === "public") return;
      const badge = document.createElement("span");
      badge.dataset.chatChannelBadge = channel;
      badge.textContent = text(channel);
      badge.style.marginInlineStart = ".45rem";
      badge.style.fontWeight = "700";
      badge.style.fontSize = ".72rem";
      badge.style.opacity = ".8";
      row.querySelector(".message-head strong")?.insertAdjacentElement("afterend", badge);
    });
  }

  function applyState(state) {
    latestState = state;
    lastChannels = Array.isArray(state?.chatChannels) && state.chatChannels.length ? state.chatChannels : ["public"];
    const apply = () => {
      ensureSelector();
      syncChatAvailability();
      decorateMessages();
    };
    setTimeout(apply, 0);
    setTimeout(apply, 75);
  }

  function connectChannelSocket() {
    const id = currentRoomId();
    const token = currentToken();
    if (!id || !token) {
      clearTimeout(reconnectTimer);
      reconnectTimer = 0;
      if (channelSocket) {
        try { channelSocket.close(1000, "No room session"); } catch {}
      }
      channelSocket = null;
      channelSocketToken = "";
      return;
    }

    if (channelSocket && channelSocketToken === token && (channelSocket.readyState === WebSocket.OPEN || channelSocket.readyState === WebSocket.CONNECTING)) return;
    if (channelSocket) {
      try { channelSocket.close(1000, "Channel socket refresh"); } catch {}
    }

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/api/rooms/${id}/ws?token=${encodeURIComponent(token)}`);
    channelSocket = socket;
    channelSocketToken = token;

    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "state" && payload.state) applyState(payload.state);
      } catch {}
    });

    socket.addEventListener("close", (event) => {
      if (channelSocket !== socket) return;
      channelSocket = null;
      if (event.code === 1000 || currentToken() !== token) return;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectChannelSocket, 1200);
    });
  }

  function sendSecretChat(content, channel) {
    if (!channelSocket || channelSocket.readyState !== WebSocket.OPEN) return false;
    channelSocket.send(JSON.stringify({ type: "chat", content, channel }));
    return true;
  }

  const chatForm = document.querySelector("#chatForm");
  chatForm?.addEventListener("submit", (event) => {
    const select = ensureSelector();
    const channel = select?.value || "public";
    if (channel === "public") return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const input = document.querySelector("#chatInput");
    const content = input?.value?.trim() || "";
    if (!content) return;
    if (!sendSecretChat(content, channel)) {
      const status = document.querySelector("#chatStatus");
      if (status) {
        status.textContent = text("reconnecting");
        status.classList.add("blocked");
      }
      connectChannelSocket();
      return;
    }
    input.value = "";
  }, { capture: true });

  document.querySelector("#languageSelect")?.addEventListener("change", () => {
    setTimeout(() => {
      const select = ensureSelector();
      if (select) renderOptions(select);
      syncChatAvailability();
      decorateMessages();
    }, 0);
  });

  const input = document.querySelector("#chatInput");
  const button = document.querySelector("#chatForm button[type='submit']");
  if (input || button) {
    const availabilityObserver = new MutationObserver(() => queueMicrotask(syncChatAvailability));
    if (input) availabilityObserver.observe(input, { attributes: true, attributeFilter: ["disabled"] });
    if (button) availabilityObserver.observe(button, { attributes: true, attributeFilter: ["disabled"] });
  }

  ensureSelector();
  connectChannelSocket();
  setInterval(connectChannelSocket, 1500);
})();