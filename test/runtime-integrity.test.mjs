import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installCoreIntegrityRules, coreActionOptions, normalizeDebateCursor } from "../.test-build/core-integrity.js";
import { installCoreTerminalRules } from "../.test-build/core-terminal.js";
import { coreWinner } from "../.test-build/core-state.js";
import { installCoreRules } from "../.test-build/core-rules.js";
import { createVoteSnapshot, installEqualVoteRules } from "../.test-build/equal-vote.js";
import { roleActionPrompt } from "../.test-build/game-engine.js";
import { roleDefinition } from "../.test-build/roles.js";

function player(id, role, extra = {}) {
  return {
    id,
    token: `t-${id}`,
    name: id,
    nameKey: id,
    alive: true,
    isAI: false,
    isSpectator: false,
    role,
    joinedAt: 0,
    ...extra
  };
}

function state(players, phase = "night") {
  return {
    roomId: "ABC234",
    hostPlayerId: players[0]?.id || "a",
    phase,
    round: 1,
    players,
    roleSetup: {},
    settings: { sheriffEnabled: false, deathInfo: "names", tieRule: "random_elimination", autoRoleSetup: false, winCondition: "slaughter_edge" },
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

function memoryRoomBase() {
  return class BaseRoom {
    mem(st, id) { st.roleMemory[id] ??= {}; return st.roleMemory[id]; }
    systemMem(st) { st.roleMemory.__system ??= {}; return st.roleMemory.__system; }
    saveBroadcast() {}
    addSystemMessage(st, content) { st.messages.push({ id: String(st.messages.length + 1), playerName: "系統", content, kind: "system", createdAt: 0, round: st.round, phase: st.phase }); }
  };
}

test("debate cursor skips dead, kicked, spectator and completed speakers instead of hard-locking", () => {
  const a = player("a", "villager");
  const b = player("b", "villager", { alive: false });
  const c = player("c", "villager", { kickedAt: 1, isSpectator: true });
  const d = player("d", "villager");
  const st = state([a, b, c, d], "debate");
  st.debateOrder = ["a", "b", "c", "d"];
  st.debateCompleted = ["a"];
  assert.equal(normalizeDebateCursor(st), true);
  assert.equal(st.debateIndex, 3);
  assert.equal(st.debateOrder[st.debateIndex], "d");
});

test("conditional night abilities are absent until their server-side prerequisite is true", () => {
  const bee = player("bee", "bee");
  const hive = player("hive", "hive");
  const persuader = player("pw", "persuader_wolf");
  const otherWolf = player("w", "werewolf");
  const redAxe = player("axe", "red_axe_madman");
  const villager = player("v", "villager");
  const st = state([bee, hive, persuader, otherWolf, redAxe, villager]);

  assert.equal(roleActionPrompt(bee, st), undefined);
  hive.alive = false;
  assert.equal(roleActionPrompt(bee, st)?.effect, "kill_if_hive_dead");

  assert.equal(roleActionPrompt(persuader, st), undefined);
  otherWolf.alive = false;
  assert.equal(roleActionPrompt(persuader, st)?.effect, "convert_to_werewolf_if_last");

  assert.equal(roleActionPrompt(redAxe, st), undefined);
  persuader.alive = false;
  assert.equal(roleActionPrompt(redAxe, st)?.effect, "kill_if_no_wolves");
});

test("AI option surface removes already-spent Warlock resources and impossible Ice Queen detonate", () => {
  const warlock = player("warlock", "warlock");
  const victim = player("v", "villager");
  const st = state([warlock, victim]);
  const warlockPrompt = roleActionPrompt(warlock, st);
  assert.ok(warlockPrompt);
  st.roleMemory.warlock = { warlockPoisonUsed: true };
  assert.deepEqual(coreActionOptions(st, warlock, warlockPrompt), ["nullify", "pass"]);

  const queen = player("queen", "ice_queen");
  const st2 = state([queen, victim]);
  const queenPrompt = roleActionPrompt(queen, st2);
  assert.ok(queenPrompt);
  assert.deepEqual(coreActionOptions(st2, queen, queenPrompt), ["freeze"]);
  st2.roleMemory.queen = { frozenTargets: ["v"] };
  assert.deepEqual(coreActionOptions(st2, queen, queenPrompt), ["freeze", "detonate"]);
});

test("night control effects are pre-staged so Dream Wolf disables Seer, Guard and Witch before their core paths", () => {
  class Room extends memoryRoomBase() {
    finishNight(st) {
      this.observed = {
        seer: { ...st.nightActions.seerTargets },
        guard: { ...st.nightActions.guardTargets },
        witch: { ...st.nightActions.witchActions }
      };
    }
  }
  installCoreIntegrityRules(Room);
  const d1 = player("d1", "dream_wolf");
  const d2 = player("d2", "dream_wolf");
  const d3 = player("d3", "dream_wolf");
  const seer = player("seer", "seer");
  const guard = player("guard", "guard");
  const witch = player("witch", "witch");
  const v = player("v", "villager");
  const st = state([d1, d2, d3, seer, guard, witch, v]);
  st.nightActions.seerTargets.seer = "v";
  st.nightActions.guardTargets.guard = "v";
  st.nightActions.witchActions.witch = { type: "poison", targetId: "v" };
  st.nightActions.roleActions.d1 = { effect: "disable_current_action", targetIds: ["seer"], submittedAt: 1 };
  st.nightActions.roleActions.d2 = { effect: "disable_current_action", targetIds: ["guard"], submittedAt: 1 };
  st.nightActions.roleActions.d3 = { effect: "disable_current_action", targetIds: ["witch"], submittedAt: 1 };
  const room = new Room();
  room.finishNight(st);
  assert.deepEqual(room.observed.seer, {});
  assert.deepEqual(room.observed.guard, {});
  assert.deepEqual(room.observed.witch.witch, { type: "pass" });
});

test("Warlock nullify is staged before a submitted core action resolves", () => {
  class Room extends memoryRoomBase() {
    finishNight(st) { this.seerAtResolve = { ...st.nightActions.seerTargets }; }
  }
  installCoreIntegrityRules(Room);
  const warlock = player("warlock", "warlock");
  const seer = player("seer", "seer");
  const v = player("v", "villager");
  const st = state([warlock, seer, v]);
  st.nightActions.seerTargets.seer = "v";
  st.nightActions.roleActions.warlock = { effect: "warlock_choice", targetIds: ["seer"], option: "nullify", submittedAt: 1 };
  const room = new Room();
  room.finishNight(st);
  assert.deepEqual(room.seerAtResolve, {});
  assert.equal(st.roleMemory.seer.disabledUntilRound, 1);
});

test("Fake Killer creates fake death without invoking the real death pipeline", () => {
  class Room extends memoryRoomBase() {
    resolveNightRoleAction() { this.baseResolveCalled = true; }
    killPlayer() { this.killCalls = (this.killCalls || 0) + 1; return true; }
  }
  installCoreIntegrityRules(Room);
  const killer = player("f", "fake_killer");
  const target = player("v", "villager");
  const st = state([killer, target]);
  const room = new Room();
  room.resolveNightRoleAction(st, killer, { effect: "fake_kill", targetIds: ["v"], submittedAt: 1 });
  assert.equal(room.killCalls || 0, 0);
  assert.equal(target.alive, false);
  assert.equal(st.roleMemory.v.fakeDeath, true);
  assert.equal(st.roleMemory.v.reviveRound, 2);
});

test("Magician one-alive/one-dead swap uses the death pipeline; two dead targets do not swap roles", () => {
  class Room extends memoryRoomBase() {
    resolveNightRoleAction() {}
    killPlayer(st, id) {
      this.killCalls = (this.killCalls || 0) + 1;
      const p = st.players.find((x) => x.id === id && x.alive);
      if (!p) return false;
      p.alive = false;
      st.deathReasons[id] = "r1:magician_swap";
      return true;
    }
  }
  installCoreIntegrityRules(Room);
  const mage = player("m", "magician");
  const alive = player("a", "seer");
  const dead = player("d", "hunter", { alive: false });
  const st = state([mage, alive, dead]);
  const room = new Room();
  room.resolveNightRoleAction(st, mage, { effect: "magician_swap", targetIds: ["a", "d"], submittedAt: 1 });
  assert.equal(room.killCalls, 1);
  assert.equal(alive.alive, false);
  assert.equal(dead.alive, true);

  const d1 = player("d1", "seer", { alive: false });
  const d2 = player("d2", "hunter", { alive: false });
  const st2 = state([mage, d1, d2]);
  room.resolveNightRoleAction(st2, mage, { effect: "magician_swap", targetIds: ["d1", "d2"], submittedAt: 1 });
  assert.equal(d1.role, "seer");
  assert.equal(d2.role, "hunter");
});

test("Suicide Bomber may choose at most two targets and all-dead explosion has an explicit individual terminal", () => {
  class Room extends memoryRoomBase() {
    submitRoleActionInternal() {}
    resolveImmediateRoleAction() {}
    legalTargets(st, actor) { return st.players.filter((p) => p.alive && !p.isSpectator && !p.kickedAt && p.id !== actor.id); }
    killPlayer(st, id) {
      const p = st.players.find((x) => x.id === id && x.alive);
      if (!p) return false;
      p.alive = false;
      st.deathReasons[id] = "r1:suicide_bomber";
      return true;
    }
    checkAndMaybeEnd() {}
    endGame(st) { st.phase = "ended"; }
  }
  installCoreIntegrityRules(Room);
  const bomber = player("b", "suicide_bomber");
  const a = player("a", "villager");
  const w = player("w", "werewolf");
  const st = state([bomber, a, w], "debate");
  st.debateOrder = ["b", "a", "w"];
  const room = new Room();
  room.submitRoleActionInternal(st, bomber, "suicide_bomb", ["a", "w"]);
  assert.equal(st.phase, "ended");
  assert.equal(st.winner, "neutral");
  assert.deepEqual(st.winnerPlayerIds, ["b"]);
  assert.match(st.winnerLabel, /個人特殊勝利/);
});

test("Red Axe keeps the game alive after wolves are gone and wins only as the last survivor", () => {
  const axe = player("axe", "red_axe_madman");
  const v = player("v", "villager");
  let st = state([axe, v], "night");
  assert.equal(coreWinner(st), undefined);
  v.alive = false;
  assert.equal(coreWinner(st), "neutral");
});

test("final night terminal suppresses a stale legacy village win while Red Axe continuation is legal", () => {
  class Room extends memoryRoomBase() {
    requireState() { return this.state; }
    finishNight(st) { this.endGame(st, "village"); }
    endGame(st, winner) { st.phase = "ended"; st.winner = winner; }
    checkAndMaybeEnd() {}
    beginDebate(st) { st.phase = "debate"; }
  }
  installCoreTerminalRules(Room);
  const axe = player("axe", "red_axe_madman");
  const v = player("v", "villager");
  const st = state([axe, v], "night");
  const room = new Room();
  room.state = st;
  room.finishNight(st);
  assert.equal(st.winner, undefined);
  assert.equal(st.phase, "debate");
});

test("neutral endGame projection lists only actual current neutral winners, not dead neutral roles", () => {
  class Room extends memoryRoomBase() {
    endGame(st, winner) { st.phase = "ended"; st.winner = winner; }
  }
  installCoreIntegrityRules(Room);
  const aliveNeutral = player("n1", "ice_queen");
  const deadNeutral = player("n2", "coward", { alive: false });
  const st = state([aliveNeutral, deadNeutral], "debate");
  new Room().endGame(st, "neutral");
  assert.deepEqual(st.winnerPlayerIds, ["n1"]);
});

test("Raven and Bomb adapt to invalid-ballot semantics while Berserker can spend one shield without adding vote weight", () => {
  class VoteRoom extends memoryRoomBase() {
    requireState() { return this.state; }
    saveBroadcast() {}
    finishVote() { this.finished = true; }
  }
  installEqualVoteRules(VoteRoom);

  const ravenTarget = player("r", "villager");
  const other = player("o", "villager");
  let st = state([ravenTarget, other], "vote");
  st.roleMemory.r = { ravenInvalidVoteRound: 1 };
  st.votes.r = "o";
  let snap = createVoteSnapshot(st);
  assert.equal(snap.entries.find((e) => e.voterId === "r")?.status, "invalid");
  assert.deepEqual(snap.counts, {});

  const bombHolder = player("b", "villager");
  const target = player("t", "villager");
  const third = player("x", "villager");
  st = state([bombHolder, target, third], "vote");
  st.roleMemory.b = { bombHolder: "b" };
  const voteRoom = new VoteRoom();
  voteRoom.state = st;
  voteRoom.castVoteById(st, "b", "t");
  assert.equal(st.roleMemory.b.bombInvalidVoteRound, 1);
  assert.equal(st.roleMemory.b.bombHolder, undefined);
  assert.equal(st.roleMemory.t.bombHolder, "t");
  snap = createVoteSnapshot(st);
  assert.equal(snap.entries.find((e) => e.voterId === "b")?.status, "invalid");

  const berserker = player("z", "berserker_wolf");
  st = state([berserker, target, third], "vote");
  st.roleMemory.z = { ravenInvalidVoteRound: 1, voteBonus: 1 };
  const shieldRoom = new VoteRoom();
  shieldRoom.state = st;
  shieldRoom.castVoteById(st, "z", "t");
  snap = createVoteSnapshot(st);
  assert.equal(st.roleMemory.z.voteBonus, 0);
  assert.equal(snap.entries.find((e) => e.voterId === "z")?.status, "valid");
  assert.equal(snap.counts.t, 1);
});

test("canonical role text matches final one-player-one-vote and fake-death semantics", () => {
  class Empty {}
  installCoreRules(Empty);
  assert.match(roleDefinition("raven").summary, /票無效/);
  assert.doesNotMatch(roleDefinition("raven").summary, /多一票/);
  assert.match(roleDefinition("bomb_wolf").summary, /該票無效/);
  assert.match(roleDefinition("berserker_wolf").summary, /仍只計 1 票/);
  assert.match(roleDefinition("fake_killer").summary, /不觸發.*真死亡/);
  assert.match(roleDefinition("suicide_bomber").summary, /0～2/);
});

test("final composition keeps CoreRules last and removes active sheriff pseudo-ballot sources", () => {
  const chat = readFileSync(new URL("../src/chat-channels.ts", import.meta.url), "utf8");
  const core = readFileSync(new URL("../src/core-rules.ts", import.meta.url), "utf8");
  const house = readFileSync(new URL("../src/house-rules.ts", import.meta.url), "utf8");
  const aiFlow = readFileSync(new URL("../src/ai-flow.ts", import.meta.url), "utf8");
  const integrity = readFileSync(new URL("../src/core-integrity.ts", import.meta.url), "utf8");
  assert.match(chat, /installCoreRules\(GameRoomCtor\);/);
  assert.match(core, /installCoreIntegrityRules\(GameRoomCtor\);[\s\S]*installCoreTerminalRules\(GameRoomCtor\);/);
  assert.doesNotMatch(house, /sheriffSecondVoteKey|兩張獨立放逐票|targetIds.*玩家ID1.*玩家ID2/);
  assert.doesNotMatch(aiFlow, /sheriffSecondVoteKey/);
  assert.match(integrity, /\{"option":"合法 option","targetIds":\["合法玩家ID"\]\}/);
});
