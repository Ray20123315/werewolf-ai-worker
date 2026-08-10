# 多語言規則

本專案將遊戲內容與玩家自由文字分開處理。

## 遊戲內容

UI、角色名稱、角色說明、辯論改寫說明、系統訊息與其他規則文字採固定三語翻譯：`zh-TW`、`zh-CN`、`en`。

這些文字不呼叫 Google Translation，也不使用生成式 AI。繁體中文是 canonical source；簡體中文與英文由 repository 內固定翻譯表提供，因此切換語言後結果可重現且不產生翻譯 API 費用。

## 玩家聊天與正式發言

玩家自行輸入的 `chat` 與 `speech` 文字無法預先列入固定翻譯表，因此跨語言顯示時使用 Google Cloud Translation Basic v2。

Google Translation 只負責玩家自由文字，不負責角色、UI、系統訊息或規則文字。翻譯失敗時保留原文，不阻塞遊戲。

Production 仍需設定 Cloudflare Worker Secret：

```text
GOOGLE_TRANSLATE_API_KEYS
```

可放 1～8 組 Key，以換行、逗號或分號分隔。Key 不得提交至 Git、前端程式碼或房間狀態。
