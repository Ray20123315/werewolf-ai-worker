import test from "node:test";
import assert from "node:assert/strict";
import { adminTokenFromRequest, classifyDiagnostic, isAdminRequest, parseAdminTokens, sanitizeDiagnosticMessage } from "../.test-build/admin.js";

test("admin tokens accept any non-empty trimmed length with dedupe", () => {
  const short = "x";
  const long = "y".repeat(2048);
  assert.deepEqual(parseAdminTokens(` ${short} , ${long} , ${short},   `), [short, long]);
  assert.deepEqual(parseAdminTokens("   \n , ;  "), []);

  const request = new Request("https://example.test/api/admin/overview", { headers: { authorization: `Bearer ${short}` } });
  assert.equal(adminTokenFromRequest(request), short);
  assert.equal(isAdminRequest(request, [short, long]), true);
  assert.equal(isAdminRequest(new Request("https://example.test/api/admin/overview"), [short]), false);
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
