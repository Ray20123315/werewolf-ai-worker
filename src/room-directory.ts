import { DurableObject } from "cloudflare:workers";
import { sanitizeDiagnosticMessage } from "./admin";

export type RoomActivityState = "active" | "idle" | "stale";
export type DiagnosticSeverity = "critical" | "error" | "warning" | "info";

export interface RoomDirectoryEntry {
  roomId: string;
  firstSeenAt: number;
  lastSeenAt: number;
  activityAgeMs: number;
  trackedForMs: number;
  activityState: RoomActivityState;
}

export interface DirectoryErrorInput {
  roomId?: string;
  source: string;
  category: string;
  message: string;
  detail?: string;
  createdAt?: number;
}

export interface DirectoryErrorEntry {
  id: number;
  roomId?: string;
  source: string;
  category: string;
  message: string;
  detail?: string;
  createdAt: number;
  firstCreatedAt?: number;
  occurrences?: number;
  severity: DiagnosticSeverity;
  signature: string;
  durationMs: number;
  burst: boolean;
}

export interface DirectoryErrorStats {
  total: number;
  roomCount: number;
  byCategory: Array<{ key: string; count: number }>;
  bySource: Array<{ key: string; count: number }>;
}

export type RoomActivityFilter = "all" | "active" | "stale";

export interface DirectoryErrorQuery {
  limit?: number;
  offset?: number;
  roomId?: string;
  category?: string;
  source?: string;
  search?: string;
  sinceAt?: number;
  grouped?: boolean;
}

type RoomRow = { room_id: string; first_seen_at: number; last_seen_at: number };
type ErrorRow = { id: number; room_id: string | null; source: string; category: string; message: string; detail: string | null; created_at: number };
type GroupedErrorRow = ErrorRow & { first_created_at: number; occurrences: number };
type CountRow = { count: number };
type KeyCountRow = { key: string; count: number };

type SqlParam = string | number | null;

export class RoomDirectory extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS rooms (room_id TEXT PRIMARY KEY, first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL)`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS errors (id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT, source TEXT NOT NULL, category TEXT NOT NULL, message TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL)`);
    this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS idx_errors_created_at ON errors(created_at DESC)`);
    this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS idx_errors_room_id ON errors(room_id, created_at DESC)`);
    this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS idx_errors_category ON errors(category, created_at DESC)`);
  }

  async registerRoom(roomId: string, seenAt = Date.now()): Promise<void> {
    const id = normalizeRoomId(roomId);
    const time = finiteTime(seenAt);
    this.ctx.storage.sql.exec(
      `INSERT INTO rooms (room_id, first_seen_at, last_seen_at) VALUES (?, ?, ?)
       ON CONFLICT(room_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      id, time, time
    );
  }

  async unregisterRoom(roomId: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM rooms WHERE room_id = ?", normalizeRoomId(roomId));
  }

  async listRooms(limit = 100, offset = 0, search = "", activity: RoomActivityFilter = "all", activeSince = 0): Promise<RoomDirectoryEntry[]> {
    const safeLimit = clampInt(limit, 1, 250);
    const safeOffset = clampInt(offset, 0, 100_000);
    const { clause, params } = roomWhere(search, activity, activeSince);
    const now = Date.now();
    return this.ctx.storage.sql.exec<RoomRow>(
      `SELECT room_id, first_seen_at, last_seen_at FROM rooms${clause} ORDER BY last_seen_at DESC LIMIT ? OFFSET ?`,
      ...params, safeLimit, safeOffset
    ).toArray().map((row) => roomRow(row, now));
  }

  async roomCount(search = "", activity: RoomActivityFilter = "all", activeSince = 0): Promise<number> {
    const { clause, params } = roomWhere(search, activity, activeSince);
    const row = this.ctx.storage.sql.exec<CountRow>(`SELECT COUNT(*) AS count FROM rooms${clause}`, ...params).toArray()[0];
    return Number(row?.count ?? 0);
  }

  async recordError(input: DirectoryErrorInput): Promise<void> {
    const roomId = input.roomId ? normalizeRoomId(input.roomId) : null;
    const source = sanitizeLabel(input.source, "unknown");
    const category = sanitizeLabel(input.category, "unknown");
    const message = sanitizeDiagnosticMessage(input.message, 500);
    const detail = input.detail ? sanitizeDiagnosticMessage(input.detail, 800) : null;
    const createdAt = finiteTime(input.createdAt ?? Date.now());
    this.ctx.storage.sql.exec(
      "INSERT INTO errors (room_id, source, category, message, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      roomId, source, category, message, detail, createdAt
    );
    this.ctx.storage.sql.exec("DELETE FROM errors WHERE id NOT IN (SELECT id FROM errors ORDER BY id DESC LIMIT 1000)");
  }

  async listErrors(limit = 100, roomId?: string): Promise<DirectoryErrorEntry[]> {
    return (await this.queryErrors({ limit, ...(roomId ? { roomId } : {}) })).errors;
  }

  async queryErrors(query: DirectoryErrorQuery = {}): Promise<{ errors: DirectoryErrorEntry[]; total: number }> {
    const safeLimit = clampInt(query.limit ?? 100, 1, 250);
    const safeOffset = clampInt(query.offset ?? 0, 0, 100_000);
    const { clause, params } = errorWhere(query);
    if (query.grouped) {
      const rows = this.ctx.storage.sql.exec<GroupedErrorRow>(
        `SELECT MAX(id) AS id, room_id, source, category, message, detail,
                MAX(created_at) AS created_at, MIN(created_at) AS first_created_at, COUNT(*) AS occurrences
         FROM errors${clause}
         GROUP BY room_id, source, category, message, detail
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        ...params, safeLimit, safeOffset
      ).toArray();
      const count = this.ctx.storage.sql.exec<CountRow>(
        `SELECT COUNT(*) AS count FROM (
           SELECT 1 FROM errors${clause}
           GROUP BY room_id, source, category, message, detail
         )`,
        ...params
      ).toArray()[0];
      return {
        errors: rows.map((row) => errorRow(row, row.first_created_at, row.occurrences)),
        total: Number(count?.count ?? 0)
      };
    }

    const rows = this.ctx.storage.sql.exec<ErrorRow>(
      `SELECT id, room_id, source, category, message, detail, created_at FROM errors${clause} ORDER BY id DESC LIMIT ? OFFSET ?`,
      ...params, safeLimit, safeOffset
    ).toArray();
    const count = this.ctx.storage.sql.exec<CountRow>(`SELECT COUNT(*) AS count FROM errors${clause}`, ...params).toArray()[0];
    return { errors: rows.map((row) => errorRow(row)), total: Number(count?.count ?? 0) };
  }

  async errorStats(sinceAt = Date.now() - 86_400_000): Promise<DirectoryErrorStats> {
    const safeSince = finiteTime(sinceAt);
    const totals = this.ctx.storage.sql.exec<{ count: number; room_count: number }>(
      "SELECT COUNT(*) AS count, COUNT(DISTINCT room_id) AS room_count FROM errors WHERE created_at >= ?",
      safeSince
    ).toArray()[0];
    const byCategory = this.ctx.storage.sql.exec<KeyCountRow>(
      "SELECT category AS key, COUNT(*) AS count FROM errors WHERE created_at >= ? GROUP BY category ORDER BY count DESC, key ASC LIMIT 16",
      safeSince
    ).toArray().map(({ key, count }) => ({ key, count: Number(count) }));
    const bySource = this.ctx.storage.sql.exec<KeyCountRow>(
      "SELECT source AS key, COUNT(*) AS count FROM errors WHERE created_at >= ? GROUP BY source ORDER BY count DESC, key ASC LIMIT 16",
      safeSince
    ).toArray().map(({ key, count }) => ({ key, count: Number(count) }));
    return {
      total: Number(totals?.count ?? 0),
      roomCount: Number(totals?.room_count ?? 0),
      byCategory,
      bySource
    };
  }
}

function roomWhere(search: string, activity: RoomActivityFilter, activeSince: number): { clause: string; params: SqlParam[] } {
  const conditions: string[] = [];
  const params: SqlParam[] = [];
  const q = String(search || "").trim().toUpperCase().slice(0, 40);
  if (q) {
    conditions.push("room_id LIKE ?");
    params.push(`%${q}%`);
  }
  const since = Number.isFinite(activeSince) && activeSince > 0 ? Math.floor(activeSince) : 0;
  if (activity === "active" && since) {
    conditions.push("last_seen_at >= ?");
    params.push(since);
  } else if (activity === "stale" && since) {
    conditions.push("last_seen_at < ?");
    params.push(since);
  }
  return { clause: conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "", params };
}

function errorWhere(query: DirectoryErrorQuery): { clause: string; params: SqlParam[] } {
  const conditions: string[] = [];
  const params: SqlParam[] = [];
  if (query.roomId) {
    conditions.push("room_id = ?");
    params.push(normalizeRoomId(query.roomId));
  }
  const category = sanitizeOptionalLabel(query.category);
  if (category) {
    conditions.push("category = ?");
    params.push(category);
  }
  const source = sanitizeOptionalLabel(query.source);
  if (source) {
    conditions.push("source = ?");
    params.push(source);
  }
  const search = String(query.search || "").trim().slice(0, 120);
  if (search) {
    conditions.push("(message LIKE ? OR detail LIKE ? OR room_id LIKE ?)");
    const pattern = `%${search}%`;
    params.push(pattern, pattern, pattern.toUpperCase());
  }
  if (Number.isFinite(query.sinceAt) && Number(query.sinceAt) > 0) {
    conditions.push("created_at >= ?");
    params.push(Math.floor(Number(query.sinceAt)));
  }
  return { clause: conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "", params };
}

function roomRow(row: RoomRow, now: number): RoomDirectoryEntry {
  const activityAgeMs = Math.max(0, now - row.last_seen_at);
  return {
    roomId: row.room_id,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    activityAgeMs,
    trackedForMs: Math.max(0, now - row.first_seen_at),
    activityState: activityAgeMs <= 15 * 60_000 ? "active" : activityAgeMs <= 24 * 60 * 60_000 ? "idle" : "stale"
  };
}

function errorRow(row: ErrorRow, firstCreatedAt?: number, occurrences?: number): DirectoryErrorEntry {
  const first = firstCreatedAt ?? row.created_at;
  const count = Math.max(1, Number(occurrences ?? 1));
  const durationMs = Math.max(0, row.created_at - first);
  const fingerprintInput = `${row.room_id ?? "-"}|${row.source}|${row.category}|${row.message}|${row.detail ?? ""}`;
  return {
    id: row.id,
    ...(row.room_id ? { roomId: row.room_id } : {}),
    source: row.source,
    category: row.category,
    message: row.message,
    ...(row.detail ? { detail: row.detail } : {}),
    createdAt: row.created_at,
    ...(firstCreatedAt ? { firstCreatedAt } : {}),
    ...(count > 1 ? { occurrences: count } : {}),
    severity: diagnosticSeverity(row.category, row.message),
    signature: diagnosticSignature(fingerprintInput),
    durationMs,
    burst: count >= 5 && durationMs <= 5 * 60_000
  };
}

function diagnosticSeverity(category: string, message: string): DiagnosticSeverity {
  const lower = `${category} ${message}`.toLowerCase();
  if (lower.includes("internal error") || lower.includes("sql") || lower.includes("storage")) return "critical";
  if (category === "api") return "error";
  if (category === "auth" || category === "admin" || category === "ai" || category === "translation" || category === "websocket") return "warning";
  return "info";
}

function diagnosticSignature(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `D-${(hash >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}

function normalizeRoomId(value: string): string {
  const id = String(value || "").trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(id)) throw new Error("房號格式不正確");
  return id;
}

function finiteTime(value: number): number { return Number.isFinite(value) && value > 0 ? Math.floor(value) : Date.now(); }
function clampInt(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, Number.isFinite(value) ? Math.floor(value) : min)); }
function sanitizeLabel(value: string, fallback: string): string { const text = String(value || "").trim().replace(/[^a-z0-9_.:-]/gi, "_").slice(0, 60); return text || fallback; }
function sanitizeOptionalLabel(value: string | undefined): string | undefined { if (!value?.trim()) return undefined; return sanitizeLabel(value, ""); }
