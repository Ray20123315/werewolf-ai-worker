import { GameRoom } from "./room";
import { installChatChannels } from "./chat-channels";
import { ROLE_LIST } from "./roles";
import type { AIConfig } from "./types";
import { normalizeTranslationLocale, translateTexts, validateTranslationTexts } from "./translate";

installChatChannels(GameRoom);
export { GameRoom };

type JsonObject = Record<string, unknown>;
type WorkerEnv = Env;

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        return json({ ok: true, service: "werewolf-ai-worker", runtime: "cloudflare-workers", aiMode: "byok", translation: "google-gtx+mymemory-fallback", mode: "debate-only" });
      }

      if (request.method === "GET" && url.pathname === "/api/roles") {
        return json({ roles: ROLE_LIST.map(({ id, name, faction, summary, source, action, passives, foolVariant, aliases, debateAdaptation }) => ({
          id, name, faction, summary, source, action, passives, foolVariant, aliases, debateAdaptation
        })) });
      }

      if (request.method === "POST" && url.pathname === "/api/rooms") {
        const body = await readJson(request);
        const name = stringField(body, "name");
        const playerPassword = stringField(body, "playerPassword", 72);
        const roomPassword = optionalStringField(body, "roomPassword", 72);
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const roomId = randomRoomCode();
          const room = env.GAME_ROOM.getByName(roomId);
          try {
            return json(await room.initialize(roomId, name, playerPassword, roomPassword), 201);
          } catch (error) {
            if (error instanceof Error && error.message.includes("ROOM_ALREADY_EXISTS")) continue;
            throw error;
          }
        }
        throw new Error("建立房間失敗，請重試");
      }

      const translate = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})\/translate$/);
      if (translate && request.method === "POST") {
        const body = await readJson(request);
        const room = env.GAME_ROOM.getByName(translate[1]!);
        const token = stringField(body, "token");
        await room.getStateByToken(token);
        const targetLocale = normalizeTranslationLocale(body.targetLocale);
        if (!targetLocale) throw new Error("targetLocale 無效");
        const sourceLocale = body.sourceLocale === undefined ? undefined : normalizeTranslationLocale(body.sourceLocale);
        if (body.sourceLocale !== undefined && !sourceLocale) throw new Error("sourceLocale 無效");
        const texts = validateTranslationTexts(body.texts);
        return json({ translations: await translateTexts(fetch, texts, targetLocale, sourceLocale), targetLocale });
      }

      const roomInfo = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})\/info$/);
      if (roomInfo && request.method === "GET") return json(await env.GAME_ROOM.getByName(roomInfo[1]!).roomInfo());

      const aiRun = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})\/ai\/run$/);
      if (aiRun && request.method === "POST") {
        const body = await readJson(request);
        const apiKeys = stringArrayField(body, "apiKeys", 8, 1024, body.apiKey);
        return json(await env.GAME_ROOM.getByName(aiRun[1]!).runAI(
          stringField(body, "token"), stringField(body, "playerId"), apiKeys
        ));
      }

      const match = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})(?:\/(join|login|ai|state|ws))?$/);
      if (!match) return json({ error: "Not found" }, 404);
      const roomId = match[1]!;
      const action = match[2] ?? "state";
      const room = env.GAME_ROOM.getByName(roomId);

      if (action === "join" && request.method === "POST") {
        const body = await readJson(request);
        return json(await room.joinHuman(
          stringField(body, "name"), stringField(body, "playerPassword", 72), optionalStringField(body, "roomPassword", 72)
        ), 201);
      }
      if (action === "login" && request.method === "POST") {
        const body = await readJson(request);
        return json(await room.loginHuman(
          stringField(body, "name"), stringField(body, "playerPassword", 72), optionalStringField(body, "roomPassword", 72)
        ));
      }
      if (action === "ai" && request.method === "POST") {
        const body = await readJson(request);
        return json(await room.addAI(stringField(body, "token"), stringField(body, "name"), parseAIConfig(body)), 201);
      }
      if (action === "state" && request.method === "GET") return json(await room.getStateByToken(url.searchParams.get("token") ?? ""));
      if (action === "ws" && request.method === "GET") return room.fetch(request);
      return json({ error: "Method not allowed" }, 405);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal error";
      const status = message.includes("不存在") ? 404
        : message.includes("憑證") || message.includes("只有房主") ? 403
          : message.includes("密碼錯誤") || message.includes("名稱或人物密碼錯誤") ? 401
            : message.startsWith("AI provider HTTP") || message.includes("翻譯服務暫時無法使用") ? 502
              : 400;
      return json({ error: message }, status);
    }
  }
};

function stringArrayField(body: JsonObject, key: string, maxItems: number, maxLength: number, legacy?: unknown): string[] {
  const raw = body[key] ?? (typeof legacy === "string" ? [legacy] : undefined);
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > maxItems) throw new Error(`${key} 必須包含 1~${maxItems} 組 API Key`);
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") throw new Error(`${key} 內容格式錯誤`);
    const value = item.trim();
    if (!value || value.length > maxLength) throw new Error(`${key} 包含無效 API Key`);
    if (!out.includes(value)) out.push(value);
  }
  if (!out.length) throw new Error(`${key} 必須至少有 1 組有效 API Key`);
  return out;
}

function parseAIConfig(body: JsonObject): AIConfig {
  const rawProvider = stringField(body, "provider");
  if (!isAIProvider(rawProvider)) throw new Error("AI provider 無效");
  const config: AIConfig = { provider: rawProvider, model: stringField(body, "model", 120) };
  if (rawProvider === "openai-compatible") config.baseUrl = stringField(body, "baseUrl", 500);
  return config;
}

function isAIProvider(value: string): value is AIConfig["provider"] {
  return value === "openai" || value === "gemini" || value === "deepseek" || value === "openai-compatible";
}

async function readJson(request: Request): Promise<JsonObject> {
  const data = await request.json() as unknown;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("JSON body 格式錯誤");
  return data as JsonObject;
}

function stringField(body: JsonObject, key: string, maxLength = 200): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} 為必填字串`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new Error(`${key} 長度超過限制`);
  return trimmed;
}

function optionalStringField(body: JsonObject, key: string, maxLength = 200): string | undefined {
  const value = body[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${key} 必須是字串`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) throw new Error(`${key} 長度超過限制`);
  return trimmed;
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
