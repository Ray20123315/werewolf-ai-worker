export const MAX_ADMIN_TOKENS = 8;
export const MIN_ADMIN_TOKEN_LENGTH = 24;

export function parseAdminTokens(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const out: string[] = [];
  for (const item of raw.split(/[\n,;]+/g)) {
    const token = item.trim();
    if (token.length < MIN_ADMIN_TOKEN_LENGTH || token.length > 1024 || out.includes(token)) continue;
    out.push(token);
    if (out.length >= MAX_ADMIN_TOKENS) break;
  }
  return out;
}

export function adminTokenFromRequest(request: Request): string | undefined {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

export function isAdminRequest(request: Request, configuredTokens: readonly string[]): boolean {
  const candidate = adminTokenFromRequest(request);
  if (!candidate || !configuredTokens.length) return false;
  return configuredTokens.some((token) => secureEqualText(candidate, token));
}

export function sanitizeDiagnosticMessage(value: unknown, maxLength = 500): string {
  const raw = value instanceof Error ? value.message : String(value ?? "未知錯誤");
  return raw
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED_GOOGLE_KEY]")
    .replace(/\bsk-[0-9A-Za-z_-]{16,}\b/g, "[REDACTED_API_KEY]")
    .replace(/([?&]key=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\b[a-f0-9]{48,}\b/gi, "[REDACTED_TOKEN]")
    .slice(0, maxLength);
}

export function classifyDiagnostic(pathname: string, message: string, source = "api"): string {
  const lower = `${pathname} ${message}`.toLowerCase();
  if (source === "websocket") return "websocket";
  if (lower.includes("/translate") || lower.includes("google translation") || lower.includes("google 翻譯")) return "translation";
  if (lower.includes("/ai/") || lower.includes("ai provider") || lower.includes("api key")) return "ai";
  if (lower.includes("密碼") || lower.includes("憑證") || lower.includes("login") || lower.includes("unauthorized")) return "auth";
  if (lower.includes("admin")) return "admin";
  return "api";
}

function secureEqualText(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index]! ^ b[index]!;
  return diff === 0;
}
