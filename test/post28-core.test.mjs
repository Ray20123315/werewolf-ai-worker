import test from "node:test";
import assert from "node:assert/strict";
import {
  installPost28FullRepairRules,
  normalizeDebateSlots,
  revivePlayerInvariant
} from "../.test-build/core-post28-repair.js";
import { installPost28FinalizeRules } from "../.test-build/core-post28-finalize.js";
import { playerFaction } from "../.test-build/game-engine.js";

function player(id, role, extra = {}) {
  return { id, token: `t-${id}`, name: id.toUpperCase(), nameKey: id, alive: true, isAI: false, isSpectator: false, role, joinedAt: 0, ...extra };
}

function state(players, phase = "night", round = 1) {
  return {
    roomId: "ABC234", hostPlayerId: players[0]?.id ?? "a", phase, round, players, roleSetup: {},
    settings: { sheriffEnabled: false, deathInfo: "names", tieRule: "random_elimination", autoRoleSetup: false, winCondition: "slaughter_edge", dayDurationSeconds: 120, nightDurationSeconds: 120 },
    sheriff: { enabled: false, electionRound: 1, candidates: [], votes: {}, successors: [] },
    messages: [], votes: {}, nightActions: { wolfVotes: {}, seerTargets: {}, guardTargets: {}, witchActions: {}, roleActions: {} },
    roleMemory: {}, seerResults: {}, roleResults: {}, witchHealAvailable: true, witchPoisonAvailable: true, guardLastTargets: {},
    debateOrder: [], debateIndex: 0, debateCompleted: [], lastNightDeaths: [], deathReasons: {}, moderatorIds: [], initialPlayerCount: players.length,
    createdAt: 0, updatedAt: 0
  };
}

function MemoryBase(Base = class {}) {
  return class extends Base {
    mem(st, id) { st.roleMemory[id] ??= {}; return st.roleMemory[id]; }
    systemMem(st) { return this.mem(st, "__system"); }
    playerByToken(st, token) { const found = st.players.find((p) => p.token === token); if (!found) throw new Error("missing player"); return found; }
    saveBroadcast() { this.saved = (this.saved ?? 0) + 1; }
    touchAndSave() { this.touched = (this.touched ?? 0) + 1; }
    broadcast() {}
    addSystemMessage() {}
    legalTargets(st, actor, mode) {
      const living = st.players.filter((p) => p.alive && !p.isSpectator && !p.kickedAt);
      if (mode === "none") return [];
      if (mode === "one_alive_any" || mode === "two_alive_any") return living;
      if (mode === "one_alive_non_wolf") return living.filter((p) => p.id !== actor.id && playerFaction(p) !== "werewolf");
      if (mode === "one_dead") return st.players.filter((p) => !p.alive && !p.isSpectator && !p.kickedAt);
      if (mode === "two_any") return st.players.filter((p) => p.id !== actor.id && !p.isSpectator && !p.kickedAt);
      return living.filter((p) => p.id !== actor.id);
    }
  };
}

function install(Room) {
  installPost28FullRepairRules(Room);
  installPost28FinalizeRules(Room);
  return Room;
}

test("Spy/Gambler winning allegiance is not their mechanical faction", () => {
  class Room extends MemoryBase() {
    constructor(st) { super(); this.current = st; }
    requireState() { return this.current; }
    participatesWolfVote() { return true; }
  }
  install(Room);
  const spy = player("s", "spy", { factionOverride: "werewolf" });
  const st = state([spy, player("w", "werewolf"), player("v", "villager")]);
  const room = new Room(st);
  room.requireState();
  assert.equal(playerFaction(spy), "neutral");
  assert.equal(st.roleMemory.s.winningAllegiance, "werewolf");
  assert.equal(room.participatesWolfVote(st, spy), false);
});

test("hidden wolf passives, Lurking wake-up and Wise list semantics are observable", () => {
  class Room extends MemoryBase() { wolfTeammates() { return []; } }
  install(Room);
  const wolf = player("w", "werewolf");
  const wise = player("q", "wise_wolf");
  const disguise = player("d", "disguiser_wolf");
  const lurking = player("l", "lurking_wolf");
  const fraud = player("f", "fraudster");
  const st = state([wolf, wise, disguise, lurking, fraud]);
  const room = new Room();
  assert.deepEqual(new Set(room.wolfTeammates(st, wolf).map((p) => p.id)), new Set(["q", "f"]));
  assert.deepEqual(new Set(room.wolfTeammates(st, wise).map((p) => p.id)), new Set(["w"]));
  assert.deepEqual(room.wolfTeammates(st, disguise), []);
  assert.deepEqual(room.wolfTeammates(st, lurking), []);
  st.roleMemory.l = { awake: true };
  assert.ok(room.wolfTeammates(st, wolf).some((p) => p.id === "l"));
  assert.ok(room.wolfTeammates(st, lurking).some((p) => p.id === "w"));
});

test("AI council skips a hidden wolf before returning a visible all-AI cohort", () => {
  class Room extends MemoryBase() {
    pendingAITask(st) {
      const used = new Set(st.roleMemory.__system?.coreWolfCouncilActors ?? []);
      const next = st.players.find((p) => p.alive && p.isAI && playerFaction(p) === "werewolf" && !used.has(p.id));
      return next ? { playerId: next.id, operation: "core_wolf_council" } : undefined;
    }
    wolfTeammates() { return []; }
  }
  install(Room);
  const ai = { isAI: true, ai: { provider: "openai", model: "x" } };
  const st = state([player("h", "disguiser_wolf", ai), player("a", "werewolf", ai), player("b", "werewolf", ai)]);
  const task = new Room().pendingAITask(st);
  assert.equal(task?.operation, "core_wolf_council");
  assert.ok(["a", "b"].includes(task?.playerId));
});

test("Cupid, Gambler and Guardian first-night actions do not reappear on round 2", () => {
  for (const [role, effect] of [["cupid", "link_lovers"], ["gambler", "choose_allegiance"], ["guardian", "set_permanent_guard"]]) {
    class Room extends MemoryBase() {
      constructor(st) { super(); this.current = st; }
      requireState() { return this.current; }
      projectState() { return { me: {}, roleAction: { effect } }; }
    }
    install(Room);
    const actor = player("a", role);
    const st = state([actor, player("v", "villager"), player("w", "werewolf")], "night", 2);
    assert.equal(new Room(st).projectState(st, actor.token).roleAction, undefined, role);
  }
});

test("revive invariant clears Betrayer death-only allegiance and reaction artifacts", () => {
  const betrayer = player("b", "betrayer", { alive: false, factionOverride: "werewolf" });
  const st = state([betrayer, player("w", "werewolf")]);
  st.deathReasons.b = "wolf";
  st.pendingReaction = { actorId: "b", effect: "death_shot", reason: "x", resumePhase: "debate" };
  st.roleMemory.b = { winningAllegiance: "werewolf", fakeDeath: true, reviveRound: 1, "announced:wolf": true };
  st.roleMemory.__system = { deathReactionQueue: ["b|death_shot|x|debate", "x|other"] };
  const room = new (MemoryBase())();
  revivePlayerInvariant(room, st, betrayer);
  assert.equal(betrayer.alive, true);
  assert.equal(betrayer.factionOverride, undefined);
  assert.equal(st.roleMemory.b.winningAllegiance, undefined);
  assert.equal(st.deathReasons.b, undefined);
  assert.equal(st.pendingReaction, undefined);
  assert.deepEqual(st.roleMemory.__system.deathReactionQueue, ["x|other"]);
});

test("Noble duplicate order entry remains a second formal speech slot", () => {
  const st = state([player("n", "noble"), player("t", "villager")], "debate");
  st.debateOrder = ["n", "t", "n"];
  st.debateCompleted = ["n", "t"];
  st.debateIndex = 3;
  normalizeDebateSlots(st);
  assert.equal(st.debateIndex, 2);
  st.debateCompleted.push("n");
  normalizeDebateSlots(st);
  assert.equal(st.debateIndex, 3);
});

test("Sun Wolf cannot assassinate before its own formal speech", () => {
  class Room extends MemoryBase() {
    constructor(st) { super(); this.current = st; }
    requireState() { return this.current; }
    submitRoleActionInternal() { this.submitted = true; }
  }
  install(Room);
  const sun = player("s", "sun_wolf");
  const victim = player("v", "villager");
  const st = state([sun, victim], "debate");
  const room = new Room(st);
  assert.throws(() => room.submitRoleActionInternal(st, sun, "day_assassinate", [victim.id]), /正式發言/);
  st.debateCompleted.push(sun.id);
  room.submitRoleActionInternal(st, sun, "day_assassinate", [victim.id]);
  assert.equal(room.submitted, true);
});

test("withdrawn Sheriff candidate loses incoming votes and cannot survive tally sanitation", () => {
  class Room extends MemoryBase() {
    constructor(st) { super(); this.current = st; }
    requireState() { return this.current; }
    setSheriffCandidate(_token, running) { if (!running) this.current.sheriff.candidates = this.current.sheriff.candidates.filter((id) => id !== "b"); }
    finishSheriffElection(st) { this.tallied = { ...st.sheriff.votes }; }
  }
  install(Room);
  const a = player("a", "villager"), b = player("b", "villager"), x = player("x", "villager");
  const st = state([a, b, x], "sheriff");
  st.sheriff.candidates = ["a", "b"];
  st.sheriff.votes = { a: "b", x: "b", b: "a" };
  const room = new Room(st);
  room.setSheriffCandidate(b.token, false);
  assert.deepEqual(st.sheriff.votes, { b: "a" });
  room.finishSheriffElection(st);
  assert.deepEqual(room.tallied, { b: "a" });
});

test("CP terminal logic recognizes canonical lover groups instead of legacy loverId pairs", () => {
  class Room extends MemoryBase() {
    endGame(st, winner) { st.winner = winner; }
    checkAndMaybeEnd() {}
  }
  install(Room);
  const a = player("a", "villager"), b = player("b", "werewolf");
  const st = state([a, b], "debate");
  st.roleMemory.a = { loverGroupId: "cp:x", loverGroupMembers: ["a", "b"] };
  st.roleMemory.b = { loverGroupId: "cp:x", loverGroupMembers: ["a", "b"] };
  const room = new Room();
  room.endGame(st, "village");
  assert.equal(st.winner, "neutral");
  assert.deepEqual(new Set(st.winnerPlayerIds), new Set(["a", "b"]));

  const a2 = player("a", "villager"), b2 = player("b", "werewolf"), c2 = player("c", "villager");
  const st2 = state([a2, b2, c2], "debate");
  st2.roleMemory.a = { loverGroupId: "cp:y", loverGroupMembers: ["a", "b"] };
  st2.roleMemory.b = { loverGroupId: "cp:y", loverGroupMembers: ["a", "b"] };
  room.endGame(st2, "village");
  assert.equal(st2.winner, undefined);
});
