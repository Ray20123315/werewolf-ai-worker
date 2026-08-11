(() => {
  const base = window.WerewolfGameI18n;
  if (!base) return;

  const EXTRA = {
    "ADMIN": { "zh-TW": "後台", "zh-CN": "后台", en: "ADMIN" },
    "LOBBY": { "zh-TW": "大廳", "zh-CN": "大厅", en: "LOBBY" },
    "REACTION": { "zh-TW": "反應", "zh-CN": "反应", en: "REACTION" },
    "GAME OVER": { "zh-TW": "遊戲結束", "zh-CN": "游戏结束", en: "GAME OVER" },
    "CONFIRM": { "zh-TW": "確認", "zh-CN": "确认", en: "CONFIRM" },
    "ROOM": { "zh-TW": "房間", "zh-CN": "房间", en: "ROOM" },
    "ROOMS": { "zh-TW": "房間", "zh-CN": "房间", en: "ROOMS" },
    "ERRORS": { "zh-TW": "錯誤", "zh-CN": "错误", en: "ERRORS" },
    "ACTION": { "zh-TW": "操作", "zh-CN": "操作", en: "ACTION" },
    "PUBLIC CHAT": { "zh-TW": "公開聊天", "zh-CN": "公开聊天", en: "PUBLIC CHAT" },
    "PLAYERS": { "zh-TW": "玩家", "zh-CN": "玩家", en: "PLAYERS" },
    "HOST": { "zh-TW": "房主", "zh-CN": "房主", en: "HOST" },
    "CREATE": { "zh-TW": "建立", "zh-CN": "创建", en: "CREATE" },
    "JOIN": { "zh-TW": "加入", "zh-CN": "加入", en: "JOIN" },
    "Token 只保留在這個瀏覽器 session，不會寫入房間或網址。": {
      "zh-TW": "Token 只保留在這個瀏覽器 session，不會寫入房間或網址。",
      "zh-CN": "Token 只保留在这个浏览器 session，不会写入房间或网址。",
      en: "The token stays only in this browser session and is never written to the room or URL."
    },
    "勾選後由伺服器依目前正式玩家數自動配置基本板子；取消後可手動調整本體角色與附加身份。": {
      "zh-TW": "勾選後由伺服器依目前正式玩家數自動配置基本板子；取消後可手動調整本體角色與附加身份。",
      "zh-CN": "勾选后由服务器按当前正式玩家数自动配置基础板子；取消后可手动调整本体角色与附加身份。",
      en: "When enabled, the server builds a basic setup for the current active player count. Disable it to edit base roles and addon identities manually."
    }
  };

  function normalizeLocale(value) {
    return value === "zh-CN" || value === "en" ? value : "zh-TW";
  }

  window.WerewolfGameI18n = {
    role: (...args) => base.role(...args),
    text(source, targetLocale) {
      const key = String(source ?? "");
      const fixed = EXTRA[key];
      if (fixed) return fixed[normalizeLocale(targetLocale)] || fixed["zh-TW"] || key;
      return base.text(source, targetLocale);
    },
    canTranslate(source) {
      return Object.prototype.hasOwnProperty.call(EXTRA, String(source ?? "")) || base.canTranslate(source);
    }
  };
})();