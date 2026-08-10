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
  growRoleSetup,
  isAIVotingUnlocked,
  isDebateComplete,
  needsNightAction,
  pluralityTarget,
  randomTopVoteTarget,
  resolveNight,
  roleDeckFromSetup,
  sheriffSecondVoteKey,
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
    roleSetup: {}, settings: { sheriffEnabled: false, deathInfo: "names", tieRule: "no_elimination", autoRoleSetup: false },
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

test("automatic role setup creates a sane basic board instead of randomly cropping all 114 roles", () => {
  const setup = defaultRoleSetup(10);
  assert.equal(Object.values(setup).reduce((sum, value) => sum + value, 0), 10);
  assert.equal(setup.werewolf, 3);
  assert.equal(setup.seer, 1);
  assert.equal(setup.witch, 1);
  assert.equal(setup.hunter, 1);
  assert.equal(setup.guard, 1);
  assert.equal(setup.villager, 3);
  assert.equal(setup.black_wolf_king, undefined);
  assert.equal(validateRoleSetup(setup, 10), undefined);
});

test("growing a manual board adds one villager without inflating every role", () => {
  const setup = { werewolf: 2, villager: 2, seer: 1, witch: 1 };
  const grown = growRoleSetup(setup);
  assert.notEqual(grown, setup);
  assert.equal(grown.villager, 3);
  assert.equal(grown.werewolf, 2);
  assert.equal(grown.seer, 1);
  assert.equal(grown.witch, 1);
});

test("oversized role pools are cropped to player count with at least one wolf and strict wolf minority", () => {
  const setup = Object.fromEntries(ROLE_LIST.map((role) => [role.id, 1]));
  for (let i = 0; i < 64; i += 1) {
    const deck = roleDeckFromSetup(setup, 30);
    const wolves = deck.filter((role) => roleDefinition(role).faction === "werewolf").length;
    assert.equal(deck.length, 30);
    assert.ok(wolves >= 1);
    assert.ok(wolves < deck.length - wolves);
  }
});

test("custom role setup accepts duplicated roles when counts match", () => {
  const setup = { werewolf: 2, villager: 3, seer: 2, witch: 1, guard: 2 };
  assert.equal(validateRoleSetup(setup, 10), undefined);
  const deck = roleDeckFromSetup(setup, 10);
  assert.equal(deck.filter((role) => role === "werewolf").length, 2);
  assert.equal(deck.filter((role) => role === "seer").length, 2);
  assert.equal(deck.filter((role) => role === "guard").length, 2);
});

test("custom oversized pools skip roles while preserving wolf safety", () => {
  const setup = { werewolf: 8, villager: 8, seer: 4 };
  assert.equal(validateRoleSetup(setup, 5), undefined);
  for (let i = 0; i < 64; i += 1) {
    const deck = roleDeckFromSetup(setup, 5);
    const wolves = deck.filter((role) => role === "werewolf").length;
    assert.equal(deck.length, 5);
    assert.ok(wolves >= 1 && wolves <= 2);
    assert.ok(deck.every((role) => ["werewolf", "villager", "seer"].includes(role)));
  }
});

test("role setup rejects insufficient pools and pools that cannot preserve a wolf minority", () => {
  assert.match(validateRoleSetup({ werewolf: 1, villager: 1 }, 3) ?? "", /角色總數/);
  assert.match(validateRoleSetup({ werewolf: 3, villager: 1 }, 4) ?? "", /非狼人陣營角色不足/);
});

test("village wins when no wolves or spirits remain", () => {
  assert.equal(checkWinner([p("a", "villager"), p("b", "seer")]), "village");
});

test("spirits take the endgame when wolves are gone but a spirit survives", () => {
  assert.equal(checkWinner([p("v", "villager"), p("s", "wraith")]), "spirit");
});

test("slaughter-edge mode does not award the old parity win while both village edges survive", () => {
  const players = [p("w1", "werewolf"), p("w2", "werewolf"), p("v", "villager"), p("g", "seer")];
  assert.equal(checkWinner(players), undefined);
});

test("slaughter-edge wolves win when an initially present civilian edge is wiped", () => {
  const players = [p("w", "werewolf"), p("v", "villager", false), p("g", "seer")];
  assert.equal(checkWinner(players), "werewolf");
});

test("slaughter-edge wolves win when an initially present god edge is wiped", () => {
  const players = [p("w", "werewolf"), p("v", "villager"), p("g", "seer", false)];
  assert.equal(checkWinner(players), "werewolf");
});

test("slaughter-all wolves must eliminate every non-werewolf opponent", () => {
  const players = [p("w", "werewolf"), p("v", "villager")];
  players.__winConditionMode = "slaughter_all";
  assert.equal(checkWinner(players), undefined);
  players[1].alive = false;
  assert.equal(checkWinner(players), "werewolf");
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

test("random tie elimination can only select a highest-vote tied candidate", () => {
  const state = baseState([p("a", "villager"), p("b", "villager"), p("c", "werewolf"), p("d", "villager")], {
    a: "b", b: "c", c: "b", d: "c"
  });
  assert.deepEqual(new Set(topWeightedVoteTargets(state)), new Set(["b", "c"]));
  for (let i = 0; i < 64; i += 1) assert.ok(["b", "c"].includes(randomTopVoteTarget(state)));
});

test("weighted voting supports zero-weight and PK top target detection", () => {
  const state = baseState([p("m", "masochist_cultist"), p("v", "villager"), p("w", "werewolf")], { m: "w", v: "w", w: "v" });
  assert.deepEqual(weightedVoteCounts(state), { w: 1, v: 1 });
  assert.deepEqual(new Set(topWeightedVoteTargets(state)), new Set(["v", "w"]));
});

test("sheriff owns two independent exile ballots and may split them", () => {
  const second = sheriffSecondVoteKey("s");
  const state = baseState([p("s", "villager"), p("v", "villager"), p("w", "werewolf")], { s: "w", [second]: "v", v: "w", w: "v" });
  state.sheriff.enabled = true;
  state.sheriff.sheriffId = "s";
  assert.deepEqual(weightedVoteCounts(state), { w: 2, v: 2 });

  state.votes[second] = "w";
  assert.deepEqual(weightedVoteCounts(state), { w: 3, v: 1 });

  state.roleMemory.s = { voteBonus: 2 };
  assert.deepEqual(weightedVoteCounts(state), { w: 5, v: 1 });
});

test("vote completion waits for the sheriff second ballot", () => {
  const players = [p("s", "villager"), p("w", "werewolf")];
  const state = baseState(players, { s: "w", w: "s" });
  state.sheriff.sheriffId = "s";
  assert.equal(areVotesComplete(state), false);
  state.votes[sheriffSecondVoteKey("s")] = "w";
  assert.equal(areVotesComplete(state), true);
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

test("one witch submission cannot resolve heal and poison in the same night", () => {
  const result = resolveNight({
    players: [],
    nightActions: { wolfVotes: { w1: "v" }, seerTargets: {}, guardTargets: {}, witchActions: { witch: { type: "heal", targetId: "x" } }, roleActions: {} },
    witchHealAvailable: true,
    witchPoisonAvailable: true
  });
  assert.equal(result.healed, true);
  assert.equal(result.poisonedTarget, undefined);
  assert.deepEqual(result.deaths, []);
});

test("witch self-save rule remains stable for larger rooms", () => {
  assert.equal(canWitchSelfSave(10, 1), true);
  assert.equal(canWitchSelfSave(10, 2), false);
  assert.equal(canWitchSelfSave(11, 1), false);
  assert.equal(canWitchSelfSave(30, 1), false);
});

test("only the designated wolf leader needs an ordinary wolf kill submission", () => {
  const w1 = p("w1", "werewolf");
  const w2 = p("w2", "werewolf");
  const v = p("v", "villager");
  const state = baseState([w1, w2, v]);
  state.phase = "night";
  state.roleMemory.__system = { wolfLeaderId: "w1" };
  assert.equal(needsNightAction(state, w1), true);
  assert.equal(needsNightAction(state, w2), false);
});

test("a non-leader wolf still has to submit its own special night skill", () => {
  const leader = p("leader", "werewolf");
  const special = p("special", "shapeshifter_wolf");
  const v = p("v", "villager");
  const state = baseState([leader, special, v]);
  state.phase = "night";
  state.roleMemory.__system = { wolfLeaderId: "leader" };
  assert.equal(needsNightAction(state, special), true);
  state.nightActions.roleActions.special = { effect: "disguise_as_target", targetIds: ["v"], submittedAt: 1 };
  assert.equal(needsNightAction(state, special), false);
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

test("vote completion only requires living formal players when there is no living sheriff", () => {
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
