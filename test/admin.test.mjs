import test from "node:test";
import assert from "node:assert/strict";
import { adminTokenFromRequest, classifyDiagnostic, isAdminRequest, parseAdminTokens, sanitizeDiagnosticMessage } from "../.test-build/admin.js";

test("admin tokens are secret bearer credentials with dedupe and minimum strength", () => {
  const a = "a".repeat(24);
  const b = "b".repeat(30);
  assert.deepEqual(parseAdminTokens(`${a},${b},${a},short`), [a, b]);
  const request = new Request("https://example.test/api/admin/overview", { headers: { authorization: `Bearer ${b}` } });
  assert.equal(adminTokenFromRequest(request), b);
  assert.equal(isAdminRequest(request, [a, b]), true);
  assert.equal(isAdminRequest(new Request("https://example.test/api/admin/overview"), [a]), false);
});

test("admin diagnostics redact common credential forms and classify translation errors", () => {
  const redacted = sanitizeDiagnosticMessage(`Bearer super-secret AIza${"x".repeat(30)} sk-${"y".repeat(30)} ${"a".repeat(48)}`);
  assert.doesNotMatch(redacted, /super-secret/);
  assert.doesNotMatch(redacted, /AIza/);
  assert.doesNotMatch(redacted, /sk-/);
  assert.doesNotMatch(redacted, new RegExp("a{48}"));
  assert.equal(classifyDiagnostic("/api/rooms/ABC234/translate", "Google Translation HTTP 403"), "translation");
  assert.equal(classifyDiagnostic("/api/rooms/ABC234/ai/run", "AI provider HTTP 429"), "ai");
});
