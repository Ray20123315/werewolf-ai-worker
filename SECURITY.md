# Security

## API keys

Never commit provider API keys. Production keys must be stored as Cloudflare Worker Secrets or Secrets Store bindings. Local development keys belong in `.dev.vars`, which is ignored by Git.

Supported secret names:

- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `DEEPSEEK_API_KEY`
- `CUSTOM_OPENAI_API_KEY`

The custom OpenAI-compatible endpoint URL is non-secret configuration in `CUSTOM_OPENAI_BASE_URL`.

## Game-state isolation

Each room is a separate Durable Object. Browser clients receive a personalized projection of state, not the complete server-side state. Hidden roles, wolf teammates, seer results, and witch information are only included when the requesting player's role is entitled to see them.

## Session tokens

Room player tokens are generated using Web Crypto and are only stored in the player's browser local storage and the room's Durable Object state. Treat a leaked token as a session credential.
