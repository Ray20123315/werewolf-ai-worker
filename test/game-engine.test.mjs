import test from "node:test";
import assert from "node:assert/strict";
import {
  areVotesComplete,
  canGuardTarget,
  canWitchSelfSave,
  checkWinner,
  createDebateOrder,
  currentDebaterId,
  isAIVotingUnlocked,
  isDebateComplete,
  pluralityTarget,
  resolveNight,
  roleDeck
} from "../.test-build/game-engine.js";

function p(id, role, alive = true, isAI = false) {
  return { id, token: `t-${id}`, name: id, alive, isAI, role, joinedAt: 0 };
}

test("roleDeck creates a valid 8-player deck", () => {
  const deck = roleDeck(8);
  assert.equal(deck.length, 8);
  assert.equal(deck.filter((r) => r === "werewolf").length, 2);
  assert.ok(deck.includes("seer"));
  assert.ok(deck.includes("witch"));
});

test("roleDeck rejects unsupported player counts", () => {
  assert.throws(() => roleDeck(4));
  assert.throws(() => roleDeck(13));
});

test("village wins when no wolves remain", () => {
  assert.equal(checkWinner([p("a", "villager"), p("b", "seer")]), "village");
});

test("wolves win at parity", () => {
  assert.equal(checkWinner([p("w", "werewolf"), p("v", "villager")]), "werewolf");
});

test("plurality returns unique top target and no target on tie", () => {
  assert.equal(pluralityTarget({ a: "x", b: "x", c: "y" }), "x");
  assert.equal(pluralityTarget({ a: "x", b: "y" }), undefined);
});

test("guard prevents a wolf kill", () => {
  const result = resolveNight({
    players: [],
    nightActions: { wolfVotes: { w1: "v" }, seerTargets: {}, guardTargets: { g: "v" }, witchActions: {} },
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
    nightActions: { wolfVotes: { w1: "v" }, seerTargets: {}, guardTargets: {}, witchActions: { witch: { type: "heal" } } },
    witchHealAvailable: true,
    witchPoisonAvailable: true
  });
  assert.deepEqual(result.deaths, []);
  assert.equal(result.healed, true);
});

test("witch poison adds a second death", () => {
  const result = resolveNight({
    players: [],
    nightActions: { wolfVotes: { w1: "v" }, seerTargets: {}, guardTargets: {}, witchActions: { witch: { type: "poison", targetId: "x" } } },
    witchHealAvailable: false,
    witchPoisonAvailable: true
  });
  assert.deepEqual(new Set(result.deaths), new Set(["v", "x"]));
});

test("witch self-save is first-night-only for ten players or fewer", () => {
  assert.equal(canWitchSelfSave(10, 1), true);
  assert.equal(canWitchSelfSave(10, 2), false);
  assert.equal(canWitchSelfSave(11, 1), false);
  assert.equal(canWitchSelfSave(12, 1), false);
});

test("debate order contains every living player exactly once", () => {
  const players = [p("a", "villager"), p("b", "werewolf"), p("dead", "seer", false), p("bot", "villager", true, true)];
  const order = createDebateOrder(players);
  assert.equal(order.length, 3);
  assert.deepEqual(new Set(order), new Set(["a", "b", "bot"]));
  assert.equal(new Set(order).size, order.length);
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

test("vote completion only requires living players", () => {
  const state = { players: [p("a", "villager"), p("b", "werewolf", false)], votes: { a: "b" } };
  assert.equal(areVotesComplete(state), true);
});
