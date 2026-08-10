# 多語言規則

本專案將遊戲內容與玩家自由文字分開處理。

## 遊戲內容

UI、角色名稱、角色說明、辯論改寫說明、系統訊息與其他規則文字採固定三語翻譯：`zh-TW`、`zh-CN`、`en`。

這些文字不呼叫遠端翻譯服務，也不使用生成式 AI。繁體中文是 canonical source；簡體中文與英文由 repository 內固定翻譯表提供，因此切換語言後結果可重現且不產生翻譯 API 費用。

## 玩家聊天與正式發言

玩家自行輸入的 `chat` 與 `speech` 文字無法預先列入固定翻譯表，因此跨語言顯示時才使用遠端機器翻譯。

主要翻譯鏈路照使用者提供的 Userscript：

```text
GET https://translate.googleapis.com/translate_a/single
    ?client=gtx
    &sl=auto
    &tl=<target locale>
    &dt=t
    &q=<text>
```

Google 先發送；若尚未快速得到可用結果，180ms 後可啟動 MyMemory 備援：

```text
GET https://api.mymemory.translated.net/get?q=<text>&langpair=<source>|<target>
```

若 MyMemory 先回傳，仍保留 140ms 的 Google 優先等待窗；Google 在該窗口內完成時優先採用 Google 結果。MyMemory 只處理 UTF-8 長度不超過 500 bytes 的短文字。

網站不是 Tampermonkey Userscript，不能依賴 `GM_xmlhttpRequest`。因此瀏覽器仍呼叫已有房間憑證保護的 `/api/rooms/:roomId/translate`，再由 Cloudflare Worker 代為呼叫上述 Google / MyMemory endpoint。這樣也不會把翻譯代理公開給未登入房間的人。

此翻譯方式不使用 Google Cloud Translation Basic v2，也不需要 `GOOGLE_TRANSLATE_API_KEYS`、Google Cloud Project 或 Worker Secret。它使用的是 Userscript 中的 `translate.googleapis.com` `client=gtx` 路徑，屬非 Google Cloud Translation 公開 API；上游若改動、限流或失效，翻譯可能暫時不可用。失敗時前端保留原文，不阻塞遊戲。

## 邊界

- `system` / `role` 訊息：只用固定三語，不送 Google / MyMemory。
- UI、角色資料、規則、技能、錯誤文字：只用固定三語，不送 Google / MyMemory。
- 玩家 `chat` / `speech`：跨語言顯示時才送遠端翻譯。
- 不使用 ChatGPT、Gemini 或其他生成式 AI 來翻譯玩家聊天。
