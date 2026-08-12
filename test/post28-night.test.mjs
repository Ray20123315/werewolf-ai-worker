import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { installPost28FullRepairRules } from "../.test-build/core-post28-repair.js";
import { installPost28FinalizeRules } from "../.test-build/core-post28-finalize.js";
import { playerFaction } from "../.test-build/game-engine.js";

function player(id, role, extra = {}) {
  return { id, token: `t-${id}`, name: id.toUpperCase(), nameKey: id, alive: true, isAI: false, isSpectator: false, role, joinedAt: 0, ...extra };
}
function state(players, phase = "night", round = 1) {
  return {
    roomId: "ABC234", hostPlayerId: players[0]?.id ?? "a", phase, round, players, roleSetup: {},
    settings: { sheriffEnabled: false, deathInfo: "names", tieRule: "random_elimination", autoRoleSetup: false, winCondition: "slaughter_edge", dayDurationSeconds: 120, nightDurationSeconds: 120 },
    sheriff: { enabled: false, electionRound: 1, candidates: [], votes: {}, successors: [] }, messages: [], votes: {},
    nightActions: { wolfVotes: {}, seerTargets: {}, guardTargets: {}, witchActions: {}, roleActions: {} }, roleMemory: {}, seerResults: {}, roleResults: {},
    witchHealAvailable: true, witchPoisonAvailable: true, guardLastTargets: {}, debateOrder: [], debateIndex: 0, debateCompleted: [], lastNightDeaths: [], deathReasons: {},
    moderatorIds: [], initialPlayerCount: players.length, createdAt: 0, updatedAt: 0
  };
}
function Base(BaseClass = class {}) {
  return class extends BaseClass {
    mem(st, id) { st.roleMemory[id] ??= {}; return st.roleMemory[id]; }
    systemMem(st) { return this.mem(st, "__system"); }
    saveBroadcast() { this.saved = (this.saved ?? 0) + 1; }
    touchAndSave() {}
    broadcast() {}
    addSystemMessage() {}
    playerByToken(st, token) { return st.players.find((p) => p.token === token); }
    legalTargets(st, actor, mode) {
      const living = st.players.filter((p) => p.alive && !p.isSpectator && !p.kickedAt);
      if (mode === "none") return [];
      if (mode === "one_alive_any" || mode === "two_alive_any") return living;
      if (mode === "one_alive_non_wolf") return living.filter((p) => p.id !== actor.id && playerFaction(p) !== "werewolf");
      if (mode === "one_dead") return st.players.filter((p) => !p.alive && !p.isSpectator && !p.kickedAt);
      if (mode === "two_any") return st.players.filter((p) => p.id !== actor.id && !p.isSpectator && !p.kickedAt);
      return living.filter((p) => p.id !== actor.id);
    }
    storeRoleResult(st, actor, target, text) { st.roleResults[actor.id] ??= {}; st.roleResults[actor.id][`${actor.id}:${target.id}`] = text; }
  };
}
function install(Room) { installPost28FullRepairRules(Room); installPost28FinalizeRules(Room); return Room; }

test("Angel/Devil kills are deferred until dawn status resolution", () => {
  class Room extends Base() {
    resolveNightRoleAction() {}
    applyEndOfNightStatuses() { this.baseStatuses = true; }
    killPlayer(st, id) { const p = st.players.find((x) => x.id === id && x.alive); if (!p) return false; p.alive = false; st.deathReasons[id] = "killed"; return true; }
  }
  install(Room);
  const angel = player("a", "angel"), wolf = player("w", "werewolf");
  const devil = player("d", "devil"), angel2 = player("z", "angel");
  const st = state([angel, wolf, devil, angel2], "night", 2);
  const room = new Room();
  room.resolveNightRoleAction(st, angel, { effect: "angel_check", targetIds: [wolf.id], submittedAt: 1 });
  room.resolveNightRoleAction(st, devil, { effect: "devil_check", targetIds: [angel2.id], submittedAt: 2 });
  assert.equal(wolf.alive, true);
  assert.equal(angel2.alive, true);
  room.applyEndOfNightStatuses(st);
  assert.equal(wolf.alive, false);
  assert.equal(angel2.alive, false);
});

test("Mermaid redirect and Confusing mark have round-scoped lifetime", () => {
  class Room extends Base() {
    resolveNightRoleAction() {}
    enterNight(st, round) { st.phase = "night"; st.round = round; }
  }
  install(Room);
  const mermaid = player("m", "mermaid"), confusing = player("c", "confusing_wolf"), victim = player("v", "villager");
  const st = state([mermaid, confusing, victim]);
  const room = new Room();
  room.resolveNightRoleAction(st, mermaid, { effect: "redirect_wolf_kill", targetIds: [victim.id], submittedAt: 1 });
  room.resolveNightRoleAction(st, confusing, { effect: "mark_convert_on_death", targetIds: [victim.id], submittedAt: 2 });
  assert.equal(st.roleMemory.__system.redirectWolfKillRound, 1);
  assert.equal(st.roleMemory.c.convertOnDeathRound, 1);
  room.enterNight(st, 2);
  assert.equal(st.roleMemory.__system.redirectWolfKill, undefined);
  assert.equal(st.roleMemory.c.convertOnDeath, undefined);
});

test("redirected Guard target is revalidated against original target legality", () => {
  class Room extends Base() {
    finishNight(st) { this.guardAtBase = { ...st.nightActions.guardTargets }; }
    resolveNightRoleAction() {}
    killPlayer() { return true; }
  }
  install(Room);
  const guard = player("g", "guard"), wind = player("w", "wind_wolf"), other = player("v", "villager");
  const st = state([guard, wind, other]);
  st.guardLastTargets.g = wind.id;
  st.nightActions.guardTargets.g = other.id;
  st.nightActions.roleActions.w = { effect: "redirect_targeted_action", targetIds: [guard.id], submittedAt: 1 };
  const room = new Room();
  room.finishNight(st);
  assert.equal(room.guardAtBase.g, undefined);
});

test("effective action snapshot exposes core action targets and drives Shadow Wolf", () => {
  class Room extends Base() {
    finishNight(st) {
      for (const [id, action] of Object.entries(st.nightActions.roleActions)) {
        const actor = st.players.find((p) => p.id === id);
        if (actor) this.resolveNightRoleAction(st, actor, action);
      }
    }
    resolveNightRoleAction() {}
    killPlayer(st, id) { const p = st.players.find((x) => x.id === id && x.alive); if (!p) return false; p.alive = false; return true; }
  }
  install(Room);
  const detective = player("d", "detective"), seer = player("s", "seer"), guard = player("g", "guard"), witch = player("h", "witch");
  const shadow = player("x", "shadow_wolf"), victim = player("v", "villager");
  const st = state([detective, seer, guard, witch, shadow, victim]);
  st.nightActions.seerTargets.s = victim.id;
  st.nightActions.guardTargets.g = victim.id;
  st.nightActions.witchActions.h = { type: "poison", targetId: victim.id };
  st.nightActions.roleActions.d = { effect: "inspect_action", targetIds: [seer.id], submittedAt: 10 };
  st.nightActions.roleActions.x = { effect: "kill_if_targeted_by_other", targetIds: [victim.id], submittedAt: 20 };
  const room = new Room();
  room.finishNight(st);
  assert.match(st.roleResults.d["d:s"], /inspect_team/);
  assert.match(st.roleResults.d["d:s"], /V/);
  assert.equal(victim.alive, false);
});

test("Hacker reroll stays inside canonical active non-addon role pool", () => {
  class Room extends Base() { resolveNightRoleAction() {} }
  install(Room);
  const hacker = player("h", "hacker"), target = player("v", "villager"), wolf = player("w", "werewolf");
  const st = state([hacker, target, wolf]);
  const room = new Room();
  const forbidden = new Set(["confirmed_villager", "mimic_wolf", "diviner", "masochist_cultist", "sadist_leader"]);
  for (let i = 0; i < 30; i += 1) {
    target.role = "villager";
    room.resolveNightRoleAction(st, hacker, { effect: "reroll_same_faction_role", targetIds: [target.id], submittedAt: i + 1 });
    assert.equal(forbidden.has(target.role), false, target.role);
  }
});

test("Apprentice Seer and last Fist Brother transition on death reconciliation", () => {
  class Room extends Base() {
    killPlayer(st, id) { const p = st.players.find((x) => x.id === id && x.alive); if (!p) return false; p.alive = false; return true; }
  }
  install(Room);
  const seer = player("s", "seer"), apprentice = player("a", "apprentice_seer"), f1 = player("f1", "fist_brother"), f2 = player("f2", "fist_brother");
  const st = state([seer, apprentice, f1, f2, player("w", "werewolf")]);
  const room = new Room();
  room.killPlayer(st, seer.id, "exile");
  assert.equal(apprentice.role, "seer");
  room.killPlayer(st, f1.id, "exile");
  assert.equal(f2.role, "coward");
});

test("Vomit requires stacks and its next vote-or-skill block is consumed exactly once", () => {
  class Room extends Base() {
    constructor(st) { super(); this.current = st; }
    requireState() { return this.current; }
    submitRoleActionInternal() { this.submitted = true; }
    castVoteById(_st, _id, targetId) { this.lastVoteTarget = targetId; }
  }
  install(Room);
  const vomit = player("z", "vomit_wolf"), voter = player("v", "villager"), other = player("o", "villager");
  const st = state([vomit, voter, other]);
  const room = new Room(st);
  assert.throws(() => room.submitRoleActionInternal(st, vomit, "spend_stacks_to_disable", [voter.id]), /沒有可消耗層數/);
  st.roleMemory.v = { nextActionOrVoteDisabledCount: 1 };
  st.phase = "vote";
  room.castVoteById(st, voter.id, other.id);
  assert.equal(room.lastVoteTarget, "__abstain__");
  assert.equal(st.roleMemory.v.nextActionOrVoteDisabledCount, 0);
  room.castVoteById(st, voter.id, other.id);
  assert.equal(room.lastVoteTarget, other.id);
});

test("next-action-only blocker is consumed once by core Seer action", () => {
  class Room extends Base() {
    finishNight() { this.baseFinished = true; }
    resolveNightRoleAction() {}
    killPlayer() { return true; }
  }
  install(Room);
  const seer = player("s", "seer"), target = player("v", "villager"), wolf = player("w", "werewolf");
  const st = state([seer, target, wolf]);
  st.roleMemory.s = { nextActionDisabledCount: 1 };
  st.nightActions.seerTargets.s = target.id;
  const room = new Room();
  room.finishNight(st);
  assert.equal(st.nightActions.seerTargets.s, undefined);
  assert.equal(st.roleMemory.s.nextActionDisabledCount, 0);
});

test("Vampire Wolf copied ability blocks night completion until submitted and expires with source", () => {
  class Room extends Base() {
    constructor(st) { super(); this.current = st; }
    requireState() { return this.current; }
    finishNight() { this.baseFinish = (this.baseFinish ?? 0) + 1; }
    resolveNightRoleAction() {}
    submitRoleActionInternal() { this.baseSubmit = true; }
    projectState() { return { me: {}, roleAction: undefined }; }
    killPlayer(st, id) { const p = st.players.find((x) => x.id === id && x.alive); if (!p) return false; p.alive = false; return true; }
  }
  install(Room);
  const vampire = player("x", "vampire_wolf_copy"), seer = player("s", "seer"), victim = player("v", "villager"), wolf = player("w", "werewolf");
  const st = state([vampire, seer, victim, wolf]);
  st.roleMemory.x = { "used:copy_ability_and_block": true, copiedRole: "seer", copiedSourceId: seer.id };
  const room = new Room(st);
  assert.equal(room.projectState(st, vampire.token).roleAction.effect, "inspect_team");
  room.finishNight(st);
  assert.equal(room.baseFinish, undefined);
  assert.equal(room.saved, 1);
  room.submitRoleActionInternal(st, vampire, "inspect_team", [victim.id]);
  assert.equal(st.nightActions.roleActions.x.effect, "inspect_team");
  room.finishNight(st);
  assert.equal(room.baseFinish, 1);
  room.killPlayer(st, seer.id, "exile");
  room.requireState();
  assert.equal(st.roleMemory.x.copiedRole, undefined);
});

test("AI Elder strong_kill normalizes to immediate dawn and cancels remaining night submissions", () => {
  class Room extends Base() {
    submitRoleActionInternal() { this.baseSubmit = true; }
    finishNight(st) { this.baseNight = structuredClone(st.nightActions); }
    resolveNightRoleAction() {}
    killPlayer(st, id) { const p = st.players.find((x) => x.id === id && x.alive); if (!p) return false; p.alive = false; return true; }
  }
  install(Room);
  const elder = player("e", "elder_wolf"), victim = player("v", "villager"), seer = player("s", "seer");
  const st = state([elder, victim, seer], "night", 2);
  const room = new Room();
  room.submitRoleActionInternal(st, elder, "strong_kill", [victim.id]);
  assert.equal(st.nightActions.roleActions.e.effect, "elder_force_dawn");
  st.nightActions.seerTargets.s = elder.id;
  room.finishNight(st);
  assert.equal(victim.alive, false);
  assert.deepEqual(room.baseNight.seerTargets, {});
  assert.deepEqual(room.baseNight.roleActions, {});
});

test("source owners contain the remaining state-lifetime primitives", () => {
  const source = fs.readFileSync("src/core-post28-repair.ts", "utf8");
  assert.match(source, /redirectWolfKillRound/);
  assert.match(source, /convertOnDeathRound/);
  assert.match(source, /dawnDeathQueue/);
  assert.match(source, /nextActionDisabledCount/);
  assert.match(source, /nextActionOrVoteDisabledCount/);
  assert.match(source, /activeCoreRoleDefinitions\(\)/);
  assert.match(source, /copiedSourceId/);
});
