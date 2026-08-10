(() => {
  const LABELS = {
    "zh-TW": { public: "公開", werewolf: "狼人", lovers: "情侶", channel: "聊天頻道", secret: "秘密聊天", publicBlocked: "夜晚公開聊天暫停", available: "可聊天" },
    "zh-CN": { public: "公开", werewolf: "狼人", lovers: "情侣", channel: "聊天频道", secret: "秘密聊天", publicBlocked: "夜晚公开聊天暂停", available: "可聊天" },
    en: { public: "Public", werewolf: "Werewolf", lovers: "Lovers", channel: "Chat channel", secret: "Secret chat", publicBlocked: "Public chat is paused at night", available: "Chat available" }
  };

  let latestState = null;
  let lastChannels = ["public"];
  const locale = () => {
    const value = localStorage.getItem("werewolf-locale");
    return value === "zh-CN" || value === "en" ? value : "zh-TW";
  };
  const text = (key) => LABELS[locale()][key] || key;

  // Fix async submit handlers that read event.currentTarget after await.
  const aiForm = document.querySelector("#addAIForm");
  if (aiForm) {
    const nativeAdd = aiForm.addEventListener.bind(aiForm);
    aiForm.addEventListener = function (type, listener, options) {
      if (type !== "submit" || typeof listener !== "function") return nativeAdd(type, listener, options);
      return nativeAdd(type, function (event) {
        const stableEvent = new Proxy(event, {
          get(target, prop) {
            if (prop === "currentTarget") return aiForm;
            const value = Reflect.get(target, prop, target);
            return typeof value === "function" ? value.bind(target) : value;
          }
        });
        return listener.call(this, stableEvent);
      }, options);
    };
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
    select.innerHTML = lastChannels.map((channel) => `<option value="${channel}">${text(channel)}</option>`).join("");
    select.value = lastChannels.includes(current) ? current : "public";
    select.setAttribute("aria-label", text("channel"));
  }

  function syncChatAvailability() {
    const select = ensureSelector();
    const input = document.querySelector("#chatInput");
    const button = document.querySelector("#chatForm button[type='submit']");
    const status = document.querySelector("#chatStatus");
    if (!select || !input || !button || !status || !latestState) return;
    const channel = select.value || "public";
    const secret = channel !== "public";
    const blockedByLife = latestState.me?.isSpectator || (!latestState.me?.alive && !["lobby", "ended"].includes(latestState.phase));
    const blocked = blockedByLife || (!secret && latestState.phase === "night");
    input.disabled = blocked;
    button.disabled = blocked;
    status.textContent = blocked ? text("publicBlocked") : secret ? `${text("secret")} · ${text(channel)}` : text("available");
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

  const NativeWebSocket = window.WebSocket;
  class ChannelAwareWebSocket extends NativeWebSocket {
    constructor(...args) {
      super(...args);
      super.addEventListener("message", (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "state" && payload.state) {
            latestState = payload.state;
            lastChannels = Array.isArray(payload.state.chatChannels) ? payload.state.chatChannels : ["public"];
            setTimeout(() => {
              ensureSelector();
              syncChatAvailability();
              decorateMessages();
            }, 0);
          }
        } catch {}
      });
    }

    send(data) {
      if (typeof data === "string") {
        try {
          const payload = JSON.parse(data);
          if (payload.type === "chat") {
            const select = ensureSelector();
            payload.channel = select?.value || "public";
            data = JSON.stringify(payload);
          }
        } catch {}
      }
      return super.send(data);
    }
  }
  Object.defineProperties(ChannelAwareWebSocket, {
    CONNECTING: { value: NativeWebSocket.CONNECTING },
    OPEN: { value: NativeWebSocket.OPEN },
    CLOSING: { value: NativeWebSocket.CLOSING },
    CLOSED: { value: NativeWebSocket.CLOSED }
  });
  window.WebSocket = ChannelAwareWebSocket;

  document.querySelector("#languageSelect")?.addEventListener("change", () => {
    setTimeout(() => {
      const select = ensureSelector();
      if (select) renderOptions(select);
      syncChatAvailability();
      decorateMessages();
    }, 0);
  });

  const observer = new MutationObserver(() => {
    ensureSelector();
    syncChatAvailability();
  });
  const chatForm = document.querySelector("#chatForm");
  if (chatForm) observer.observe(chatForm, { subtree: true, attributes: true, attributeFilter: ["disabled"] });
  ensureSelector();
})();
