import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  installPost28FullRepairRules,
  normalizeDebateSlots,
  revivePlayerInvariant
} from "../.test-build/core-post28-repair.js";
import { installPost28FinalizeRules } from "../.test-build/core-post28-finalize.js";
import { playerFaction } from "../.test-build/game-engine.js";

function player(id, role, extra = {}) {
  return {
    id,
    token: `t-${id}`,
    name: id.toUpperCase(),
    nameKey: id,
    alive: true,
    isAI: false,
    isSpectator: false,
    role,
    joinedAt: 0,
    ...extra
  };
}

function state(players, phase = "night", round = 1) {
  return {
    roomId: "ABC234",
    hostPlayerId: players[0]?.id ?? "a",
    phase,
    round,
    players,
    roleSetup: {},
    settings: {
      sheriffEnabled: false,
      deathInfo: "names",
      tieRule: "random_elimination",
      autoRoleSetup: false,
      winCondition: "slaughter_edge",
      dayDurationSeconds: 120,
      nightDurationSeconds: 120
    },
    sheriff: { enabled: false, electionRound: 1, candidates: [], votes: {}, successors: [] },
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

function memoryBase(Base = class {}) {
  return class extends Base {
    mem(st, id) { st.roleMemory[id] ??= {}; return st.roleMemory[id]; }
    systemMem(st) { return this.mem(st, "__system"); }
    playerByToken(st, token) { const p = st.players.find((candidate) => candidate.token === token); if (!p) throw new Error("missing player"); return p; }
    saveBroadcast() { this.saved = (this.saved ?? 0) + 1; }
    touchAndSave() { this.touched = (this.touched ?? 0) + 1; }
    broadcast() {}
    addSystemMessage(st, content) { st.messages.push({ id: String(st.messages.length + 1), playerName: "系統", content, kind: "system", createdAt: 0, round: st.round, phase: st.phase }); }
    legalTargets(st, actor, mode) {
      const living = st.players.filter((candidate) => candidate.alive && !candidate.isSpectator && !candidate.kickedAt);
      if (mode === "none") return [];
      if (mode === "one_alive_any" || mode === "two_alive_any") return living;
      if (mode === "one_alive_non_wolf") return living.filter((candidate) => candidate.id !== actor.id && playerFaction(candidate) !== "werewolf");
      if (mode === "one_dead") return st.players.filter((candidate) => !candidate.alive && !candidate.isSpectator && !candidate.kickedAt);
      if (mode === "two_any") return st.players.filter((candidate) => candidate.id !== actor.id && !candidate.isSpectator && !candidate.kickedAt);
      return living.filter((candidate) => candidate.id !== actor.id);
    }
    storeRoleResult(st, actor, target, text) { st.roleResults[actor.id] ??= {}; st.roleResults[actor.id][`${actor.id}:${target.id}`] = text; }
  };
}

function install(Room) {
  installPost28FullRepairRules(Room);
  installPost28FinalizeRules(Room);
  return Room;
}

test("Spy/Gambler winning allegiance is separated from mechanical faction", () => {
  class Room extends memoryBase() {
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

test("wolf visibility honors hidden passives, Lurking wake-up, and Wise filtering", () => {
  class Room extends memoryBase() { wolfTeammates() { return []; } }
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

test("AI council skips hidden wolves and returns a safe visible AI wolf", () => {
  class Room extends memoryBase() {
    pendingAITask(st) {
      const used = new Set(st.roleMemory.__system?.coreWolfCouncilActors ?? []);
      const next = st.players.find((p) => p.alive && p.isAI && playerFaction(p) === "werewolf" && !used.has(p.id));
      return next ? { playerId: next.id, operation: "core_wolf_council" } : undefined;
    }
    wolfTeammates() { return []; }
  }
  install(Room);
  const ai = { isAI: true, ai: { provider: "openai", model: "x" } };
  const hidden = player("h", "disguiser_wolf", ai);
  const a = player("a", "werewolf", ai);
  const b = player("b", "werewolf", ai);
  const st = state([hidden, a, b]);
  const room = new Room();
  const task = room.pendingAITask(st);
  assert.equal(task?.operation, "core_wolf_council");
  assert.notEqual(task?.playerId, "h");
  assert.ok(["a", "b"].includes(task?.playerId));
});

test("first-night-only Cupid/Gambler/Guardian actions disappear after round 1", () => {
  for (const [role, effect] of [["cupid", "link_lovers"], ["gambler", "choose_allegiance"], ["guardian", "set_permanent_guard"]]) {
    class Room extends memoryBase() {
      constructor(st) { super(); this.current = st; }
      requireState() { return this.current; }
      projectState(_st, _token) { return { me: {}, roleAction: { effect } }; }
    }
    install(Room);
    const actor = player("a", role);
    const st = state([actor, player("v", "villager"), player("w", "werewolf")], "night", 2);
    const view = new Room(st).projectState(st, actor.token);
    assert.equal(view.roleAction, undefined, role);
  }
});

test("revive invariant clears Betrayer death-only allegiance and death artifacts", () => {
  const betrayer = player("b", "betrayer", { alive: false, factionOverride: "werewolf" });
  const st = state([betrayer, player("w", "werewolf")]);
  st.deathReasons.b = "wolf";
  st.pendingReaction = { actorId: "b", effect: "death_shot", reason: "x", resumePhase: "debate" };
  st.roleMemory.b = { winningAllegiance: "werewolf", fakeDeath: true, reviveRound: 1, "announced:wolf": true };
  st.roleMemory.__system = { deathReactionQueue: ["b|death_shot|x|debate", "x|other"] };
  const room = new (memoryBase())();
  revivePlayerInvariant(room, st, betrayer);
  assert.equal(betrayer.alive, true);
  assert.equal(betrayer.factionOverride, undefined);
  assert.equal(st.roleMemory.b.winningAllegiance, undefined);
  assert.equal(st.deathReasons.b, undefined);
  assert.equal(st.pendingReaction, undefined);
  assert.deepEqual(st.roleMemory.__system.deathReactionQueue, ["x|other"]);
});

test("Noble duplicate debate slot remains an actual second speaking opportunity", () => {
  const noble = player("n", "noble");
  const target = player("t", "villager");
  const st = state([noble, target], "debate");
  st.debateOrder = ["n", "t", "n"];
  st.debateCompleted = ["n", "t"];
  st.debateIndex = 3;
  normalizeDebateSlots(st);
  assert.equal(st.debateIndex, 2);
  st.debateCompleted.push("n");
  normalizeDebateSlots(st);
  assert.equal(st.debateIndex, 3);
});

test("Sun Wolf human assassinate is gated until its formal speech", () => {
  class Room extends memoryBase() {
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

test("Angel dawn death queues without cancelling the target's remaining night", () => {
  class Room extends memoryBase() {
    resolveNightRoleAction() { this.baseResolved = true; }
    applyEndOfNightStatuses() { this.statusApplied = true; }
    killPlayer(st, id) { const p = st.players.find((x) => x.id === id && x.alive); if (!p) return false; p.alive = false; st.deathReasons[id] = "killed"; return true; }
  }
  install(Room);
  const angel = player("a", "angel");
  const wolf = player("w", "werewolf");
  const st = state([angel, wolf], "night", 2);
  const room = new Room();
  room.resolveNightRoleAction(st, angel, { effect: "angel_check", targetIds: [wolf.id], submittedAt: 1 });
  assert.equal(wolf.alive, true);
  room.applyEndOfNightStatuses(st);
  assert.equal(wolf.alive, false);
});

test("Mermaid redirect and Confusing Wolf mark expire before the next night", () => {
  class Room extends memoryBase() {
    resolveNightRoleAction() {}
    enterNight(st, round) { st.phase = "night"; st.round = round; }
  }
  install(Room);
  const mermaid = player("m", "mermaid");
  const confusing = player("c", "confusing_wolf");
  const victim = player("v", "villager");
  const st = state([mermaid, confusing, victim], "night", 1);
  const room = new Room();
  room.resolveNightRoleAction(st, mermaid, { effect: "redirect_wolf_kill", targetIds: [victim.id], submittedAt: 1 });
  room.resolveNightRoleAction(st, confusing, { effect: "mark_convert_on_death", targetIds: [victim.id], submittedAt: 2 });
  assert.equal(st.roleMemory.__system.redirectWolfKillRound, 1);
  assert.equal(st.roleMemory.c.convertOnDeathRound, 1);
  room.enterNight(st, 2);
  assert.equal(st.roleMemory.__system.redirectWolfKill, undefined);
  assert.equal(st.roleMemory.c.convertOnDeath, undefined);
});

test("withdrawn Sheriff candidate loses all incoming votes before tally", () => {
  class Room extends memoryBase() {
    constructor(st) { super(); this.current = st; }
    requireState() { return this.current; }
    setSheriffCandidate(_token, running) { if (!running) this.current.sheriff.candidates = this.current.sheriff.candidates.filter((id) => id !== "b"); }
    finishSheriffElection(st) { this.tallied = { ...st.sheriff.votes }; }
  }
  install(Room);
  const a = player("a", "villager");
  const b = player("b", "villager");
  const x = player("x", "villager");
  const st = state([a, b, x], "sheriff");
  st.sheriff.candidates = ["a", "b"];
  st.sheriff.votes = { a: "b", x: "b", b: "a" };
  const room = new Room(st);
  room.setSheriffCandidate(b.token, false);
  assert.deepEqual(st.sheriff.votes, { b: "a" });
  room.finishSheriffElection(st);
  assert.deepEqual(room.tallied, { b: "a" });
});

test("redirected Guard target is revalidated against no-consecutive-guard rule", () => {
  class Room extends memoryBase() {
    finishNight(st) { this.guardAtResolution = { ...st.nightActions.guardTargets }; }
    resolveNightRoleAction() {}
    killPlayer() { return true; }
  }
  install(Room);
  const guard = player("g", "guard");
  const wind = player("w", "wind_wolf");
  const other = player("v", "villager");
  const st = state([guard, wind, other]);
  st.guardLastTargets.g = wind.id;
  st.nightActions.guardTargets.g = other.id;
  st.nightActions.roleActions.w = { effect: "redirect_targeted_action", targetIds: [guard.id], submittedAt: 1 };
  const room = new Room();
  room.finishNight(st);
  assert.equal(room.guardAtResolution.g, undefined);
});

test("effective action observation includes Seer/Guard/Witch targets and Shadow uses effective targets", () => {
  class Room extends memoryBase() {
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
  const detective = player("d", "detective");
  const seer = player("s", "seer");
  const guard = player("g", "guard");
  const witch = player("h", "witch");
  const shadow = player("x", "shadow_wolf");
  const victim = player("v", "villager");
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

test("Hacker reroll never creates removed or addon-only roles", () => {
  class Room extends memoryBase() { resolveNightRoleAction() {} }
  install(Room);
  const hacker = player("h", "hacker");
  const target = player("v", "villager");
  const st = state([hacker, target, player("w", "werewolf")]);
  const room = new Room();
  const forbidden = new Set(["confirmed_villager", "mimic_wolf", "diviner", "masochist_cultist", "sadist_leader"]);
  for (let i = 0; i < 40; i += 1) {
    target.role = "villager";
    room.resolveNightRoleAction(st, hacker, { effect: "reroll_same_faction_role", targetIds: [target.id], submittedAt: i + 1 });
    assert.equal(forbidden.has(target.role), false, target.role);
  }
});

test("Apprentice Seer and last Fist Brother transition immediately on a real death", () => {
  class Room extends memoryBase() {
    killPlayer(st, id) { const p = st.players.find((x) => x.id === id && x.alive); if (!p) return false; p.alive = false; return true; }
  }
  install(Room);
  const seer = player("s", "seer");
  const apprentice = player("a", "apprentice_seer");
  const f1 = player("f1", "fist_brother");
  const f2 = player("f2", "fist_brother");
  const st = state([seer, apprentice, f1, f2, player("w", "werewolf")]);
  const room = new Room();
  room.killPlayer(st, seer.id, "exile");
  assert.equal(apprentice.role, "seer");
  room.killPlayer(st, f1.id, "exile");
  assert.equal(f2.role, "coward");
});

test("Vomit Wolf requires a stack and invalidates exactly one next ordinary vote", () => {
  class Room extends memoryBase() {
    constructor(st) { super(); this.current = st; }
    requireState() { return this.current; }
    submitRoleActionInternal() { this.submitted = true; }
    castVoteById(_st, _voterId, targetId) { this.lastVoteTarget = targetId; }
  }
  install(Room);
  const vomit = player("z", "vomit_wolf");
  const voter = player("v", "villager");
  const other = player("o", "villager");
  const st = state([vomit, voter, other], "night");
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

test("next-action block is consumed once by a legal night skill", () => {
  class Room extends memoryBase() {
    finishNight(st) { this.actionsAtBase = structuredClone(st.nightActions.roleActions); }
    resolveNightRoleAction() {}
    killPlayer() { return true; }
  }
  install(Room);
  const blocked = player("s", "seer");
  const target = player("v", "villager");
  const st = state([blocked, target, player("w", "werewolf")]);
  st.roleMemory.s = { nextActionDisabledCount: 1 };
  st.nightActions.seerTargets.s = target.id;
  const room = new Room();
  room.finishNight(st);
  assert.equal(st.nightActions.seerTargets.s, undefined);
  assert.equal(st.roleMemory.s.nextActionDisabledCount, 0);
});

test("Vampire Wolf copied night ability remains pending until submitted and source death clears it", () => {
  class Room extends memoryBase() {
    constructor(st) { super(); this.current = st; }
    requireState() { return this.current; }
    finishNight() { this.finished = (this.finished ?? 0) + 1; }
    resolveNightRoleAction() {}
    submitRoleActionInternal(_st, _actor, effect, targetIds) { this.baseSubmit = { effect, targetIds }; }
    projectState() { return { me: {}, roleAction: undefined }; }
    killPlayer(st, id) { const p = st.players.find((x) => x.id === id && x.alive); if (!p) return false; p.alive = false; return true; }
  }
  install(Room);
  const vampire = player("x", "vampire_wolf_copy");
  const seer = player("s", "seer");
  const victim = player("v", "villager");
  const st = state([vampire, seer, victim, player("w", "werewolf")]);
  st.roleMemory.x = { "used:copy_ability_and_block": true, copiedRole: "seer", copiedSourceId: seer.id };
  const room = new Room(st);
  const view = room.projectState(st, vampire.token);
  assert.equal(view.roleAction.effect, "inspect_team");
  room.finishNight(st);
  assert.equal(room.finished, undefined);
  assert.equal(room.saved, 1);
  room.submitRoleActionInternal(st, vampire, "inspect_team", [victim.id]);
  assert.equal(st.nightActions.roleActions.x.effect, "inspect_team");
  room.finishNight(st);
  assert.equal(room.finished, 1);
  room.killPlayer(st, seer.id, "exile");
  room.requireState();
  assert.equal(st.roleMemory.x.copiedRole, undefined);
});

test("AI Elder strong_kill is normalized to immediate-dawn effect and cancels other night actions", () => {
  class Room extends memoryBase() {
    submitRoleActionInternal(_st, _actor, effect, targetIds) { this.baseSubmit = { effect, targetIds }; }
    finishNight(st) { this.baseNight = structuredClone(st.nightActions); }
    resolveNightRoleAction() {}
    killPlayer(st, id) { const p = st.players.find((x) => x.id === id && x.alive); if (!p) return false; p.alive = false; return true; }
  }
  install(Room);
  const elder = player("e", "elder_wolf");
  const victim = player("v", "villager");
  const other = player("o", "seer");
  const st = state([elder, victim, other], "night", 2);
  const room = new Room();
  room.submitRoleActionInternal(st, elder, "strong_kill", [victim.id]);
  assert.equal(st.nightActions.roleActions.e.effect, "elder_force_dawn");
  st.nightActions.seerTargets.o = elder.id;
  room.finishNight(st);
  assert.equal(victim.alive, false);
  assert.deepEqual(room.baseNight.seerTargets, {});
  assert.deepEqual(room.baseNight.roleActions, {});
});

test("CP terminal semantics use canonical loverGroup memory", () => {
  class Room extends memoryBase() {
    endGame(st, winner) { st.winner = winner; this.ended = winner; }
    checkAndMaybeEnd() {}
  }
  install(Room);
  const a = player("a", "villager");
  const b = player("b", "werewolf");
  const st = state([a, b], "debate");
  st.roleMemory.a = { loverGroupId: "cp:x", loverGroupMembers: ["a", "b"] };
  st.roleMemory.b = { loverGroupId: "cp:x", loverGroupMembers: ["a", "b"] };
  const room = new Room();
  room.endGame(st, "village");
  assert.equal(st.winner, "neutral");
  assert.deepEqual(new Set(st.winnerPlayerIds), new Set(["a", "b"]));

  const c = player("c", "villager");
  const st2 = state([a = player("a", "villager"), b = player("b", "werewolf"), c], "debate");
  st2.roleMemory.a = { loverGroupId: "cp:y", loverGroupMembers: ["a", "b"] };
  st2.roleMemory.b = { loverGroupId: "cp:y", loverGroupMembers: ["a", "b"] };
  room.endGame(st2, "village");
  assert.equal(st2.winner, undefined);
});

test("admin snapshot exposes omniscient roles only after game start", async () => {
  class Room extends memoryBase() {
    constructor(st) { super(); this.current = st; }
    requireState() { return this.current; }
    async adminSnapshot() { return { phase: this.current.phase, players: this.current.players.map((p) => ({ id: p.id, name: p.name, alive: p.alive })) }; }
  }
  install(Room);
  const spy = player("s", "spy");
  const st = state([spy, player("w", "werewolf")], "night");
  st.roleMemory.s = { winningAllegiance: "village" };
  const room = new Room(st);
  const snap = await room.adminSnapshot();
  assert.equal(snap.players[0].role, "spy");
  assert.equal(snap.players[0].mechanicalFaction, "neutral");
  assert.equal(snap.players[0].winningAllegiance, "village");
  st.phase = "lobby";
  const lobby = await room.adminSnapshot();
  assert.equal(lobby.players[0].role, undefined);
});

test("manual and alarm-driven disband delete room storage and unregister directory", async () => {
  class Room extends memoryBase() {
    constructor(st) {
      super(); this.current = st; this.deleted = 0; this.unregistered = [];
      this.ctx = { storage: { deleteAll: async () => { this.deleted += 1; }, setAlarm() {} }, getWebSockets: () => [] };
      this.env = { ROOM_DIRECTORY: { getByName: () => ({ unregisterRoom: async (id) => this.unregistered.push(id) }) } };
    }
    requireState() { return this.current; }
    async adminKick() { this.baseKick = true; }
    async alarm() { this.baseAlarm = true; }
  }
  install(Room);
  const st = state([player("a", "villager")]);
  const room = new Room(st);
  await room.adminKick("__disband_room__");
  assert.equal(room.deleted, 1);
  assert.deepEqual(room.unregistered, [st.roomId]);

  const st2 = state([player("a", "villager")]);
  st2.roleMemory.__system = { roomEmptyDisposeAt: Date.now() - 1 };
  const room2 = new Room(st2);
  await room2.alarm();
  assert.equal(room2.deleted, 1);
  assert.deepEqual(room2.unregistered, [st2.roomId]);
  assert.equal(room2.baseAlarm, undefined);
});

test("admin UI repair wires page scrolling, omniscient details and disband control", () => {
  const css = fs.readFileSync("public/admin-toolkit.css", "utf8");
  const js = fs.readFileSync("public/admin-full-repair.js", "utf8");
  const html = fs.readFileSync("public/admin.html", "utf8");
  const directory = fs.readFileSync("src/room-directory.ts", "utf8");
  assert.match(css, /overflow-y:\s*auto\s*!important/);
  assert.match(css, /\.admin-shell, \.admin-dashboard[\s\S]*overflow:\s*visible\s*!important/);
  assert.match(js, /__disband_room__/);
  assert.match(js, /mechanicalFaction/);
  assert.match(js, /winningAllegiance/);
  assert.match(html, /admin-full-repair\.js/);
  assert.match(directory, /async unregisterRoom\(roomId: string\)/);
  assert.match(directory, /DELETE FROM rooms WHERE room_id = \?/);
});

test("source guards cover full post-PR28 state-lifetime repair owners", () => {
  const source = fs.readFileSync("src/core-post28-repair.ts", "utf8");
  assert.match(source, /redirectWolfKillRound/);
  assert.match(source, /winningAllegiance/);
  assert.match(source, /hidden_from_wolf_list/);
  assert.match(source, /FIRST_NIGHT_ONLY/);
  assert.match(source, /dawnDeathQueue/);
  assert.match(source, /convertOnDeathRound/);
  assert.match(source, /nextActionDisabledCount/);
  assert.match(source, /nextActionOrVoteDisabledCount/);
  assert.match(source, /activeCoreRoleDefinitions\(\)/);
  assert.match(source, /copiedSourceId/);
  assert.match(source, /loverGroupMembers/);
});
