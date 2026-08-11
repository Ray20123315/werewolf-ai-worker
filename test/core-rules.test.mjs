import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CORE_REMOVED_ROLE_IDS, activeCoreRoleDefinitions, coreWinner, defaultAllRoleSetup, exactDuplicateCoreSkills, installCoreRules } from "../.test-build/core-rules.js";
import { ABSTAIN_TARGET, createVoteSnapshot } from "../.test-build/equal-vote.js";
import { installHouseRules } from "../.test-build/house-rules.js";
import { WORD_ROLE_IDS } from "../.test-build/word-role-allowlist.js";

function player(id, role, factionOverride) {
  return { id, token: `t-${id}`, name: id, nameKey: id, alive: true, isAI: false, isSpectator: false, role, ...(factionOverride ? { factionOverride } : {}), joinedAt: 0 };
}

function baseState(players, winCondition = "slaughter_edge") {
  return {
    roomId: "ABC234", hostPlayerId: players[0]?.id || "a", phase: "vote", round: 1, players,
    roleSetup: {}, settings: { sheriffEnabled: false, deathInfo: "names", tieRule: "random_elimination", autoRoleSetup: false, winCondition },
    sheriff: { enabled: false, electionRound: 0, candidates: [], votes: {}, successors: [] }, messages: [], votes: {},
    nightActions: { wolfVotes: {}, seerTargets: {}, guardTargets: {}, witchActions: {}, roleActions: {} }, roleMemory: {}, seerResults: {}, roleResults: {},
    witchHealAvailable: true, witchPoisonAvailable: true, guardLastTargets: {}, debateOrder: [], debateIndex: 0, debateCompleted: [], lastNightDeaths: [], deathReasons: {}, moderatorIds: [], initialPlayerCount: players.length, createdAt: 0, updatedAt: 0
  };
}

test("default room role pool starts every active role at one and removes deprecated/redundant roles", () => {
  const setup = defaultAllRoleSetup();
  for (const count of Object.values(setup)) assert.equal(count, 1);
  for (const id of CORE_REMOVED_ROLE_IDS) assert.equal(setup[id], undefined);
  assert.ok(Object.keys(setup).length > 80);
});

test("Gold Water is absent from the canonical product role surface", () => {
  assert.equal(activeCoreRoleDefinitions().some((role) => role.id === "confirmed_villager" || role.name === "金水"), false);
  assert.equal(WORD_ROLE_IDS.includes("confirmed_villager"), false);
  const roleNames = readFileSync(new URL("../public/role-name-i18n.js", import.meta.url), "utf8");
  assert.doesNotMatch(roleNames, /金水|Confirmed Villager/);
});

test("active core role pool has no exact duplicate same-faction skill signatures", () => {
  assert.deepEqual(exactDuplicateCoreSkills(), []);
});

test("slaughter-edge only gives wolves the requested one-human edge when no spirit remains", () => {
  const wolf = player("w", "werewolf");
  const human = player("h", "villager");
  let state = baseState([wolf, human], "slaughter_edge");
  assert.equal(coreWinner(state), "werewolf");

  const spirit = player("s", "wraith");
  state = baseState([wolf, human, spirit], "slaughter_edge");
  assert.equal(coreWinner(state), undefined);
});

test("slaughter-all requires every living non-wolf faction to be gone", () => {
  const wolf = player("w", "werewolf");
  const human = player("h", "villager");
  const state = baseState([wolf, human], "slaughter_all");
  assert.equal(coreWinner(state), undefined);
  human.alive = false;
  assert.equal(coreWinner(state), "werewolf");
});

test("vote snapshot freezes equal counts while separating abstain and role-invalid ballots", () => {
  const a = player("a", "villager");
  const b = player("b", "masochist_cultist");
  const c = player("c", "villager");
  const state = baseState([a, b, c]);
  state.votes = { a: "b", b: "a", c: ABSTAIN_TARGET };
  const snapshot = createVoteSnapshot(state);
  assert.deepEqual(snapshot.counts, { b: 1 });
  assert.equal(snapshot.entries.find((entry) => entry.voterId === "c")?.status, "abstain");
  assert.equal(snapshot.entries.find((entry) => entry.voterId === "b")?.status, "invalid");
  assert.deepEqual(snapshot.topTargetIds, ["b"]);
});

test("final core layer neutralizes stale sheriff two-ballot AI behavior", async () => {
  class FakeRoom {
    requireState() { return this.state; }
    configureSettings() {}
    enterNight() {}
    participatesWolfVote() { return true; }
    firstLivingWolfId() { return "s"; }
    castVoteById() {}
    finishVote() {}
    finishNight() {}
    validateWitchAction() {}
    pendingAITask() { return undefined; }
    runAI() { return Promise.resolve({ ok: true }); }
    publicContext() { return ""; }
    projectState() { return { settings: {}, me: {} }; }
    handleClientMessage() {}
    decideAIVote() { return Promise.resolve("legacy-a|legacy-b"); }
    decideAITarget(_state, _actor, _keys, candidates) { return Promise.resolve(candidates[0].id); }
    systemMem(state) { state.roleMemory.__system ??= {}; return state.roleMemory.__system; }
  }
  installHouseRules(FakeRoom);
  installCoreRules(FakeRoom);
  const sheriff = { ...player("s", "werewolf"), isAI: true, ai: { provider: "deepseek", model: "x" } };
  const target = player("t", "villager");
  const room = new FakeRoom();
  const state = baseState([sheriff, target]);
  state.sheriff.sheriffId = sheriff.id;
  const chosen = await room.decideAIVote(state, sheriff, ["k"]);
  assert.equal(chosen, target.id);
  assert.doesNotMatch(chosen, /\|/);
});

test("all-AI wolf rooms schedule private council before the underlying night action", () => {
  class FakeRoom {
    requireState() { return this.state; }
    pendingAITask() { return { playerId: "w1", operation: "night_action" }; }
    runAI() { return Promise.resolve({ ok: true }); }
    systemMem(state) { state.roleMemory.__system ??= {}; return state.roleMemory.__system; }
  }
  installCoreRules(FakeRoom);
  const w1 = { ...player("w1", "werewolf"), isAI: true, ai: { provider: "deepseek", model: "x" } };
  const w2 = { ...player("w2", "werewolf"), isAI: true, ai: { provider: "deepseek", model: "x" } };
  const h = player("h", "villager");
  const state = baseState([w1, w2, h]);
  state.phase = "night";
  const room = new FakeRoom();
  assert.deepEqual(room.pendingAITask(state), { playerId: "w1", operation: "core_wolf_council" });
});

test("browser core controls expose fool, group Cupid, timer, hunter last words and abstain actions", () => {
  const source = readFileSync(new URL("../public/core-rules.js", import.meta.url), "utf8");
  const index = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(source, /coreFoolEnabled/);
  assert.match(source, /coreLoverGroupSize/);
  assert.match(source, /phaseDeadlineAt/);
  assert.match(source, /canHunterLastWords/);
  assert.match(source, /__abstain__/);
  assert.match(source, /link_lovers/);
  assert.match(index, /<script src="\/core-rules\.js"><\/script>/);
});
