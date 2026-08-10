# Security

## Credential model

This project uses BYOK (bring your own key) for optional AI players.

- The deployer does **not** need to configure OpenAI, Gemini, DeepSeek, or custom-provider secrets in Cloudflare.
- A room host who adds an AI player supplies that provider credential in their browser.
- The browser keeps the credential in `sessionStorage` for the current tab/session.
- When an AI turn is pending, the credential is sent only with that immediate `/api/rooms/:roomId/ai/run` request.
- The Worker/Durable Object uses it for the provider request and does not write it to `GameState`, Durable Object storage, source code, repository configuration, or application logs.
- Closing the tab/session removes the browser-held credential; after reopening, the host must enter it again before that AI can act.

The credential necessarily transits the deployed Worker for the duration of the provider call. This avoids embedding provider secrets in shipped browser JavaScript while ensuring the deployment owner does not provide or pay for a shared provider key.

## Room and player credentials

Each human player receives an opaque random room token. Treat it as a session credential. Do not share it or log it. WebSocket and state endpoints validate this token before returning personalized state.

## Private game information

The canonical room state remains server-side in a `GameRoom` Durable Object. Browser clients receive a personalized projection only:

- regular players do not receive other players' roles;
- werewolves receive only their permitted teammate information;
- seers receive only their own inspection results;
- witch and guard private state is scoped to the corresponding player;
- full roles are revealed only when the game ends.

## Custom OpenAI-compatible endpoints

Custom provider Base URLs must use HTTPS. Do not enter an endpoint you do not trust: the user-supplied API credential is sent to that endpoint as part of the requested provider call.

## Reporting

If you find a security issue, avoid posting secrets or room tokens in a public issue. Provide the minimum reproducible detail needed to investigate.
