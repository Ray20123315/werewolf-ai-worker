import type { PasswordVerifier } from "./types";

const PBKDF2_MAX_ITERATIONS = 100_000;
const PBKDF2_ITERATIONS = PBKDF2_MAX_ITERATIONS;
const PASSWORD_BYTES = 32;
const DUMMY_PASSWORD_VERIFIER: PasswordVerifier = {
  salt: "00".repeat(16),
  hash: "00".repeat(PASSWORD_BYTES),
  iterations: PBKDF2_ITERATIONS
};

export function normalizePlayerName(raw: string): { display: string; key: string } {
  const normalized = raw.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (/\p{Cs}/u.test(normalized) || /[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/i.test(normalized)) {
    throw new Error("玩家名稱不能包含不可見控制字元");
  }
  const display = truncateByGrapheme(normalized, 24);
  if (!display) throw new Error("玩家名稱不能為空白");
  const key = display.toLocaleLowerCase("zh-Hant-TW");
  return { display, key };
}

export function validateSimplePassword(raw: string, label = "人物密碼"): string {
  const password = raw.trim();
  if (password.length < 4) throw new Error(`${label}至少需要 4 個字元`);
  if (password.length > 72) throw new Error(`${label}最多 72 個字元`);
  return password;
}

export async function createPasswordVerifier(raw: string, label = "人物密碼"): Promise<PasswordVerifier> {
  const password = validateSimplePassword(raw, label);
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return { salt: bytesToHex(salt), hash: bytesToHex(hash), iterations: PBKDF2_ITERATIONS };
}

export async function verifyPassword(raw: string, verifier: PasswordVerifier): Promise<boolean> {
  const password = raw.trim();
  if (!password || !Number.isInteger(verifier.iterations) || verifier.iterations < 10_000 || verifier.iterations > PBKDF2_MAX_ITERATIONS) return false;
  const salt = hexToBytes(verifier.salt);
  const expected = hexToBytes(verifier.hash);
  const actual = await derive(password, salt, verifier.iterations);
  return timingSafeEqual(actual, expected);
}

export async function verifyLoginPassword(raw: string, verifier: PasswordVerifier | undefined): Promise<boolean> {
  const matches = await verifyPassword(raw, verifier ?? DUMMY_PASSWORD_VERIFIER);
  return Boolean(verifier) && matches;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(new TextEncoder().encode(password)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations }, key, PASSWORD_BYTES * 8);
  return new Uint8Array(bits);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return new Uint8Array();
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function truncateByGrapheme(value: string, maxCodeUnits: number): string {
  if (value.length <= maxCodeUnits) return value;
  let result = "";
  for (const { segment } of new Intl.Segmenter("zh-Hant-TW", { granularity: "grapheme" }).segment(value)) {
    if (result.length + segment.length > maxCodeUnits) break;
    result += segment;
  }
  return result || Array.from(value)[0] || "";
}
