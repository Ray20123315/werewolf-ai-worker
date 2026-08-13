import { GameRoom } from "./room";
import { installChatChannels } from "./chat-channels";
export { RoomDirectory } from "./room-directory";
import { classifyDiagnostic, isAdminRequest, parseAdminTokens, parseBoundedIntegerQuery, sanitizeDiagnosticMessage } from "./admin";
import { ROLE_LIST } from "./roles";
import type { AIConfig } from "./types";
import { normalizeTranslationLocale, translateTexts, validateTranslationTexts } from "./translate";

installChatChannels(GameRoom);
export { GameRoom };

type JsonObject = Record<string, unknown>;
type WorkerEnv = Env & { ADMIN_PANEL_TOKENS?: string };

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/admin" || url.pathname === "/admin/") {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = "/admin.html";
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      if (url.pathname.startsWith("/api/admin")) return await handleAdmin(request, url, env, ctx);

      if (request.method === "GET" && url.pathname === "/api/health") {
        return json({
          ok: true,
          service: "werewolf-ai-worker",
          runtime: "cloudflare-workers",
          aiMode: "byok",
          translation: "google-gtx+mymemory-fallback",
          translationConfigured: true,
          adminConfigured: parseAdminTokens(env.ADMIN_PANEL_TOKENS).length > 0,
          mode: "debate-only"
        });
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
            const result = await room.initialize(roomId, name, playerPassword, roomPassword);
            trackRoom(ctx, env, roomId);
            return json(result, 201);
          } catch (error) {
            if (error instanceof Error && error.message.includes("ROOM_ALREADY_EXISTS")) continue;
            throw error;
          }
        }
        throw new Error("建立房間失敗，請重試");
      }

      const translate = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})\/translate$/);
      if (translate && request.method === "POST") {
        const roomId = translate[1]!;
        const body = await readJson(request);
        const room = env.GAME_ROOM.getByName(roomId);
        const token = stringField(body, "token");
        await room.getStateByToken(token);
        trackRoom(ctx, env, roomId);
        const targetLocale = normalizeTranslationLocale(body.targetLocale);
        if (!targetLocale) throw new Error("targetLocale 無效");
        const sourceLocale = body.sourceLocale === undefined ? undefined : normalizeTranslationLocale(body.sourceLocale);
        if (body.sourceLocale !== undefined && !sourceLocale) throw new Error("sourceLocale 無效");
        const texts = validateTranslationTexts(body.texts);
        return json({ translations: await translateTexts(fetch, texts, targetLocale, sourceLocale), targetLocale });
      }

      const roomInfo = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})\/info$/);
      if (roomInfo && request.method === "GET") {
        const roomId = roomInfo[1]!;
        const result = await env.GAME_ROOM.getByName(roomId).roomInfo();
        trackRoom(ctx, env, roomId);
        return json(result);
      }

      const aiRun = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})\/ai\/run$/);
      if (aiRun && request.method === "POST") {
        const roomId = aiRun[1]!;
        const body = await readJson(request);
        const apiKeys = stringArrayField(body, "apiKeys", 8, 1024, body.apiKey);
        const result = await env.GAME_ROOM.getByName(roomId).runAI(
          stringField(body, "token"), stringField(body, "playerId"), apiKeys
        );
        trackRoom(ctx, env, roomId);
        return json(result);
      }

      const match = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})(?:\/(join|login|ai|state|ws))?$/);
      if (!match) return json({ error: "Not found" }, 404);
      const roomId = match[1]!;
      const action = match[2] ?? "state";
      const room = env.GAME_ROOM.getByName(roomId);

      if (action === "join" && request.method === "POST") {
        const body = await readJson(request);
        const result = await room.joinHuman(
          stringField(body, "name"), stringField(body, "playerPassword", 72), optionalStringField(body, "roomPassword", 72)
        );
        trackRoom(ctx, env, roomId);
        return json(result, 201);
      }
      if (action === "login" && request.method === "POST") {
        const body = await readJson(request);
        const result = await room.loginHuman(
          stringField(body, "name"), stringField(body, "playerPassword", 72), optionalStringField(body, "roomPassword", 72)
        );
        trackRoom(ctx, env, roomId);
        return json(result);
      }
      if (action === "ai" && request.method === "POST") {
        const body = await readJson(request);
        const result = await room.addAI(stringField(body, "token"), stringField(body, "name"), parseAIConfig(body));
        trackRoom(ctx, env, roomId);
        return json(result, 201);
      }
      if (action === "state" && request.method === "GET") {
        const result = await room.getStateByToken(url.searchParams.get("token") ?? "");
        trackRoom(ctx, env, roomId);
        return json(result);
      }
      if (action === "ws" && request.method === "GET") {
        const response = await room.fetch(request);
        if (response.status === 101) trackRoom(ctx, env, roomId);
        return response;
      }
      return json({ error: "Method not allowed" }, 405);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal error";
      if (!url.pathname.startsWith("/api/admin") || !message.includes("管理員 Token")) {
        const roomId = extractRoomId(url.pathname);
        ctx.waitUntil(recordApplicationError(env, {
          ...(roomId ? { roomId } : {}),
          source: "worker",
          category: classifyDiagnostic(url.pathname, message),
          message,
          detail: `${request.method} ${url.pathname}`
        }).catch(() => undefined));
      }
      const status = statusForError(message);
      return json({ error: message }, status);
    }
  }
};

async function handleAdmin(request: Request, url: URL, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
  const tokens = parseAdminTokens(env.ADMIN_PANEL_TOKENS);
  if (!tokens.length) throw new Error("管理後台尚未設定管理員 Token");
  if (!isAdminRequest(request, tokens)) throw new Error("管理員 Token 無效");
  const directory = roomDirectory(env);

  if (request.method === "GET" && url.pathname === "/api/admin/overview") {
    const now = Date.now();
    const activeSince = now - 15 * 60_000;
    const errorSince = now - 24 * 60 * 60_000;
    const [roomCount, activeRoomCount, errorStats] = await Promise.all([
      directory.roomCount(),
      directory.roomCount("", "active", activeSince),
      directory.errorStats(errorSince)
    ]);
    return json({
      ok: true,
      roomCount,
      activeRoomCount,
      activeWindowMinutes: 15,
      errorCount24h: errorStats.total,
      errorRoomCount24h: errorStats.roomCount,
      errorByCategory: errorStats.byCategory,
      errorBySource: errorStats.bySource,
      translationConfigured: true,
      adminConfigured: true
    });
  }

  if (request.method === "GET" && url.pathname === "/api/admin/rooms") {
    const limit = integerQuery(url, "limit", 100, 1, 250);
    const offset = integerQuery(url, "offset", 0, 0, 100_000);
    const search = textQuery(url, "q", 40).toUpperCase();
    const activity = roomActivityQuery(url.searchParams.get("activity"));
    const activeWindowMinutes = integerQuery(url, "activeWindowMinutes", 15, 1, 1_440);
    const activeSince = Date.now() - activeWindowMinutes * 60_000;
    const [rooms, total] = await Promise.all([
      directory.listRooms(limit, offset, search, activity, activeSince),
      directory.roomCount(search, activity, activeSince)
    ]);
    return json({ rooms, total, limit, offset, search, activity, activeWindowMinutes });
  }

  if (request.method === "GET" && url.pathname === "/api/admin/errors") {
    const limit = integerQuery(url, "limit", 100, 1, 250);
    const offset = integerQuery(url, "offset", 0, 0, 100_000);
    const roomId = optionalRoomId(url.searchParams.get("roomId"));
    const category = labelQuery(url, "category");
    const source = labelQuery(url, "source");
    const search = textQuery(url, "q", 120);
    const hours = integerQuery(url, "hours", 0, 0, 24 * 30);
    const grouped = url.searchParams.get("grouped") === "1" || url.searchParams.get("grouped") === "true";
    const result = await directory.queryErrors({
      limit,
      offset,
      ...(roomId ? { roomId } : {}),
      ...(category ? { category } : {}),
      ...(source ? { source } : {}),
      ...(search ? { search } : {}),
      ...(hours > 0 ? { sinceAt: Date.now() - hours * 60 * 60_000 } : {}),
      grouped
    });
    return json({ ...result, limit, offset, grouped });
  }

  if (request.method === "POST" && url.pathname === "/api/admin/rooms/register") {
    const body = await readJson(request);
    const roomId = roomIdField(body, "roomId");
    await env.GAME_ROOM.getByName(roomId).roomInfo();
    await directory.registerRoom(roomId);
    return json({ ok: true, roomId });
  }

  const roomMatch = url.pathname.match(/^\/api\/admin\/rooms\/([A-Z2-9]{6})(?:\/(kick|moderator|notice))?$/);
  if (roomMatch) {
    const roomId = roomMatch[1]!;
    const action = roomMatch[2] ?? "state";
    const room = env.GAME_ROOM.getByName(roomId);
    if (request.method === "GET" && action === "state") {
      const result = await room.adminSnapshot();
      trackRoom(ctx, env, roomId);
      return json(result);
    }
    if (request.method === "POST" && action === "kick") {
      const body = await readJson(request);
      const playerId = stringField(body, "playerId", 100);
      try {
        await room.adminKick(playerId);
      } catch (error) {
        if (playerId !== "__disband_room__" || !(error instanceof Error) || !error.message.includes("房間不存在")) throw error;
      }
      if (playerId === "__disband_room__") await directory.unregisterRoom(roomId, Date.now());
      else trackRoom(ctx, env, roomId);
      return json({ ok: true });
    }
    if (request.method === "POST" && action === "moderator") {
      const body = await readJson(request);
      if (typeof body.enabled !== "boolean") throw new Error("enabled 必須是 boolean");
      await room.adminSetModerator(stringField(body, "playerId", 100), body.enabled);
      trackRoom(ctx, env, roomId);
      return json({ ok: true });
    }
    if (request.method === "POST" && action === "notice") {
      const body = await readJson(request);
      await room.adminNotice(stringField(body, "content", 300));
      trackRoom(ctx, env, roomId);
      return json({ ok: true });
    }
  }

  return json({ error: "Not found" }, 404);
}

function roomDirectory(env: Env) { return env.ROOM_DIRECTORY.getByName("global"); }
function trackRoom(ctx: ExecutionContext, env: Env, roomId: string): void {
  const seenAt = Date.now();
  ctx.waitUntil(roomDirectory(env).registerRoom(roomId, seenAt).catch(() => undefined));
}
async function recordApplicationError(env: Env, input: { roomId?: string; source: string; category: string; message: string; detail?: string }): Promise<void> {
  await roomDirectory(env).recordError({
    ...(input.roomId ? { roomId: input.roomId } : {}),
    source: input.source,
    category: input.category,
    message: sanitizeDiagnosticMessage(input.message),
    ...(input.detail ? { detail: sanitizeDiagnosticMessage(input.detail) } : {}),
    createdAt: Date.now()
  });
}

function statusForError(message: string): number {
  if (message.includes("管理後台尚未設定")) return 503;
  if (message.includes("登入嘗試過多")) return 429;
  if (message.includes("管理員 Token 無效") || message.includes("名稱或人物密碼錯誤")) return 401;
  if (message.includes("不存在")) return 404;
  if (message.includes("憑證") || message.includes("只有房主") || message.includes("房間管理員")) return 403;
  if (message.includes("密碼錯誤")) return 401;
  if (message.startsWith("AI provider HTTP") || message.includes("玩家聊天翻譯服務暫時無法使用")) return 502;
  return 400;
}

function extractRoomId(pathname: string): string | undefined { return pathname.match(/\/rooms\/([A-Z2-9]{6})(?:\/|$)/)?.[1]; }
function optionalRoomId(value: string | null): string | undefined { if (!value) return undefined; const id = value.trim().toUpperCase(); if (!/^[A-Z2-9]{6}$/.test(id)) throw new Error("房號格式不正確"); return id; }
function roomIdField(body: JsonObject, key: string): string { const id = stringField(body, key, 6).toUpperCase(); if (!/^[A-Z2-9]{6}$/.test(id)) throw new Error("房號格式不正確"); return id; }
function integerQuery(url: URL, key: string, fallback: number, min: number, max: number): number {
  return parseBoundedIntegerQuery(url.searchParams.get(key), fallback, min, max);
}
function textQuery(url: URL, key: string, maxLength: number): string { return String(url.searchParams.get(key) || "").trim().slice(0, maxLength); }
function labelQuery(url: URL, key: string): string | undefined { const value = textQuery(url, key, 60); if (!value) return undefined; if (!/^[a-z0-9_.:-]+$/i.test(value)) throw new Error(`${key} 格式不正確`); return value; }
function roomActivityQuery(value: string | null): "all" | "active" | "stale" { return value === "active" || value === "stale" ? value : "all"; }

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
