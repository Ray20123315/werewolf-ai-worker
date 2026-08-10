export { GameRoom } from "./room";
import type { AIConfig } from "./types";

type JsonObject = Record<string, unknown>;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        return json({ ok: true, service: "werewolf-ai-worker", runtime: "cloudflare-workers" });
      }

      if (request.method === "POST" && url.pathname === "/api/rooms") {
        const body = await readJson(request);
        const name = stringField(body, "name");
        const maxPlayers = clampInt(numberField(body, "maxPlayers", 8), 5, 12);
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const roomId = randomRoomCode();
          const room = env.GAME_ROOM.getByName(roomId);
          try {
            const result = await room.initialize(roomId, name, maxPlayers);
            return json(result, 201);
          } catch (error) {
            if (error instanceof Error && error.message.includes("ROOM_ALREADY_EXISTS")) continue;
            throw error;
          }
        }
        throw new Error("建立房間失敗，請重試");
      }

      const match = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})(?:\/(join|ai|state|ws))?$/);
      if (!match) return json({ error: "Not found" }, 404);
      const roomId = match[1]!;
      const action = match[2] ?? "state";
      const room = env.GAME_ROOM.getByName(roomId);

      if (action === "join" && request.method === "POST") {
        const body = await readJson(request);
        return json(await room.joinHuman(stringField(body, "name")), 201);
      }

      if (action === "ai" && request.method === "POST") {
        const body = await readJson(request);
        const ai = parseAIConfig(body, env);
        return json(await room.addAI(stringField(body, "token"), stringField(body, "name"), ai), 201);
      }

      if (action === "state" && request.method === "GET") {
        const token = url.searchParams.get("token") ?? "";
        return json(await room.getStateByToken(token));
      }

      if (action === "ws" && request.method === "GET") {
        return room.fetch(request);
      }

      return json({ error: "Method not allowed" }, 405);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal error";
      const status = message.includes("不存在") ? 404 : message.includes("憑證") || message.includes("只有房主") ? 403 : 400;
      return json({ error: message }, status);
    }
  }
};

function parseAIConfig(body: JsonObject, env: Env): AIConfig {
  const rawProvider = stringField(body, "provider");
  if (!isAIProvider(rawProvider)) throw new Error("AI provider 無效");
  const provider = rawProvider;
  const explicitModel = optionalStringField(body, "model");
  const defaults: Record<AIConfig["provider"], string> = {
    openai: env.OPENAI_MODEL_DEFAULT,
    gemini: env.GEMINI_MODEL_DEFAULT,
    deepseek: env.DEEPSEEK_MODEL_DEFAULT,
    "openai-compatible": env.CUSTOM_OPENAI_MODEL_DEFAULT
  };
  const model = explicitModel || defaults[provider];
  if (!model) throw new Error("請指定 AI model");
  return { provider, model };
}

function isAIProvider(value: string): value is AIConfig["provider"] {
  return value === "openai" || value === "gemini" || value === "deepseek" || value === "openai-compatible";
}

async function readJson(request: Request): Promise<JsonObject> {
  const data = await request.json() as unknown;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("JSON body 格式錯誤");
  return data as JsonObject;
}

function stringField(body: JsonObject, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} 為必填字串`);
  return value.trim();
}

function optionalStringField(body: JsonObject, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value.trim() : "";
}

function numberField(body: JsonObject, key: string, fallback: number): number {
  const value = body[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function randomRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) code += alphabet[byte % alphabet.length];
  return code;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}
