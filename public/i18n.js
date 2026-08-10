const LOCALE_KEY = "werewolf-locale";
export const SUPPORTED_LOCALES = ["zh-TW", "zh-CN", "en"];

const UI = {
  "狼人殺": { "zh-TW": "狼人殺", "zh-CN": "狼人杀", en: "Werewolf" },
  "語言": { "zh-TW": "語言", "zh-CN": "语言", en: "Language" },
  "回首頁": { "zh-TW": "回首頁", "zh-CN": "返回首页", en: "Back to home" },
  "只做辯論式": { "zh-TW": "只做辯論式", "zh-CN": "仅辩论模式", en: "Debate mode only" },
  "離開此裝置上的登入": { "zh-TW": "離開此裝置上的登入", "zh-CN": "退出此设备上的登录", en: "Sign out on this device" },
  "CREATE": { "zh-TW": "建立", "zh-CN": "创建", en: "CREATE" },
  "建立房間": { "zh-TW": "建立房間", "zh-CN": "创建房间", en: "Create room" },
  "你的名稱": { "zh-TW": "你的名稱", "zh-CN": "你的名称", en: "Your name" },
  "人物密碼": { "zh-TW": "人物密碼", "zh-CN": "人物密码", en: "Player password" },
  "房間密碼": { "zh-TW": "房間密碼", "zh-CN": "房间密码", en: "Room password" },
  "選填": { "zh-TW": "選填", "zh-CN": "选填", en: "Optional" },
  "建立辯論房": { "zh-TW": "建立辯論房", "zh-CN": "创建辩论房", en: "Create debate room" },
  "JOIN": { "zh-TW": "加入", "zh-CN": "加入", en: "JOIN" },
  "前往房間": { "zh-TW": "前往房間", "zh-CN": "前往房间", en: "Go to room" },
  "房號": { "zh-TW": "房號", "zh-CN": "房号", en: "Room code" },
  "開啟 /房號": { "zh-TW": "開啟 /房號", "zh-CN": "打开 /房号", en: "Open /room-code" },
  "ROOM": { "zh-TW": "房間", "zh-CN": "房间", en: "ROOM" },
  "進入房間": { "zh-TW": "進入房間", "zh-CN": "进入房间", en: "Enter room" },
  "建立新人物，或用名稱＋人物密碼找回原本身份。": { "zh-TW": "建立新人物，或用名稱＋人物密碼找回原本身份。", "zh-CN": "创建新人物，或使用名称＋人物密码找回原身份。", en: "Create a new player, or recover an existing identity with name + player password." },
  "這個房間有設定房間密碼；建立人物與重新登入都必須先通過房間密碼。": { "zh-TW": "這個房間有設定房間密碼；建立人物與重新登入都必須先通過房間密碼。", "zh-CN": "该房间设置了房间密码；创建人物与重新登录都必须先验证房间密码。", en: "This room has a room password. Creating or recovering a player requires it first." },
  "建立新人物": { "zh-TW": "建立新人物", "zh-CN": "创建新人物", en: "Create new player" },
  "玩家名稱": { "zh-TW": "玩家名稱", "zh-CN": "玩家名称", en: "Player name" },
  "建立並加入": { "zh-TW": "建立並加入", "zh-CN": "创建并加入", en: "Create and join" },
  "回到原有人物": { "zh-TW": "回到原有人物", "zh-CN": "回到原人物", en: "Recover existing player" },
  "重新登入人物": { "zh-TW": "重新登入人物", "zh-CN": "重新登录人物", en: "Recover player" },
  "複製連結": { "zh-TW": "複製連結", "zh-CN": "复制链接", en: "Copy link" },
  "階段": { "zh-TW": "階段", "zh-CN": "阶段", en: "Phase" },
  "大廳": { "zh-TW": "大廳", "zh-CN": "大厅", en: "Lobby" },
  "輪次": { "zh-TW": "輪次", "zh-CN": "轮次", en: "Round" },
  "等待開始": { "zh-TW": "等待開始", "zh-CN": "等待开始", en: "Waiting" },
  "你的身份": { "zh-TW": "你的身份", "zh-CN": "你的身份", en: "Your role" },
  "尚未分配": { "zh-TW": "尚未分配", "zh-CN": "尚未分配", en: "Not assigned" },
  "陣營": { "zh-TW": "陣營", "zh-CN": "阵营", en: "Faction" },
  "ACTION": { "zh-TW": "操作", "zh-CN": "操作", en: "ACTION" },
  "本階段操作": { "zh-TW": "本階段操作", "zh-CN": "本阶段操作", en: "Current actions" },
  "PUBLIC CHAT": { "zh-TW": "公開聊天", "zh-CN": "公开聊天", en: "PUBLIC CHAT" },
  "公開聊天室與正式紀錄": { "zh-TW": "公開聊天室與正式紀錄", "zh-CN": "公开聊天室与正式记录", en: "Public chat and formal record" },
  "可聊天": { "zh-TW": "可聊天", "zh-CN": "可聊天", en: "Chat available" },
  "送出": { "zh-TW": "送出", "zh-CN": "发送", en: "Send" },
  "PLAYERS": { "zh-TW": "玩家", "zh-CN": "玩家", en: "PLAYERS" },
  "房內人物": { "zh-TW": "房內人物", "zh-CN": "房内人物", en: "Players in room" },
  "HOST": { "zh-TW": "房主", "zh-CN": "房主", en: "HOST" },
  "房主管理": { "zh-TW": "房主管理", "zh-CN": "房主管理", en: "Host controls" },
  "遊戲房規": { "zh-TW": "遊戲房規", "zh-CN": "游戏房规", en: "Game rules" },
  "啟用警長選舉": { "zh-TW": "啟用警長選舉", "zh-CN": "启用警长选举", en: "Enable sheriff election" },
  "死亡資訊": { "zh-TW": "死亡資訊", "zh-CN": "死亡信息", en: "Death information" },
  "完全隱藏": { "zh-TW": "完全隱藏", "zh-CN": "完全隐藏", en: "Hide all" },
  "顯示死者、隱藏死因": { "zh-TW": "顯示死者、隱藏死因", "zh-CN": "显示死者、隐藏死因", en: "Show deaths, hide causes" },
  "顯示死者與死因": { "zh-TW": "顯示死者與死因", "zh-CN": "显示死者与死因", en: "Show deaths and causes" },
  "平票處理": { "zh-TW": "平票處理", "zh-CN": "平票处理", en: "Tie handling" },
  "平票無人出局": { "zh-TW": "平票無人出局", "zh-CN": "平票无人出局", en: "No elimination on tie" },
  "全場重投": { "zh-TW": "全場重投", "zh-CN": "全场重投", en: "Full revote" },
  "平票玩家 PK 後重投": { "zh-TW": "平票玩家 PK 後重投", "zh-CN": "平票玩家 PK 后重投", en: "Tied players debate, then revote" },
  "平票隨機淘汰 1 人": { "zh-TW": "平票隨機淘汰 1 人", "zh-CN": "平票随机淘汰 1 人", en: "Randomly eliminate 1 tied player" },
  "套用房規": { "zh-TW": "套用房規", "zh-CN": "应用房规", en: "Apply rules" },
  "角色配置": { "zh-TW": "角色配置", "zh-CN": "角色配置", en: "Role setup" },
  "自動配置角色（依正式玩家數）": { "zh-TW": "自動配置角色（依正式玩家數）", "zh-CN": "自动配置角色（按正式玩家数）", en: "Auto-configure roles (by active players)" },
  "勾選後由伺服器依目前正式玩家數自動配置基本板子；取消後可手動調整 114 個角色。": { "zh-TW": "勾選後由伺服器依目前正式玩家數自動配置基本板子；取消後可手動調整 114 個角色。", "zh-CN": "勾选后由服务器按当前正式玩家数自动配置基础板子；取消后可手动调整 114 个角色。", en: "When enabled, the server builds a basic role setup from the current active-player count. Disable it to edit all 114 roles manually." },
  "自動配置角色已啟用；取消勾選後才能手動調整": { "zh-TW": "自動配置角色已啟用；取消勾選後才能手動調整", "zh-CN": "自动配置角色已启用；取消勾选后才能手动调整", en: "Automatic role setup is enabled. Disable it before editing roles manually." },
  "自動配置角色已啟用；請先取消勾選再手動調整角色": { "zh-TW": "自動配置角色已啟用；請先取消勾選再手動調整角色", "zh-CN": "自动配置角色已启用；请先取消勾选再手动调整角色", en: "Automatic role setup is enabled. Disable it before changing roles manually." },
  "全部歸零": { "zh-TW": "全部歸零", "zh-CN": "全部归零", en: "Set all to zero" },
  "套用角色配置": { "zh-TW": "套用角色配置", "zh-CN": "应用角色配置", en: "Apply role setup" },
  "選用 AI（BYOK）": { "zh-TW": "選用 AI（BYOK）", "zh-CN": "可选 AI（BYOK）", en: "Optional AI (BYOK)" },
  "AI 名稱": { "zh-TW": "AI 名稱", "zh-CN": "AI 名称", en: "AI name" },
  "Provider": { "zh-TW": "Provider", "zh-CN": "Provider", en: "Provider" },
  "Model": { "zh-TW": "Model", "zh-CN": "Model", en: "Model" },
  "Base URL": { "zh-TW": "Base URL", "zh-CN": "Base URL", en: "Base URL" },
  "API Keys": { "zh-TW": "API Keys", "zh-CN": "API Keys", en: "API Keys" },
  "最多 8 組，只存此瀏覽器 session": { "zh-TW": "最多 8 組，只存此瀏覽器 session", "zh-CN": "最多 8 组，仅保存在此浏览器 session", en: "Up to 8; stored only in this browser session" },
  "每行一組 API Key；遇到無效、限流或暫時性錯誤會自動切換下一組": { "zh-TW": "每行一組 API Key；遇到無效、限流或暫時性錯誤會自動切換下一組", "zh-CN": "每行一组 API Key；遇到无效、限流或临时错误时会自动切换下一组", en: "One API key per line. Invalid credentials, rate limits, or transient provider failures automatically try the next key." },
  "請至少輸入 1 組 API Key": { "zh-TW": "請至少輸入 1 組 API Key", "zh-CN": "请至少输入 1 组 API Key", en: "Enter at least one API key" },
  "只存此瀏覽器 session": { "zh-TW": "只存此瀏覽器 session", "zh-CN": "仅保存在此浏览器 session", en: "Stored only in this browser session" },
  "加入 AI 玩家": { "zh-TW": "加入 AI 玩家", "zh-CN": "加入 AI 玩家", en: "Add AI player" },
  "開始遊戲": { "zh-TW": "開始遊戲", "zh-CN": "开始游戏", en: "Start game" },
  "回大廳／下一局": { "zh-TW": "回大廳／下一局", "zh-CN": "回大厅／下一局", en: "Return to lobby / next game" },
  "房主": { "zh-TW": "房主", "zh-CN": "房主", en: "Host" },
  "警長": { "zh-TW": "警長", "zh-CN": "警长", en: "Sheriff" },
  "觀戰": { "zh-TW": "觀戰", "zh-CN": "观战", en: "Spectator" },
  "觀戰者": { "zh-TW": "觀戰者", "zh-CN": "观战者", en: "Spectator" },
  "出局": { "zh-TW": "出局", "zh-CN": "出局", en: "Eliminated" },
  "狼隊友": { "zh-TW": "狼隊友", "zh-CN": "狼队友", en: "Wolf teammate" },
  "發言中": { "zh-TW": "發言中", "zh-CN": "发言中", en: "Speaking" },
  "踢出": { "zh-TW": "踢出", "zh-CN": "踢出", en: "Kick" },
  "系統": { "zh-TW": "系統", "zh-CN": "系统", en: "System" },
  "翻譯中…": { "zh-TW": "翻譯中…", "zh-CN": "翻译中…", en: "Translating…" },
  "翻譯服務暫時無法使用，顯示原文。": { "zh-TW": "翻譯服務暫時無法使用，顯示原文。", "zh-CN": "翻译服务暂时不可用，显示原文。", en: "Translation is temporarily unavailable; showing the original." },
  "本階段不可聊天": { "zh-TW": "本階段不可聊天", "zh-CN": "本阶段不可聊天", en: "Chat unavailable in this phase" },
  "可自由聊天": { "zh-TW": "可自由聊天", "zh-CN": "可自由聊天", en: "Free chat available" },
  "未知玩家": { "zh-TW": "未知玩家", "zh-CN": "未知玩家", en: "Unknown player" },
  "好人陣營": { "zh-TW": "好人陣營", "zh-CN": "好人阵营", en: "Village" },
  "狼人陣營": { "zh-TW": "狼人陣營", "zh-CN": "狼人阵营", en: "Werewolf" },
  "怨靈陣營": { "zh-TW": "怨靈陣營", "zh-CN": "怨灵阵营", en: "Spirit" },
  "特殊／第三方": { "zh-TW": "特殊／第三方", "zh-CN": "特殊／第三方", en: "Neutral / special" },
  "血族陣營": { "zh-TW": "血族陣營", "zh-CN": "血族阵营", en: "Blood" },
  "解藥": { "zh-TW": "解藥", "zh-CN": "解药", en: "Antidote" },
  "毒藥": { "zh-TW": "毒藥", "zh-CN": "毒药", en: "Poison" },
  "跳過": { "zh-TW": "跳過", "zh-CN": "跳过", en: "Pass" },
  "使技能失效": { "zh-TW": "使技能失效", "zh-CN": "使技能失效", en: "Disable skill" },
  "凍結": { "zh-TW": "凍結", "zh-CN": "冻结", en: "Freeze" },
  "引爆凍結": { "zh-TW": "引爆凍結", "zh-CN": "引爆冻结", en: "Detonate frozen targets" },
  "白陽祝福": { "zh-TW": "白陽祝福", "zh-CN": "白阳祝福", en: "Day blessing" },
  "夜陰祝福": { "zh-TW": "夜陰祝福", "zh-CN": "夜阴祝福", en: "Night blessing" },
  "封鎖技能": { "zh-TW": "封鎖技能", "zh-CN": "封锁技能", en: "Block skill" },
  "死亡替換": { "zh-TW": "死亡替換", "zh-CN": "死亡替换", en: "Death substitution" },
  "支持好人": { "zh-TW": "支持好人", "zh-CN": "支持好人", en: "Support village" },
  "支持狼人": { "zh-TW": "支持狼人", "zh-CN": "支持狼人", en: "Support werewolves" },
  "支持怨靈": { "zh-TW": "支持怨靈", "zh-CN": "支持怨灵", en: "Support spirits" },
  "原作": { "zh-TW": "原作", "zh-CN": "原作", en: "Original" },
  "辯論改寫": { "zh-TW": "辯論改寫", "zh-CN": "辩论改写", en: "Debate adaptation" },
  "討論角色": { "zh-TW": "討論角色", "zh-CN": "讨论角色", en: "Community role" },
  "數量": { "zh-TW": "數量", "zh-CN": "数量", en: "Count" },
  "例如：Ray": { "zh-TW": "例如：Ray", "zh-CN": "例如：Ray", en: "e.g. Ray" },
  "至少 4 字元，之後用來找回人物": { "zh-TW": "至少 4 字元，之後用來找回人物", "zh-CN": "至少 4 个字符，之后用于找回人物", en: "At least 4 characters; used to recover this player" },
  "不填代表拿到房號即可進入": { "zh-TW": "不填代表拿到房號即可進入", "zh-CN": "留空表示知道房号即可进入", en: "Leave blank to allow anyone with the room code" },
  "例如：2U64RJ": { "zh-TW": "例如：2U64RJ", "zh-CN": "例如：2U64RJ", en: "e.g. 2U64RJ" },
  "同房不可重名": { "zh-TW": "同房不可重名", "zh-CN": "同一房间不可重名", en: "Names must be unique in this room" },
  "至少 4 字元": { "zh-TW": "至少 4 字元", "zh-CN": "至少 4 个字符", en: "At least 4 characters" },
  "原本的名稱": { "zh-TW": "原本的名稱", "zh-CN": "原来的名称", en: "Existing player name" },
  "自由聊天不等於正式發言……": { "zh-TW": "自由聊天不等於正式發言……", "zh-CN": "自由聊天不等于正式发言……", en: "Free chat does not count as formal speech…" },
  "搜尋角色、陣營或技能……": { "zh-TW": "搜尋角色、陣營或技能……", "zh-CN": "搜索角色、阵营或技能……", en: "Search role, faction, or ability…" },
  "例如：Gemini 7號": { "zh-TW": "例如：Gemini 7號", "zh-CN": "例如：Gemini 7号", en: "e.g. Gemini #7" },
  "不會寫入房間資料": { "zh-TW": "不會寫入房間資料", "zh-CN": "不会写入房间数据", en: "Never written to room data" },
  "房號格式不正確": { "zh-TW": "房號格式不正確", "zh-CN": "房号格式不正确", en: "Invalid room code format" },
  "房間連結已複製": { "zh-TW": "房間連結已複製", "zh-CN": "房间链接已复制", en: "Room link copied" },
  "人物已建立": { "zh-TW": "人物已建立", "zh-CN": "人物已创建", en: "Player created" },
  "已找回原本人物": { "zh-TW": "已找回原本人物", "zh-CN": "已找回原人物", en: "Player recovered" },
  "房規已送出": { "zh-TW": "房規已送出", "zh-CN": "房规已提交", en: "Rules submitted" },
  "角色配置已送出": { "zh-TW": "角色配置已送出", "zh-CN": "角色配置已提交", en: "Role setup submitted" },
  "AI 操作已完成": { "zh-TW": "AI 操作已完成", "zh-CN": "AI 操作已完成", en: "AI action completed" },
  "WebSocket 尚未連線": { "zh-TW": "WebSocket 尚未連線", "zh-CN": "WebSocket 尚未连接", en: "WebSocket is not connected yet" },
  "找不到這個房間，或房間暫時無法讀取。": { "zh-TW": "找不到這個房間，或房間暫時無法讀取。", "zh-CN": "找不到该房间，或房间暂时无法读取。", en: "This room was not found or is temporarily unavailable." },
  "房間不存在": { "zh-TW": "房間不存在", "zh-CN": "房间不存在", en: "Room does not exist" },
  "房間密碼錯誤": { "zh-TW": "房間密碼錯誤", "zh-CN": "房间密码错误", en: "Incorrect room password" },
  "玩家名稱或人物密碼錯誤": { "zh-TW": "玩家名稱或人物密碼錯誤", "zh-CN": "玩家名称或人物密码错误", en: "Incorrect player name or password" },
  "這個玩家名稱已被使用，請登入原有人物或改用其他名稱": { "zh-TW": "這個玩家名稱已被使用，請登入原有人物或改用其他名稱", "zh-CN": "该玩家名称已被使用，请登录原人物或使用其他名称", en: "That player name is already in use. Recover the existing player or choose another name." },
  "登入嘗試過多，請稍後再試": { "zh-TW": "登入嘗試過多，請稍後再試", "zh-CN": "登录尝试过多，请稍后再试", en: "Too many login attempts. Try again later." },
  "人物密碼至少 4 個字元": { "zh-TW": "人物密碼至少 4 個字元", "zh-CN": "人物密码至少 4 个字符", en: "Player password must be at least 4 characters" },
  "玩家名稱不能為空白": { "zh-TW": "玩家名稱不能為空白", "zh-CN": "玩家名称不能为空", en: "Player name cannot be blank" },
  "人物密碼至少需要 4 個字元": { "zh-TW": "人物密碼至少需要 4 個字元", "zh-CN": "人物密码至少需要 4 个字符", en: "Player password must be at least 4 characters" },
  "房間密碼至少需要 4 個字元": { "zh-TW": "房間密碼至少需要 4 個字元", "zh-CN": "房间密码至少需要 4 个字符", en: "Room password must be at least 4 characters" },
  "人物密碼長度不可超過 72 個字元": { "zh-TW": "人物密碼長度不可超過 72 個字元", "zh-CN": "人物密码长度不能超过 72 个字符", en: "Player password cannot exceed 72 characters" },
  "房間密碼長度不可超過 72 個字元": { "zh-TW": "房間密碼長度不可超過 72 個字元", "zh-CN": "房间密码长度不能超过 72 个字符", en: "Room password cannot exceed 72 characters" },
  "你已被踢出；可重新建立人物加入": { "zh-TW": "你已被踢出；可重新建立人物加入", "zh-CN": "你已被踢出；可以重新创建人物加入", en: "You were kicked; you may create a new player and rejoin." },
  "登入已更新，請重新登入": { "zh-TW": "登入已更新，請重新登入", "zh-CN": "登录已更新，请重新登录", en: "Your session changed. Please sign in again." },
  "已以觀戰者身份加入；下一局會轉正式玩家": { "zh-TW": "已以觀戰者身份加入；下一局會轉正式玩家", "zh-CN": "已以观战者身份加入；下一局会转为正式玩家", en: "Joined as a spectator; you will become a player next game." },
  "翻譯服務回傳格式錯誤": { "zh-TW": "翻譯服務回傳格式錯誤", "zh-CN": "翻译服务返回格式错误", en: "Translation service returned an invalid response" },
  "收到無法解析的伺服器訊息": { "zh-TW": "收到無法解析的伺服器訊息", "zh-CN": "收到无法解析的服务器消息", en: "Received an unreadable server message" }
};

const nodeSources = new WeakMap();
const attrSources = new WeakMap();
const dynamicCache = new Map();
const inFlight = new Map();
let locale = normalizeLocale(localStorage.getItem(LOCALE_KEY) || navigator.language || "zh-TW");

export function normalizeLocale(value) {
  const raw = String(value || "").toLowerCase();
  if (raw === "en" || raw.startsWith("en-")) return "en";
  if (raw === "zh-cn" || raw === "zh-sg" || raw.includes("hans")) return "zh-CN";
  return "zh-TW";
}

export function getLocale() { return locale; }
export function setLocale(value) {
  locale = normalizeLocale(value);
  localStorage.setItem(LOCALE_KEY, locale);
  document.documentElement.lang = locale;
  return locale;
}
export function intlLocale() { return locale; }
export function siteTitle() { return knownText("狼人殺"); }

export function knownText(source, target = locale) {
  return UI[source]?.[target] ?? source;
}

function cacheKey(source, sourceLocale, targetLocale) {
  return `${sourceLocale || "auto"}\u0000${targetLocale}\u0000${source}`;
}

export function displayText(source, sourceLocale = "zh-TW", targetLocale = locale) {
  const text = String(source ?? "");
  if (!text || targetLocale === sourceLocale) return text;
  if (sourceLocale === "zh-TW" && UI[text]?.[targetLocale]) return UI[text][targetLocale];
  return dynamicCache.get(cacheKey(text, sourceLocale, targetLocale)) ?? null;
}

export async function ensureTranslations(texts, sourceLocale, remoteTranslate, targetLocale = locale) {
  const unique = [...new Set(texts.map((v) => String(v ?? "")).filter(Boolean))];
  if (!unique.length || !remoteTranslate) return;
  const missing = unique.filter((text) => displayText(text, sourceLocale, targetLocale) === null);
  if (!missing.length) return;
  const requestKey = `${sourceLocale || "auto"}\u0000${targetLocale}\u0000${missing.join("\u0001")}`;
  if (inFlight.has(requestKey)) return inFlight.get(requestKey);
  const task = (async () => {
    try {
      const translated = await remoteTranslate(missing, sourceLocale, targetLocale);
      if (!Array.isArray(translated) || translated.length !== missing.length) return;
      missing.forEach((text, index) => dynamicCache.set(cacheKey(text, sourceLocale, targetLocale), String(translated[index] ?? text)));
    } catch {
      missing.forEach((text) => dynamicCache.set(cacheKey(text, sourceLocale, targetLocale), text));
    } finally {
      inFlight.delete(requestKey);
    }
  })();
  inFlight.set(requestKey, task);
  return task;
}

function shouldSkip(node) {
  const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return !el || Boolean(el.closest("script, style, [data-no-translate], #messages"));
}

function originalText(node) {
  if (!nodeSources.has(node)) nodeSources.set(node, node.nodeValue || "");
  return nodeSources.get(node) || "";
}

function replaceTrimmed(original, translated) {
  const trimmed = original.trim();
  if (!trimmed) return original;
  const start = original.indexOf(trimmed);
  return `${original.slice(0, start)}${translated}${original.slice(start + trimmed.length)}`;
}

export async function localizeDom(root = document, remoteTranslate) {
  document.documentElement.lang = locale;
  const pending = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (shouldSkip(node)) continue;
    const original = originalText(node);
    const source = original.trim();
    if (!source) continue;
    const known = UI[source]?.[locale];
    if (known) {
      node.nodeValue = replaceTrimmed(original, known);
      continue;
    }
    if (locale === "zh-TW") {
      node.nodeValue = original;
      continue;
    }
    const cached = displayText(source, "zh-TW", locale);
    if (cached !== null) node.nodeValue = replaceTrimmed(original, cached);
    else if (remoteTranslate && /[\p{L}\p{Script=Han}]/u.test(source)) pending.push({ node, original, source });
  }

  const elements = root.querySelectorAll ? root.querySelectorAll("[placeholder], [aria-label], [title]") : [];
  const attrPending = [];
  for (const el of elements) {
    if (el.closest("[data-no-translate]")) continue;
    let map = attrSources.get(el);
    if (!map) { map = {}; attrSources.set(el, map); }
    for (const attr of ["placeholder", "aria-label", "title"]) {
      if (!el.hasAttribute(attr)) continue;
      if (!(attr in map)) map[attr] = el.getAttribute(attr) || "";
      const source = map[attr];
      if (!source) continue;
      const known = UI[source]?.[locale];
      if (known) { el.setAttribute(attr, known); continue; }
      if (locale === "zh-TW") { el.setAttribute(attr, source); continue; }
      const cached = displayText(source, "zh-TW", locale);
      if (cached !== null) el.setAttribute(attr, cached);
      else if (remoteTranslate && /[\p{L}\p{Script=Han}]/u.test(source)) attrPending.push({ el, attr, source });
    }
  }

  const all = [...new Set([...pending.map((x) => x.source), ...attrPending.map((x) => x.source)])];
  if (!all.length || !remoteTranslate) return;
  await ensureTranslations(all, "zh-TW", remoteTranslate, locale);
  for (const item of pending) {
    if (!item.node.isConnected) continue;
    const translated = displayText(item.source, "zh-TW", locale);
    if (translated !== null) item.node.nodeValue = replaceTrimmed(item.original, translated);
  }
  for (const item of attrPending) {
    if (!item.el.isConnected) continue;
    const translated = displayText(item.source, "zh-TW", locale);
    if (translated !== null) item.el.setAttribute(item.attr, translated);
  }
}
