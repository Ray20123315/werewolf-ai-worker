import test from "node:test";
import assert from "node:assert/strict";
import { createPasswordVerifier, verifyPassword } from "../.test-build/auth.js";

test("new password verifiers stay within the Workers PBKDF2 runtime limit", async () => {
  const verifier = await createPasswordVerifier("1234");
  assert.equal(verifier.iterations, 100_000);
  assert.equal(await verifyPassword("1234", verifier), true);
});

test("unsupported PBKDF2 iteration counts fail closed without throwing", async () => {
  const unsupported = { salt: "00".repeat(16), hash: "00".repeat(32), iterations: 100_001 };
  assert.equal(await verifyPassword("1234", unsupported), false);
});
