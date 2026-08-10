# Security

## 1. Room and player authentication

- Room password is optional; human player password is mandatory for newly created people.
- Player names are normalized with Unicode NFKC, collapsed whitespace, and a case-insensitive room key before uniqueness checks.
- Passwords are never stored as plaintext. The Durable Object persists a per-password random salt plus PBKDF2-SHA-256 verifier.
- Successful player re-login rotates the opaque session token and closes older WebSocket sessions for that player.
- Repeated incorrect player or room-password attempts are throttled inside the room object. This is a lightweight abuse guard, not a substitute for edge/WAF rate limiting on a public high-risk deployment.
- A kicked player is not permanently banned. Their old token is invalidated and the name is released. Rejoining during an active game creates a spectator until the next lobby to prevent role reroll abuse.
- Legacy pre-password people can set a password only while they still possess a valid old session token.

## 2. BYOK AI credentials

This project uses BYOK (bring your own key) for optional AI players.

- The deployer does not need shared OpenAI, Gemini, DeepSeek, or custom-provider secrets.
- Each AI player may have a pool of 1–8 provider API keys. The host browser keeps that pool in `sessionStorage` for the current browser session.
- The credential pool is sent only with the immediate `/api/rooms/:roomId/ai/run` request that needs it.
- The Worker tries the next key only for credential, quota/rate-limit, timeout, or transient provider failures. Gameplay validation errors are not retried with another key.
- The Worker/Durable Object does not write the provider API keys to GameState, Durable Object storage, source code, repository configuration, or application logs.
- Custom OpenAI-compatible Base URLs must use HTTPS.
- AI formal-speech decisions may include a structured day-action intent. The server re-validates the requested effect, target count, legal targets, and options against the current role prompt. Speech keywords such as “自爆” or “決鬥” do not execute an action by themselves.

## 3. Translation data path

The trilingual UI supports Traditional Chinese (`zh-TW`), Simplified Chinese (`zh-CN`), and English (`en`). Dynamic cross-language text is translated with Google Cloud Translation Basic v2.

- Translation does **not** use or expose the host's BYOK game-AI credentials.
- The deployment supplies Google Translation credentials through the Worker Secret `GOOGLE_TRANSLATE_API_KEYS`. It accepts 1–8 API keys separated by newline, comma, or semicolon; real keys must never be committed to the repository.
- `/api/rooms/:roomId/translate` requires a valid room/player session before translation is allowed.
- Translation requests are bounded by item count, per-item length, and total request length.
- Player chat and formal speeches remain canonical in their original text in room state. Human-authored text uses translation-provider source-language auto-detection instead of trusting the UI language as message language; known AI/system text may carry an explicit source locale. Translation changes presentation only.
- Translated variants are cached only in the viewer's current page memory by the client implementation; they are not written back into the canonical room state.
- When a viewer requests another language, the relevant text is sent to Google Cloud Translation. Deployers should account for Google Cloud privacy, quota, billing, API-key restrictions, and credential rotation.
- On invalid credentials, quota/rate limiting, or transient service errors, the translation layer may try the next configured Google API key. Other deterministic request errors fail immediately.
- Translation failure falls back to the original text and never blocks chat, debate progression, or voting. The browser keeps a short failure state instead of caching the original text as a successful translation, so failures are visible and can be retried.

## 4. Global admin backend and room moderators

- `/api/admin/*` requires a Bearer credential configured only through the Worker Secret `ADMIN_PANEL_TOKENS`; valid tokens must be at least 24 characters and up to eight may be configured. Do not store real admin tokens in source, `wrangler.jsonc`, or `.dev.vars.example`.
- The `/admin` page keeps the entered admin token only in browser `sessionStorage`, not persistent `localStorage`.
- Admin responses intentionally omit password verifiers, room/player session tokens, Google Translation credentials, and game-AI BYOK credentials.
- The global `RoomDirectory` Durable Object stores only room registry metadata and bounded diagnostic entries. Diagnostics are sanitized before persistence to redact common Bearer/API-key/token forms. Do not treat this as a general-purpose log sink for request bodies or secrets.
- Application-level translation/AI/API/WebSocket errors may be visible to global administrators for debugging. The error ledger is bounded; Cloudflare Observability remains the authoritative platform-level source for runtime failures that occur before application error handling can run.
- Room moderators are separate from the host. Moderators may perform limited room-order actions such as kicking ordinary players, but cannot start/reset the game or change host-only game settings/role setup, and cannot kick the host or another moderator.
- Durable Object namespaces are not enumerable by this application. The all-room view is therefore a registry of rooms created or accessed after this feature is deployed, plus older room codes manually registered by an administrator.

## 5. Private game information

The canonical room state remains server-side in a `GameRoom` Durable Object. Clients receive a personalized projection only.

- Regular players do not receive other players' roles.
- Role-specific inspection results are returned only to the corresponding player.
- Wolf teammate visibility follows the enabled role's information rules.
- Spectators joining an active game do not receive a new role.
- Full roles are revealed when the game ends, except special private-information roles receive only what their role permits during play.

## 6. Debate-mode security invariant

Free chat cannot advance the formal debate state. Server-side state validates the current formal speaker and only moves to voting after the debate order is complete. Physical/PvP mechanics from the Minecraft source material are not trusted client actions and are not part of this implementation.

Automatic role setup is also server-authoritative: while enabled, manual role configuration is rejected and the server recomputes the basic setup from the current formal-player count before game start.

## 7. Reporting

Do not post API Keys, room passwords, player passwords, session tokens, or private role state in a public issue. Provide the minimum reproducible information needed to investigate a security problem.
