(() => {
  const base = window.WerewolfGameI18n;
  if (!base) return;

  const EXTRA = {
    "ADMIN": { "zh-TW": "後台", "zh-CN": "后台", en: "ADMIN" },
    "LOBBY": { "zh-TW": "大廳", "zh-CN": "大厅", en: "LOBBY" },
    "SHERIFF": { "zh-TW": "警長選舉", "zh-CN": "警长选举", en: "SHERIFF" },
    "NIGHT": { "zh-TW": "夜晚", "zh-CN": "夜晚", en: "NIGHT" },
    "DEBATE": { "zh-TW": "正式辯論", "zh-CN": "正式辩论", en: "DEBATE" },
    "VOTE": { "zh-TW": "放逐投票", "zh-CN": "放逐投票", en: "VOTE" },
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

  function runtimeText(source, targetLocale) {
    const locale = normalizeLocale(targetLocale);
    let match = source.match(/^正式玩家 (\d+) 人；角色總數必須相同，且狼人陣營少於其他玩家總數。AI 不是必需品。$/);
    if (match) {
      const count = match[1];
      if (locale === "en") return `${count} active player${count === "1" ? "" : "s"}. Base-role total must match the active-player count, and werewolves must be fewer than all other players combined. AI is optional.`;
      if (locale === "zh-CN") return `正式玩家 ${count} 人；本体角色总数必须与正式玩家数相同，且狼人阵营少于其他玩家总数。AI 不是必需。`;
      return `正式玩家 ${count} 人；本體角色總數必須與正式玩家數相同，且狼人陣營少於其他玩家總數。AI 不是必需品。`;
    }
    match = source.match(/^(\d+) 名正式玩家$/);
    if (match) {
      if (locale === "en") return `${match[1]} active player${match[1] === "1" ? "" : "s"}`;
      if (locale === "zh-CN") return `${match[1]} 名正式玩家`;
      return source;
    }
    match = source.match(/^第 (\d+) 輪$/);
    if (match) {
      if (locale === "en") return `Round ${match[1]}`;
      if (locale === "zh-CN") return `第 ${match[1]} 轮`;
      return source;
    }
    return null;
  }

  window.WerewolfGameI18n = {
    role: (...args) => base.role(...args),
    text(source, targetLocale) {
      const key = String(source ?? "");
      const fixed = EXTRA[key];
      if (fixed) return fixed[normalizeLocale(targetLocale)] || fixed["zh-TW"] || key;
      const runtime = runtimeText(key, targetLocale);
      if (runtime !== null) return runtime;
      return base.text(source, targetLocale);
    },
    canTranslate(source) {
      const key = String(source ?? "");
      return Object.prototype.hasOwnProperty.call(EXTRA, key) || runtimeText(key, "zh-TW") !== null || base.canTranslate(source);
    }
  };
})();