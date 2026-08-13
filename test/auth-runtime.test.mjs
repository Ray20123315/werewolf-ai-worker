import test from "node:test";
import assert from "node:assert/strict";
import {
  assertFreshRoomCommit,
  captureHumanSessionCommitContext,
  captureRoomCommitContext,
  resolveFreshHumanJoin,
  resolveFreshHumanSession
} from "../.test-build/auth-task-freshness.js";
import { createPasswordVerifier, normalizePlayerName, verifyLoginPassword, verifyPassword } from "../.test-build/auth.js";

function player(id, extra = {}) {
  return {
    id,
    token: `t-${id}`,
    name: id,
    nameKey: id,
    alive: true,
    isAI: false,
    isSpectator: false,
    joinedAt: 0,
    ...extra
  };
}

function state(players, phase = "lobby") {
  return {
    roomId: "ABC234",
    hostPlayerId: players[0]?.id ?? "host",
    phase,
    round: 0,
    players,
    roleSetup: {},
    settings: { sheriffEnabled: false, deathInfo: "names", tieRule: "no_elimination", autoRoleSetup: false },
    sheriff: { enabled: false, electionRound: 0, candidates: [], votes: {}, successors: [] },
    messages: [],
    votes: {},
    nightActions: { wolfVotes: {}, seerTargets: {}, guardTargets: {}, witchActions: {}, roleActions: {} },
    roleMemory: {},
    seerResults: {},
    roleResults: {},
    witchHealAvailable: true,
    witchPoisonAvailable: true,
    guardLastTargets: {},
    debateOrder: [],
    debateIndex: 0,
    debateCompleted: [],
    lastNightDeaths: [],
    deathReasons: {},
    moderatorIds: [],
    initialPlayerCount: players.length,
    createdAt: 0,
    updatedAt: 0
  };
}

test("new password verifiers stay within the Workers PBKDF2 runtime limit", async () => {
  const verifier = await createPasswordVerifier("1234");
  assert.equal(verifier.iterations, 100_000);
  assert.equal(await verifyPassword("1234", verifier), true);
});

test("unsupported PBKDF2 iteration counts fail closed without throwing", async () => {
  const unsupported = { salt: "00".repeat(16), hash: "00".repeat(32), iterations: 100_001 };
  assert.equal(await verifyPassword("1234", unsupported), false);
});

test("login verification performs the same PBKDF2-shaped check for an unknown player", async () => {
  const verifier = await createPasswordVerifier("1234");
  assert.equal(await verifyLoginPassword("1234", verifier), true);
  assert.equal(await verifyLoginPassword("1234", undefined), false);
});

test("join commit rechecks replacement rooms, duplicate names and the latest phase", () => {
  const host = player("host");
  const value = state([host]);
  const context = captureRoomCommitContext(value);

  value.phase = "night";
  assert.equal(resolveFreshHumanJoin(value, context, "new-player"), true);

  value.players.push(player("existing", { nameKey: "new-player" }));
  assert.throws(() => resolveFreshHumanJoin(value, context, "new-player"), /名稱已被使用/);

  const replacement = state([host]);
  assert.throws(() => assertFreshRoomCommit(replacement, context), /房間狀態已變更/);
});

test("login and legacy password commits reject rotated, kicked or already-upgraded sessions", async () => {
  const verifier = await createPasswordVerifier("1234");
  const human = player("human", { password: verifier });
  const value = state([human]);
  const context = captureHumanSessionCommitContext(value, human);
  assert.equal(resolveFreshHumanSession(value, context), human);

  human.token = "rotated";
  assert.throws(() => resolveFreshHumanSession(value, context), /登入狀態已變更/);

  const legacy = player("legacy");
  const legacyState = state([legacy]);
  const legacyContext = captureHumanSessionCommitContext(legacyState, legacy);
  legacy.password = verifier;
  assert.throws(() => resolveFreshHumanSession(legacyState, legacyContext), /登入狀態已變更/);

  const kicked = player("kicked");
  const kickedState = state([kicked]);
  const kickedContext = captureHumanSessionCommitContext(kickedState, kicked);
  kicked.kickedAt = Date.now();
  assert.throws(() => resolveFreshHumanSession(kickedState, kickedContext), /登入狀態已變更/);
});

test("player-name normalization keeps graphemes intact and rejects invisible controls", () => {
  assert.equal(normalizePlayerName(`${"a".repeat(23)}😀`).display, "a".repeat(23));
  assert.equal(normalizePlayerName("👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦").display, "👨‍👩‍👧‍👦👨‍👩‍👧‍👦");
  assert.throws(() => normalizePlayerName("\u200b"), /不可見控制字元/);
  assert.throws(() => normalizePlayerName("Ray\u202eAdmin"), /不可見控制字元/);
  assert.throws(() => normalizePlayerName(`${"a".repeat(23)}\ud83d`), /不可見控制字元/);
});
