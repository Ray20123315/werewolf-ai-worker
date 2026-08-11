import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ABSTAIN_TARGET,
  areEqualVotesComplete,
  createVoteSnapshot,
  equalVoteCounts,
  equalVoteTopTargets,
  randomEqualVoteTopTarget,
  sanitizeExileVotes
} from "../.test-build/equal-vote.js";

function player(id, extra = {}) {
  return {
    id,
    token: `t-${id}`,
    name: id,
    nameKey: id,
    alive: true,
    isAI: false,
    isSpectator: false,
    role: "villager",
    joinedAt: 0,
    ...extra
  };
}

function state(players, votes = {}) {
  return {
    roomId: "ABC234",
    hostPlayerId: players[0]?.id ?? "",
    phase: "vote",
    round: 1,
    players,
    roleSetup: {},
    settings: { sheriffEnabled: true, deathInfo: "names", tieRule: "revote", autoRoleSetup: false },
    sheriff: { enabled: true, electionRound: 1, candidates: [], votes: {}, sheriffId: players[0]?.id, successors: [] },
    messages: [],
    votes,
    nightActions: { wolfVotes: {}, seerTargets: {}, guardTargets: {}, witchActions: {}, roleActions: {} },
    roleMemory: {},
    seerResults: {}, roleResults: {}, witchHealAvailable: true, witchPoisonAvailable: true,
    guardLastTargets: {}, debateOrder: [], debateIndex: 0, debateCompleted: [], lastNightDeaths: [], deathReasons: {}, moderatorIds: [], initialPlayerCount: players.length, createdAt: 0, updatedAt: 0
  };
}

test("ordinary exile keeps one base ballot while role-defined invalid ballots stay invalid", () => {
  const a = player("a", { role: "masochist_cultist" });
  const b = player("b", { role: "werewolf" });
  const c = player("c", { role: "raven" });
  const kicked = player("k", { kickedAt: 1 });
  const s = state([a, b, c, kicked], {
    a: "b",
    b: "a",
    c: "b",
    k: "b",
    "a::sheriff2": "b"
  });
  s.roleMemory.a = { voteBonus: 9, bombHolder: "a" };
  s.roleMemory.c = { ravenVote: "a" };

  sanitizeExileVotes(s);
  assert.deepEqual(s.votes, { a: "b", b: "a", c: "b" });
  assert.deepEqual(equalVoteCounts(s), { a: 1, b: 1 });
  assert.deepEqual(new Set(equalVoteTopTargets(s)), new Set(["a", "b"]));
  const snapshot = createVoteSnapshot(s);
  assert.equal(snapshot.entries.find((entry) => entry.voterId === "a")?.status, "invalid");
});

test("kicked dead and spectator players do not participate in completion or tally", () => {
  const a = player("a");
  const b = player("b");
  const kicked = player("k", { kickedAt: 1 });
  const dead = player("dead", { alive: false });
  const spectator = player("spec", { isSpectator: true });
  const s = state([a, b, kicked, dead, spectator], { a: "b", b: "a", kicked: "b", dead: "a", spec: "a" });
  sanitizeExileVotes(s);
  assert.deepEqual(s.votes, { a: "b", b: "a" });
  assert.equal(areEqualVotesComplete(s), true);
});

test("a vote aimed at a kicked player is removed, remembered as invalid, and voter must vote again", () => {
  const a = player("a");
  const b = player("b");
  const kicked = player("k", { kickedAt: 1 });
  const s = state([a, b, kicked], { a: "k", b: "a" });
  sanitizeExileVotes(s);
  assert.deepEqual(s.votes, { b: "a" });
  assert.equal(areEqualVotesComplete(s), false);
  assert.equal(createVoteSnapshot(s).entries.some((entry) => entry.voterId === "a" && entry.status === "invalid"), true);
});

test("abstain completes that player's ballot without adding a tally", () => {
  const a = player("a");
  const b = player("b");
  const s = state([a, b], { a: ABSTAIN_TARGET, b: ABSTAIN_TARGET });
  assert.equal(areEqualVotesComplete(s), true);
  const snapshot = createVoteSnapshot(s);
  assert.deepEqual(snapshot.counts, {});
  assert.equal(snapshot.entries.filter((entry) => entry.status === "abstain").length, 2);
});

test("highest-count tie randomly resolves only inside the tied-highest set", () => {
  const players = [player("a"), player("b"), player("c"), player("d")];
  const s = state(players, { a: "c", b: "d", c: "d", d: "c" });
  assert.deepEqual(new Set(equalVoteTopTargets(s)), new Set(["c", "d"]));
  for (let i = 0; i < 32; i += 1) assert.ok(["c", "d"].includes(randomEqualVoteTopTarget(s)));
});

test("runtime uses an immutable vote snapshot, fixed random top tie and no sheriff second ballot", () => {
  const source = readFileSync(new URL("../src/equal-vote.ts", import.meta.url), "utf8");
  assert.match(source, /proto\.castVoteById = function/);
  assert.match(source, /ABSTAIN_TARGET/);
  assert.match(source, /const snapshot = createVoteSnapshot\(state\)/);
  assert.match(source, /announceVoteSnapshot/);
  assert.match(source, /state\.settings\.tieRule = FIXED_TIE_RULE/);
  assert.match(source, /從最高票並列者中隨機抽中/);
  assert.doesNotMatch(source, /sheriffSecondVoteKey/);
  assert.doesNotMatch(source, /pk_revote|voteRevoteCount\s*=|effectiveVoteWeight/);
});
