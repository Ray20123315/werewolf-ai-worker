import test from "node:test";
import assert from "node:assert/strict";
import { coreWinner } from "../.test-build/core-state.js";
import { installRuntimeIntegrityRules, migrateRuntimeIntegrityState, normalizeDebateCursor, runtimeAbilityAvailable, RUNTIME_INACTIVE_ROLE_IDS } from "../.test-build/runtime-integrity.js";

function player(id, role, extra = {}) {
  return { id, token: `t-${id}`, name: id, nameKey: id, alive: true, isAI: false, isSpectator: false, role, joinedAt: 0, ...extra };
}

function state(players, phase = "night") {
  return {
    roomId: "ABC234", hostPlayerId: players[0]?.id || "a", phase, round: 2, players,
    roleSetup: Object.fromEntries(players.filter((p) => p.role).map((p) => [p.role, 1])),
    settings: { sheriffEnabled: false, deathInfo: "names", tieRule: "random_elimination", autoRoleSetup: false, winCondition: "slaughter_edge" },
    sheriff: { enabled: false, electionRound: 0, candidates: [], votes: {}, successors: [] },
    messages: [], votes: {}, nightActions: { wolfVotes: {}, seerTargets: {}, guardTargets: {}, witchActions: {}, roleActions: {} },
    roleMemory: {}, seerResults: {}, roleResults: {}, witchHealAvailable: true, witchPoisonAvailable: true, guardLastTargets: {},
    debateOrder: [], debateIndex: 0, debateCompleted: [], lastNightDeaths: [], deathReasons: {}, moderatorIds: [], initialPlayerCount: players.length, createdAt: 0, updatedAt: 0
  };
}

class FakeRoom {
  requireState() { return this.state; }
  projectState(state, token) {
    const me = state.players.find((p) => p.token === token);
    return { me: { id: me.id, role: me.role }, players: [], removedRoleIds: [], settings: state.settings };
  }
  playerByToken(state, token) { return state.players.find((p) => p.token === token); }
  mem(state, id) { state.roleMemory[id] ??= {}; return state.roleMemory[id]; }
  systemMem(state) { return this.mem(state, "__system"); }
  saveBroadcast() { this.saved = (this.saved || 0) + 1; }
  touchAndSave() {}
  broadcast() {}
  addSystemMessage(state, content) { state.messages.push({ id: String(state.messages.length), playerName: "系統", content, kind: "system", createdAt: 0, round: state.round, phase: state.phase }); }
  checkAndMaybeEnd() {}
  endGame(state, winner) { state.phase = "ended"; state.winner = winner; state.winnerPlayerIds ??= state.players.filter((p) => !p.isSpectator && !p.kickedAt && p.role === "red_axe_madman").map((p) => p.id); }
  beginDebate(state) { state.phase = "debate"; }
  enterNight(state, round) { state.phase = "night"; state.round = round; }
  enterVote(state) { state.phase = "vote"; }
  submitDebateSpeech() {}
  submitRoleActionInternal() { this.baseSubmissions = (this.baseSubmissions || 0) + 1; }
  afterNightSubmission() {}
  finishNight(state) { this.finishNightSeen = JSON.parse(JSON.stringify(state.nightActions)); }
  kickPlayerInternal(state, targetId) { const p = state.players.find((x) => x.id === targetId); if (p) { p.alive = false; p.isSpectator = true; p.kickedAt = 1; } }
  pendingAITask() { return undefined; }
  runAI() { return Promise.resolve({ ok: true }); }
  queueDeathReaction(state, actorId, reason, resumePhase) { state.pendingReaction = { actorId, effect: "death_shot", reason, resumePhase }; }
  killPlayer(state, id, reason, killerId, bypassProtection = false) {
    const target = state.players.find((p) => p.id === id && p.alive && !p.isSpectator);
    if (!target) return false;
    target.alive = false;
    state.deathReasons[id] = `${reason}:${killerId || ""}:${bypassProtection}`;
    if (target.role === "hunter") this.queueDeathReaction(state, target.id, reason, state.phase === "night" ? "debate" : "night");
    return true;
  }
  legalTargets(state, actor, mode) {
    const all = state.players.filter((p) => !p.isSpectator && !p.kickedAt);
    if (mode === "two_any") return all.filter((p) => p.id !== actor.id);
    return all.filter((p) => p.alive && p.id !== actor.id);
  }
  assertHost() {}
  assertFreshAITask() {}
}

installRuntimeIntegrityRules(FakeRoom);

test("debate cursor skips dead, kicked and spectator speakers instead of deadlocking", () => {
  const a = player("a", "villager");
  const b = player("b", "villager", { alive: false });
  const c = player("c", "villager", { kickedAt: 1, isSpectator: true, alive: false });
  const d = player("d", "villager");
  const s = state([a, b, c, d], "debate");
  s.debateOrder = ["b", "c", "d"];
  assert.equal(normalizeDebateCursor(s), true);
  assert.equal(s.debateIndex, 2);
  assert.deepEqual(s.debateCompleted, ["b", "c"]);
});

test("night kick re-evaluates completion rather than leaving the phase stalled", () => {
  const a = player("a", "villager");
  const b = player("b", "villager");
  const s = state([a, b], "night");
  const room = new FakeRoom(); room.state = s;
  let finished = 0;
  room.finishNight = () => { finished += 1; };
  room.kickPlayerInternal(s, "b", "admin");
  assert.equal(finished, 1);
});

test("mandatory death reaction blocks winner/phase transition until reaction is handled", () => {
  const hunter = player("h", "hunter");
  const target = player("t", "villager");
  const s = state([hunter, target], "debate");
  const room = new FakeRoom(); room.state = s;
  room.__runtimeReactionResumePhase = "debate";
  room.killPlayer(s, hunter.id, "sniper", target.id, true);
  room.checkAndMaybeEnd(s);
  room.beginDebate(s);
  assert.equal(s.phase, "reaction");
  assert.equal(s.pendingReaction?.actorId, hunter.id);
  assert.equal(s.pendingReaction?.resumePhase, "debate");
});

test("night disable pre-stage suppresses guard and witch before their special resolver paths", () => {
  const blocker = player("d", "dream_wolf");
  const guard = player("g", "guard");
  const witch = player("w", "witch");
  const target = player("t", "villager");
  const s = state([blocker, guard, witch, target], "night");
  s.nightActions.roleActions[blocker.id] = { effect: "disable_current_action", targetIds: [guard.id], submittedAt: 1 };
  s.nightActions.guardTargets[guard.id] = target.id;
  s.nightActions.witchActions[witch.id] = { type: "poison", targetId: target.id };
  const room = new FakeRoom(); room.state = s;
  room.finishNight(s);
  assert.equal(room.finishNightSeen.guardTargets[guard.id], undefined);
  assert.equal(room.finishNightSeen.witchActions[witch.id].type, "poison");

  s.nightActions.roleActions[blocker.id] = { effect: "disable_current_action", targetIds: [witch.id], submittedAt: 2 };
  s.nightActions.guardTargets[guard.id] = target.id;
  s.nightActions.witchActions[witch.id] = { type: "poison", targetId: target.id };
  room.finishNight(s);
  assert.equal(room.finishNightSeen.witchActions[witch.id].type, "pass");
});

test("Warlock nullify and first-stage Alchemist disable are applied before normal night effects", () => {
  const warlock = player("w", "warlock");
  const alchemist = player("a", "alchemist");
  const guard = player("g", "guard");
  const witch = player("x", "witch");
  const s = state([warlock, alchemist, guard, witch], "night");
  s.nightActions.roleActions[warlock.id] = { effect: "warlock_choice", targetIds: [guard.id], option: "nullify", submittedAt: 1 };
  s.nightActions.roleActions[alchemist.id] = { effect: "alchemist_sequence", targetIds: [witch.id], submittedAt: 1 };
  s.nightActions.guardTargets[guard.id] = witch.id;
  s.nightActions.witchActions[witch.id] = { type: "poison", targetId: guard.id };
  const room = new FakeRoom(); room.state = s;
  room.finishNight(s);
  assert.equal(room.finishNightSeen.guardTargets[guard.id], undefined);
  assert.equal(room.finishNightSeen.witchActions[witch.id].type, "pass");
  assert.equal(s.roleMemory.w.warlockNullifyUsed, true);
  assert.equal(s.roleMemory.a.alchemistStage, 1);
  assert.equal(room.finishNightSeen.roleActions.a, undefined);
});

test("Bee, Persuader and Red Axe expose actions only when their real preconditions hold", () => {
  const bee = player("b", "bee");
  const hive = player("h", "hive");
  let s = state([bee, hive], "night");
  assert.equal(runtimeAbilityAvailable(s, bee, "kill_if_hive_dead"), false);
  hive.alive = false;
  assert.equal(runtimeAbilityAvailable(s, bee, "kill_if_hive_dead"), true);

  const persuader = player("p", "persuader_wolf");
  const wolf = player("w", "werewolf");
  s = state([persuader, wolf], "night");
  assert.equal(runtimeAbilityAvailable(s, persuader, "convert_to_werewolf_if_last"), false);
  wolf.alive = false;
  assert.equal(runtimeAbilityAvailable(s, persuader, "convert_to_werewolf_if_last"), true);

  const axe = player("r", "red_axe_madman");
  s = state([axe, player("ww", "werewolf"), player("v", "villager")], "night");
  assert.equal(runtimeAbilityAvailable(s, axe, "kill_if_no_wolves"), false);
  s.players[1].alive = false;
  assert.equal(runtimeAbilityAvailable(s, axe, "kill_if_no_wolves"), true);
});

test("Red Axe prevents the base zero-wolf faction win until it is the last surviving role", () => {
  const axe = player("r", "red_axe_madman");
  const village = player("v", "villager");
  const s = state([axe, village], "night");
  assert.equal(coreWinner(s), undefined);
  village.alive = false;
  assert.equal(coreWinner(s), "neutral");
});

test("Magician one-dead/one-alive swap uses the death pipeline and revives the dead target", () => {
  const magician = player("m", "magician");
  const hunter = player("h", "hunter");
  const dead = player("d", "villager", { alive: false });
  const s = state([magician, hunter, dead], "night");
  s.deathReasons.d = "old";
  const room = new FakeRoom(); room.state = s;
  room.submitRoleActionInternal(s, magician, "magician_swap", [hunter.id, dead.id]);
  assert.equal(hunter.alive, false);
  assert.equal(dead.alive, true);
  assert.equal(s.deathReasons.d, undefined);
  assert.equal(s.pendingReaction?.actorId, hunter.id);
  assert.equal(s.phase, "reaction");
});

test("Magician follows Word semantics for daytime living targets and both-dead fallback", () => {
  const magician = player("m", "magician");
  const a = player("a", "seer");
  const b = player("b", "werewolf");
  let s = state([magician, a, b], "debate");
  s.votes = { a: "m", b: "a" };
  let room = new FakeRoom(); room.state = s;
  room.submitRoleActionInternal(s, magician, "magician_swap", [a.id, b.id]);
  assert.deepEqual(s.votes, { a: "a", b: "m" });
  assert.equal(a.role, "seer");
  assert.equal(b.role, "werewolf");

  const magician2 = player("m2", "magician");
  a.alive = false; b.alive = false;
  s = state([magician2, a, b], "night");
  room = new FakeRoom(); room.state = s;
  room.submitRoleActionInternal(s, magician2, "magician_swap", [a.id, b.id]);
  assert.equal(a.role, "werewolf");
  assert.equal(b.role, "seer");
});

test("Suicide Bomber accepts zero-to-two targets and wins when its blast leaves nobody alive", () => {
  const bomber = player("b", "suicide_bomber");
  const a = player("a", "villager");
  const c = player("c", "werewolf");
  const s = state([bomber, a, c], "debate");
  const room = new FakeRoom(); room.state = s;
  room.submitRoleActionInternal(s, bomber, "suicide_bomb", [a.id, c.id]);
  assert.equal(s.phase, "ended");
  assert.equal(s.winner, "neutral");
  assert.deepEqual(s.winnerPlayerIds, [bomber.id]);
  assert.match(s.winnerLabel, /自殺炸彈客/);
});

test("all-dead non-bomber state has an explicit draw terminal instead of hanging", () => {
  const a = player("a", "villager", { alive: false });
  const b = player("b", "werewolf", { alive: false });
  const s = state([a, b], "debate");
  const room = new FakeRoom(); room.state = s;
  room.checkAndMaybeEnd(s);
  assert.equal(s.phase, "ended");
  assert.equal(s.winner, undefined);
  assert.deepEqual(s.winnerPlayerIds, []);
  assert.match(s.winnerLabel, /平手/);
});

test("broken weighted-vote roles are removed from the active runtime until redesigned", () => {
  const p1 = player("a", "berserker_wolf");
  const p2 = player("b", "bomb_wolf");
  const p3 = player("c", "raven");
  const p4 = player("d", "discriminator");
  const s = state([p1, p2, p3, p4], "lobby");
  s.roleSetup = { berserker_wolf: 1, bomb_wolf: 1, raven: 1, discriminator: 1, werewolf: 1, villager: 3 };
  migrateRuntimeIntegrityState(s);
  assert.deepEqual(RUNTIME_INACTIVE_ROLE_IDS.sort(), ["berserker_wolf", "bomb_wolf", "discriminator", "raven"].sort());
  assert.deepEqual([p1.role, p2.role, p3.role, p4.role], ["werewolf", "werewolf", "villager", "villager"]);
  for (const id of RUNTIME_INACTIVE_ROLE_IDS) assert.equal(s.roleSetup[id], undefined);
});
