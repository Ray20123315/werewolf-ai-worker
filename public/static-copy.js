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
    "房間追蹤、即時診斷與管理操作集中在同一頁。": { "zh-TW": "房間追蹤、即時診斷與管理操作集中在同一頁。", "zh-CN": "房间追踪、即时诊断与管理操作集中在同一页。", en: "Room tracking, live diagnostics, and moderation tools in one dashboard." },
    "15 分鐘活躍": { "zh-TW": "15 分鐘活躍", "zh-CN": "15 分钟活跃", en: "Active in 15 min" },
    "最近有 API / WS 活動": { "zh-TW": "最近有 API / WS 活動", "zh-CN": "最近有 API / WS 活动", en: "Recent API / WS activity" },
    "24 小時錯誤": { "zh-TW": "24 小時錯誤", "zh-CN": "24 小时错误", en: "Errors in 24h" },
    "個房間受影響": { "zh-TW": "個房間受影響", "zh-CN": "个房间受影响", en: "rooms affected" },
    "玩家聊天翻譯狀態": { "zh-TW": "玩家聊天翻譯狀態", "zh-CN": "玩家聊天翻译状态", en: "Player chat translation status" },
    "搜尋房號": { "zh-TW": "搜尋房號", "zh-CN": "搜索房号", en: "Search room" },
    "輸入房號": { "zh-TW": "輸入房號", "zh-CN": "输入房号", en: "Enter room code" },
    "活動狀態": { "zh-TW": "活動狀態", "zh-CN": "活动状态", en: "Activity" },
    "全部": { "zh-TW": "全部", "zh-CN": "全部", en: "All" },
    "15 分鐘內活躍": { "zh-TW": "15 分鐘內活躍", "zh-CN": "15 分钟内活跃", en: "Active within 15 min" },
    "15 分鐘以上未活動": { "zh-TW": "15 分鐘以上未活動", "zh-CN": "15 分钟以上未活动", en: "Inactive over 15 min" },
    "狀態": { "zh-TW": "狀態", "zh-CN": "状态", en: "Status" },
    "活躍": { "zh-TW": "活躍", "zh-CN": "活跃", en: "Active" },
    "閒置": { "zh-TW": "閒置", "zh-CN": "闲置", en: "Idle" },
    "操作": { "zh-TW": "操作", "zh-CN": "操作", en: "Actions" },
    "錯誤": { "zh-TW": "錯誤", "zh-CN": "错误", en: "Errors" },
    "筆": { "zh-TW": "筆", "zh-CN": "条", en: "records" },
    "組": { "zh-TW": "組", "zh-CN": "组", en: "groups" },
    "沒有符合條件的房間": { "zh-TW": "沒有符合條件的房間", "zh-CN": "没有符合条件的房间", en: "No rooms match the filters" },
    "錯誤診斷": { "zh-TW": "錯誤診斷", "zh-CN": "错误诊断", en: "Error diagnostics" },
    "關鍵字": { "zh-TW": "關鍵字", "zh-CN": "关键字", en: "Keyword" },
    "訊息 / detail / 房號": { "zh-TW": "訊息 / detail / 房號", "zh-CN": "消息 / detail / 房号", en: "Message / detail / room" },
    "全部房間": { "zh-TW": "全部房間", "zh-CN": "全部房间", en: "All rooms" },
    "錯誤分類": { "zh-TW": "錯誤分類", "zh-CN": "错误分类", en: "Category" },
    "全部分類": { "zh-TW": "全部分類", "zh-CN": "全部分类", en: "All categories" },
    "來源": { "zh-TW": "來源", "zh-CN": "来源", en: "Source" },
    "全部來源": { "zh-TW": "全部來源", "zh-CN": "全部来源", en: "All sources" },
    "時間範圍": { "zh-TW": "時間範圍", "zh-CN": "时间范围", en: "Time range" },
    "最近 24 小時": { "zh-TW": "最近 24 小時", "zh-CN": "最近 24 小时", en: "Last 24 hours" },
    "最近 6 小時": { "zh-TW": "最近 6 小時", "zh-CN": "最近 6 小时", en: "Last 6 hours" },
    "最近 3 天": { "zh-TW": "最近 3 天", "zh-CN": "最近 3 天", en: "Last 3 days" },
    "全部紀錄": { "zh-TW": "全部紀錄", "zh-CN": "全部记录", en: "All history" },
    "顯示方式": { "zh-TW": "顯示方式", "zh-CN": "显示方式", en: "Display mode" },
    "合併重複錯誤": { "zh-TW": "合併重複錯誤", "zh-CN": "合并重复错误", en: "Group duplicates" },
    "逐筆顯示": { "zh-TW": "逐筆顯示", "zh-CN": "逐条显示", en: "Show individual errors" },
    "最近發生": { "zh-TW": "最近發生", "zh-CN": "最近发生", en: "Latest" },
    "次數": { "zh-TW": "次數", "zh-CN": "次数", en: "Count" },
    "訊息": { "zh-TW": "訊息", "zh-CN": "消息", en: "Message" },
    "上一頁": { "zh-TW": "上一頁", "zh-CN": "上一页", en: "Previous" },
    "下一頁": { "zh-TW": "下一頁", "zh-CN": "下一页", en: "Next" },
    "頁": { "zh-TW": "頁", "zh-CN": "页", en: "page" },
    "第": { "zh-TW": "第", "zh-CN": "第", en: "Page" },
    "沒有符合條件的錯誤": { "zh-TW": "沒有符合條件的錯誤", "zh-CN": "没有符合条件的错误", en: "No errors match the filters" },
    "首次": { "zh-TW": "首次", "zh-CN": "首次", en: "First" },
    "重新載入": { "zh-TW": "重新載入", "zh-CN": "重新加载", en: "Reload" },
    "複製房號": { "zh-TW": "複製房號", "zh-CN": "复制房号", en: "Copy room code" },
    "只看此房錯誤": { "zh-TW": "只看此房錯誤", "zh-CN": "只看此房错误", en: "Errors for this room" },
    "已複製": { "zh-TW": "已複製", "zh-CN": "已复制", en: "copied" },
    "無法複製房號": { "zh-TW": "無法複製房號", "zh-CN": "无法复制房号", en: "Could not copy room code" },
    "更新時間": { "zh-TW": "更新時間", "zh-CN": "更新时间", en: "Updated" },
    "選擇一個房間查看。": { "zh-TW": "選擇一個房間查看。", "zh-CN": "选择一个房间查看。", en: "Select a room to inspect." },
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