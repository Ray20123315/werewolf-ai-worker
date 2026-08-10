import { DurableObject } from "cloudflare:workers";
import { sanitizeDiagnosticMessage } from "./admin";

export interface RoomDirectoryEntry {
  roomId: string;
  firstSeenAt: number;
  lastSeenAt: number;
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
}

type RoomRow = { room_id: string; first_seen_at: number; last_seen_at: number };
type ErrorRow = { id: number; room_id: string | null; source: string; category: string; message: string; detail: string | null; created_at: number };

export class RoomDirectory extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS rooms (room_id TEXT PRIMARY KEY, first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL)`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS errors (id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT, source TEXT NOT NULL, category TEXT NOT NULL, message TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL)`);
    this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS idx_errors_created_at ON errors(created_at DESC)`);
    this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS idx_errors_room_id ON errors(room_id, created_at DESC)`);
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

  async listRooms(limit = 100, offset = 0): Promise<RoomDirectoryEntry[]> {
    const safeLimit = clampInt(limit, 1, 250);
    const safeOffset = clampInt(offset, 0, 100_000);
    return this.ctx.storage.sql.exec<RoomRow>(
      "SELECT room_id, first_seen_at, last_seen_at FROM rooms ORDER BY last_seen_at DESC LIMIT ? OFFSET ?",
      safeLimit, safeOffset
    ).toArray().map((row) => ({ roomId: row.room_id, firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at }));
  }

  async roomCount(): Promise<number> {
    const row = this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM rooms").toArray()[0];
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
    const safeLimit = clampInt(limit, 1, 250);
    const rows = roomId
      ? this.ctx.storage.sql.exec<ErrorRow>(
          "SELECT id, room_id, source, category, message, detail, created_at FROM errors WHERE room_id = ? ORDER BY id DESC LIMIT ?",
          normalizeRoomId(roomId), safeLimit
        ).toArray()
      : this.ctx.storage.sql.exec<ErrorRow>(
          "SELECT id, room_id, source, category, message, detail, created_at FROM errors ORDER BY id DESC LIMIT ?",
          safeLimit
        ).toArray();
    return rows.map((row) => ({
      id: row.id,
      ...(row.room_id ? { roomId: row.room_id } : {}),
      source: row.source,
      category: row.category,
      message: row.message,
      ...(row.detail ? { detail: row.detail } : {}),
      createdAt: row.created_at
    }));
  }
}

function normalizeRoomId(value: string): string {
  const id = String(value || "").trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(id)) throw new Error("房號格式不正確");
  return id;
}

function finiteTime(value: number): number { return Number.isFinite(value) && value > 0 ? Math.floor(value) : Date.now(); }
function clampInt(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, Number.isFinite(value) ? Math.floor(value) : min)); }
function sanitizeLabel(value: string, fallback: string): string { const text = String(value || "").trim().replace(/[^a-z0-9_.:-]/gi, "_").slice(0, 60); return text || fallback; }
