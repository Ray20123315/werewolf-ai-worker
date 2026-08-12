import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

test("admin dashboard exposes server-backed searchable diagnostics and grouped errors", () => {
  const indexSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const directorySource = readFileSync(new URL("../src/room-directory.ts", import.meta.url), "utf8");
  assert.match(indexSource, /activeRoomCount/);
  assert.match(indexSource, /errorCount24h/);
  assert.match(indexSource, /url\.pathname === "\/api\/admin\/errors"/);
  assert.match(indexSource, /grouped/);
  assert.match(indexSource, /directory\.queryErrors/);
  assert.match(directorySource, /async queryErrors/);
  assert.match(directorySource, /GROUP BY room_id, source, category, message, detail/);
  assert.match(directorySource, /async errorStats/);
  assert.match(directorySource, /RoomActivityFilter/);
});

test("admin UI remains compact and responsive instead of forcing wide tables", () => {
  const html = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../public/admin.css", import.meta.url), "utf8");
  const js = readFileSync(new URL("../public/admin.js", import.meta.url), "utf8");
  execFileSync(process.execPath, ["--check", new URL("../public/admin.js", import.meta.url).pathname]);

  assert.match(html, /id="adminRoomSearch"/);
  assert.match(html, /id="adminErrorFilters"/);
  assert.match(html, /id="adminErrorGrouped"/);
  assert.match(html, /id="adminErrorsPrev"/);
  assert.doesNotMatch(css, /\.admin-table\s*\{[^}]*min-width:\s*680px/s);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /content: attr\(data-label\)/);
  assert.match(js, /focusErrorsForRoom/);
  assert.match(js, /navigator\.clipboard\.writeText/);
  assert.match(js, /ERROR_PAGE_SIZE/);
});

test("admin async form lifecycle fix keeps a stable form reference across await", () => {
  const html = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
  const toolkit = readFileSync(new URL("../public/admin-toolkit.js", import.meta.url), "utf8");
  execFileSync(process.execPath, ["--check", new URL("../public/admin-toolkit.js", import.meta.url).pathname]);

  assert.match(html, /admin-toolkit\.js/);
  assert.match(html, /admin-toolkit\.css/);
  assert.match(toolkit, /formElement\.id !== "registerRoomForm" && formElement\.id !== "adminNoticeForm"/);
  assert.match(toolkit, /event\.stopImmediatePropagation\(\)/);
  assert.match(toolkit, /await adminRequest\("\/api\/admin\/rooms\/register"/);
  assert.match(toolkit, /await adminRequest\(`\/api\/admin\/rooms\/\$\{roomId\}\/notice`/);
  assert.equal((toolkit.match(/formElement\.reset\(\)/g) || []).length, 2);
  assert.doesNotMatch(toolkit, /event\.currentTarget\.reset\(\)/);
});

test("room frontend removes secondary toolbars while preserving private inspection", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const inspection = readFileSync(new URL("../public/private-inspection.js", import.meta.url), "utf8");
  const compact = readFileSync(new URL("../public/compact-ui.css", import.meta.url), "utf8");
  execFileSync(process.execPath, ["--check", new URL("../public/private-inspection.js", import.meta.url).pathname]);

  assert.doesNotMatch(html, /room-toolkit\.(?:css|js)/);
  assert.match(html, /private-inspection\.js/);
  for (const removed of ["roomPlayerSearch", "roomMessageSearch", "roomQuickTools", "roomCompactToggle", "roomConnectionCheck"]) {
    assert.doesNotMatch(inspection, new RegExp(removed));
  }
  assert.match(inspection, /function refreshPrivateInspections\(\)/);
  assert.match(inspection, /pill private-inspection/);
  assert.match(inspection, /MutationObserver/);
  assert.match(compact, /height:\s*100dvh/);
  assert.match(compact, /#game \.messages \{ flex:\s*1 1 auto; min-height:\s*0; max-height:\s*none; \}/);
});

test("backend diagnostics return actionable activity severity signature and burst metadata", () => {
  const directorySource = readFileSync(new URL("../src/room-directory.ts", import.meta.url), "utf8");
  for (const field of ["activityAgeMs", "trackedForMs", "activityState", "severity", "signature", "durationMs", "burst"]) {
    assert.match(directorySource, new RegExp(field));
  }
  assert.match(directorySource, /diagnosticSeverity/);
  assert.match(directorySource, /diagnosticSignature/);
  assert.match(directorySource, /count >= 5 && durationMs <= 5 \* 60_000/);
});

test("admin diagnostic toolkit supports reset copy export auto-refresh and backend metadata decoration", () => {
  const toolkit = readFileSync(new URL("../public/admin-toolkit.js", import.meta.url), "utf8");
  for (const capability of ["adminResetFilters", "adminCopyDiagnostics", "adminExportDiagnostics", "adminAutoRefresh", "severity-", "signature", "burst"]) {
    assert.match(toolkit, new RegExp(capability));
  }
  assert.match(toolkit, /JSON\.stringify\(payload, null, 2\)/);
  assert.match(toolkit, /setInterval\(\(\) => document\.querySelector\("#refreshAdmin"\)/);
});
