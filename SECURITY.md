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
- The host browser keeps the provider credential in `sessionStorage` for the current browser session.
- The credential is sent only with the immediate `/api/rooms/:roomId/ai/run` request that needs it.
- The Worker/Durable Object does not write the API Key to GameState, Durable Object storage, source code, repository configuration, or application logs.
- Custom OpenAI-compatible Base URLs must use HTTPS.

## 3. Private game information

The canonical room state remains server-side in a `GameRoom` Durable Object. Clients receive a personalized projection only.

- Regular players do not receive other players' roles.
- Role-specific inspection results are returned only to the corresponding player.
- Wolf teammate visibility follows the enabled role's information rules.
- Spectators joining an active game do not receive a new role.
- Full roles are revealed when the game ends, except special private-information roles receive only what their role permits during play.

## 4. Debate-mode security invariant

Free chat cannot advance the formal debate state. Server-side state validates the current formal speaker and only moves to voting after the debate order is complete. Physical/PvP mechanics from the Minecraft source material are not trusted client actions and are not part of this implementation.

## 5. Reporting

Do not post API Keys, room passwords, player passwords, session tokens, or private role state in a public issue. Provide the minimum reproducible information needed to investigate a security problem.
