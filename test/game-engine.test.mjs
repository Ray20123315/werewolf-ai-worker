import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPasswordVerifier, normalizePlayerName, verifyPassword } from "../.test-build/auth.js";
import {
  ROLE_IDS,
} from "../.test-build/types.js";
import { ROLE_LIST, roleDefinition } from "../.test-build/roles.js";
import {
  areVotesComplete,
  canGuardTarget,
  canWitchSelfSave,
  checkWinner,
  createDebateOrder,
  currentDebaterId,
  defaultRoleSetup,
  freshNightActions,
  isAIVotingUnlocked,
  isDebateComplete,
  pluralityTarget,
  resolveNight,
  roleDeckFromSetup,
  topWeightedVoteTargets,
  validateRoleSetup,
  weightedVoteCounts
} from "../.test-build/game-engine.js";

function p(id, role, alive = true, isAI = false, extra = {}) {
  return { id, token: `t-${id}`, name: id, nameKey: id, alive, isAI, isSpectator: false, role, joinedAt: 0, ...extra };
}

function baseState(players, votes = {}) {
  return {
    roomId: "ABC234", hostPlayerId: players[0]?.id ?? "", phase: "vote", round: 1, players,
    roleSetup: {}, settings: { sheriffEnabled: false, deathInfo: "names", tieRule: "no_elimination" },
    sheriff: { enabled: false, electionRound: 0, candidates: [], votes: {}, successors: [] },
    messages: [], votes, nightActions: freshNightActions(), roleMemory: {}, seerResults: {}, roleResults: {},
    witchHealAvailable: true, witchPoisonAvailable: true, guardLastTargets: {}, debateOrder: [], debateIndex: 0,
    debateCompleted: [], lastNightDeaths: [], deathReasons: {}, initialPlayerCount: players.length, createdAt: 0, updatedAt: 0
  };
}

test("role registry permanently covers all 114 requested canonical roles", () => {
  assert.equal(ROLE_IDS.length, 114);
  assert.equal(ROLE_LIST.length, 114);
  assert.equal(new Set(ROLE_IDS).size, 114);
  assert.deepEqual(new Set(ROLE_LIST.map((role) => role.id)), new Set(ROLE_IDS));
  for (const role of ROLE_LIST) {
    assert.equal(roleDefinition(role.id).name, role.name);
    assert.ok(role.summary.length >= 8, `${role.name} must have a usable debate summary`);
    if (role.source === "adapted") assert.ok(role.debateAdaptation, `${role.name} needs an explicit debate-only adaptation`);
  }
});

test("every registry action effect is wired into the server resolver or a core action path", () => {
  const roomSource = readFileSync(new URL("../src/room.ts", import.meta.url), "utf8");
  const coreEffects = new Set(["wolf_kill", "witch_choice", "protect"]);
  const effects = new Set(ROLE_LIST.flatMap((role) => role.action ? [role.action.effect] : []));
  for (const effect of effects) {
    if (coreEffects.has(effect)) continue;
    assert.ok(roomSource.includes(`case "${effect}"`), `server resolver is missing ${effect}`);
  }
});

test("default role setup scales beyond the old 12-player cap", () => {
  const setup = defaultRoleSetup(30);
  assert.equal(Object.values(setup).reduce((sum, value) => sum + value, 0), 30);
  assert.equal(validateRoleSetup(setup, 30), undefined);
  assert.equal(roleDeckFromSetup(setup, 30).length, 30);
});

test("custom role setup accepts duplicated roles when counts match", () => {
  const setup = { werewolf: 2, villager: 3, seer: 2, witch: 1, guard: 2 };
  assert.equal(validateRoleSetup(setup, 10), undefined);
  const deck = roleDeckFromSetup(setup, 10);
  assert.equal(deck.filter((role) => role === "werewolf").length, 2);
  assert.equal(deck.filter((role) => role === "seer").length, 2);
  assert.equal(deck.filter((role) => role === "guard").length, 2);
});

test("role setup rejects invalid totals and unsafe starting parity", () => {
  assert.match(validateRoleSetup({ werewolf: 1, villager: 1 }, 3) ?? "", /角色總數/);
  assert.match(validateRoleSetup({ werewolf: 2, villager: 2 }, 4) ?? "", /少於其他玩家/);
});

test("village wins when no wolves or spirits remain", () => {
  assert.equal(checkWinner([p("a", "villager"), p("b", "seer")]), "village");
});

test("spirits take the endgame when wolves are gone but a spirit survives", () => {
  assert.equal(checkWinner([p("v", "villager"), p("s", "wraith")]), "spirit");
});

test("wolves win at parity", () => {
  assert.equal(checkWinner([p("w", "werewolf"), p("v", "villager")]), "werewolf");
});

test("blood wins when every survivor has blood allegiance", () => {
  assert.equal(checkWinner([p("a", "vampire"), p("b", "villager", true, false, { factionOverride: "blood" })]), "blood");
});

test("coward has its three-player special win", () => {
  assert.equal(checkWinner([p("c", "coward"), p("w", "werewolf"), p("v", "villager")]), "neutral");
});

test("a sole neutral last survivor wins", () => {
  assert.equal(checkWinner([p("q", "ice_queen")]), "neutral");
});

test("plurality returns unique top target and no target on tie", () => {
  assert.equal(pluralityTarget({ a: "x", b: "x", c: "y" }), "x");
  assert.equal(pluralityTarget({ a: "x", b: "y" }), undefined);
});

test("weighted voting supports zero-weight and PK top target detection", () => {
  const state = baseState([p("m", "masochist_cultist"), p("v", "villager"), p("w", "werewolf")], { m: "w", v: "w", w: "v" });
  assert.deepEqual(weightedVoteCounts(state), { w: 1, v: 1 });
  assert.deepEqual(new Set(topWeightedVoteTargets(state)), new Set(["v", "w"]));
});

test("guard prevents a wolf kill", () => {
  const result = resolveNight({
    players: [],
    nightActions: { wolfVotes: { w1: "v" }, seerTargets: {}, guardTargets: { g: "v" }, witchActions: {}, roleActions: {} },
    witchHealAvailable: true,
    witchPoisonAvailable: true
  });
  assert.deepEqual(result.deaths, []);
  assert.equal(result.protectedByGuard, true);
});

test("guard cannot protect the same target on consecutive nights", () => {
  assert.equal(canGuardTarget(undefined, "a"), true);
  assert.equal(canGuardTarget("a", "a"), false);
  assert.equal(canGuardTarget("a", "b"), true);
});

test("witch can heal a wolf target", () => {
  const result = resolveNight({
    players: [],
    nightActions: { wolfVotes: { w1: "v" }, seerTargets: {}, guardTargets: {}, witchActions: { witch: { type: "heal" } }, roleActions: {} },
    witchHealAvailable: true,
    witchPoisonAvailable: true
  });
  assert.deepEqual(result.deaths, []);
  assert.equal(result.healed, true);
});

test("witch poison adds a second death", () => {
  const result = resolveNight({
    players: [],
    nightActions: { wolfVotes: { w1: "v" }, seerTargets: {}, guardTargets: {}, witchActions: { witch: { type: "poison", targetId: "x" } }, roleActions: {} },
    witchHealAvailable: false,
    witchPoisonAvailable: true
  });
  assert.deepEqual(new Set(result.deaths), new Set(["v", "x"]));
});

test("witch self-save rule remains stable for larger rooms", () => {
  assert.equal(canWitchSelfSave(10, 1), true);
  assert.equal(canWitchSelfSave(10, 2), false);
  assert.equal(canWitchSelfSave(11, 1), false);
  assert.equal(canWitchSelfSave(30, 1), false);
});

test("debate order contains living players but skips captain formal speech", () => {
  const players = [p("a", "villager"), p("b", "werewolf"), p("captain", "captain"), p("dead", "seer", false), p("bot", "villager", true, true)];
  const order = createDebateOrder(players);
  assert.equal(order.length, 3);
  assert.deepEqual(new Set(order), new Set(["a", "b", "bot"]));
});

test("debate gate advances speaker by speaker and only completes at the end", () => {
  const order = ["a", "b", "c"];
  assert.equal(currentDebaterId(order, 0), "a");
  assert.equal(currentDebaterId(order, 1), "b");
  assert.equal(isDebateComplete(order, 2), false);
  assert.equal(currentDebaterId(order, 3), undefined);
  assert.equal(isDebateComplete(order, 3), true);
});

test("AI voting stays locked until a living human has voted", () => {
  const players = [p("human", "villager"), p("bot", "werewolf", true, true)];
  assert.equal(isAIVotingUnlocked(players, {}), false);
  assert.equal(isAIVotingUnlocked(players, { human: "bot" }), true);
});

test("AI can vote immediately when no living humans remain", () => {
  const players = [p("human", "villager", false), p("botA", "werewolf", true, true), p("botB", "villager", true, true)];
  assert.equal(isAIVotingUnlocked(players, {}), true);
});

test("vote completion only requires living formal players", () => {
  const state = baseState([p("a", "villager"), p("b", "werewolf", false)], { a: "b" });
  assert.equal(areVotesComplete(state), true);
});

test("player names use NFKC and case-insensitive room identity", () => {
  assert.equal(normalizePlayerName("  Ｒａｙ  ").key, normalizePlayerName("ray").key);
  assert.equal(normalizePlayerName("Alice   Chen").display, "Alice Chen");
});

test("player password verifier never stores plaintext and authenticates correctly", async () => {
  const verifier = await createPasswordVerifier("1234");
  assert.notEqual(verifier.hash, "1234");
  assert.equal(verifier.salt.length, 32);
  assert.equal(await verifyPassword("1234", verifier), true);
  assert.equal(await verifyPassword("9999", verifier), false);
});
