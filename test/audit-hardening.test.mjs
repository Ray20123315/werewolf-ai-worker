import test from "node:test";
import assert from "node:assert/strict";
import {
  installCoreAuditHardeningRules,
  normalizeRelationshipDeathReason,
  preStageNightInvariants,
  reconcileReaction
} from "../.test-build/core-audit-hardening.js";
import { ABSTAIN_TARGET, createVoteSnapshot, installEqualVoteRules } from "../.test-build/equal-vote.js";

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
    hostPlayerId: players[0]?.id ?? "a",
    phase,
    round: 1,
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

function memoryMethods(Base = class {}) {
  return class extends Base {
    mem(st, id) { st.roleMemory[id] ??= {}; return st.roleMemory[id]; }
    systemMem(st) { return this.mem(st, "__system"); }
    addSystemMessage(st, content) {
      st.messages.push({ id: String(st.messages.length + 1), playerName: "系統", content, kind: "system", createdAt: 0, round: st.round, phase: st.phase });
    }
  };
}

test("Masochist addon ordinary ballot is invalid even when the base role is Villager", () => {
  const m = player("m", "villager", { addonRoles: ["masochist_cultist"] });
  const w = player("w", "werewolf");
  const v = player("v", "villager");
  const st = state([m, w, v], "vote");
  st.votes = { m: "w", w: "v", v: "w" };
  const snapshot = createVoteSnapshot(st);
  assert.equal(snapshot.entries.find((entry) => entry.voterId === "m")?.status, "invalid");
  assert.equal(snapshot.counts.w, 1);
  assert.equal(snapshot.counts.v, 1);
});

test("Berserker abstain and rejected self-vote never consume rage", () => {
  class VoteRoom extends memoryMethods() {
    saveBroadcast() {}
    finishVote() { this.finished = true; }
  }
  installEqualVoteRules(VoteRoom);
  const berserker = player("z", "berserker_wolf");
  const target = player("t", "villager");
  const st = state([berserker, target], "vote");
  st.roleMemory.z = { ravenInvalidVoteRound: 1, voteBonus: 1 };
  const room = new VoteRoom();

  room.castVoteById(st, "z", ABSTAIN_TARGET);
  assert.equal(st.roleMemory.z.voteBonus, 1);
  assert.equal(st.roleMemory.z.berserkerVoteShieldRound, undefined);

  delete st.votes.z;
  assert.throws(() => room.castVoteById(st, "z", "z"), /不能投給自己/);
  assert.equal(st.roleMemory.z.voteBonus, 1);
  assert.equal(st.roleMemory.z.berserkerVoteShieldRound, undefined);
});

test("relationship group cascade is normalized to the canonical lover death kind", () => {
  assert.equal(normalizeRelationshipDeathReason("lover_group"), "lover");
  assert.equal(normalizeRelationshipDeathReason("wolf"), "wolf");

  class Room extends memoryMethods() {
    killPlayer(_st, _targetId, reason) { this.observedReason = reason; return true; }
  }
  installCoreAuditHardeningRules(Room);
  const room = new Room();
  const st = state([player("a", "villager")]);
  room.killPlayer(st, "a", "lover_group", "b", true);
  assert.equal(room.observedReason, "lover");
});

test("human reaction with no legal target auto-skips instead of hard-locking", () => {
  const hunter = player("h", "hunter", { alive: false });
  const st = state([hunter], "reaction");
  st.pendingReaction = { actorId: "h", effect: "death_shot", reason: "test", resumePhase: "debate" };

  class Room extends memoryMethods() {
    legalTargets() { return []; }
    popDeathReaction() { return false; }
    checkAndMaybeEnd() {}
    beginDebate(current) { current.phase = "debate"; }
    enterNight(current) { current.phase = "night"; }
    enterVote(current) { current.phase = "vote"; }
  }
  const room = new Room();
  reconcileReaction(room, st);
  assert.equal(st.pendingReaction, undefined);
  assert.equal(st.phase, "debate");
  assert.match(st.messages.at(-1)?.content ?? "", /沒有合法目標/);
});

test("actionable human reaction receives a reaction deadline", () => {
  const hunter = player("h", "hunter", { alive: false });
  const target = player("v", "villager");
  const st = state([hunter, target], "reaction");
  st.pendingReaction = { actorId: "h", effect: "death_shot", reason: "test", resumePhase: "debate" };
  const alarms = [];

  class Room extends memoryMethods() {
    constructor() { super(); this.ctx = { storage: { setAlarm: (at) => alarms.push(at), deleteAlarm() {} } }; }
    legalTargets() { return [target]; }
    popDeathReaction() { return false; }
    checkAndMaybeEnd() {}
    beginDebate(current) { current.phase = "debate"; }
    enterNight(current) { current.phase = "night"; }
    enterVote(current) { current.phase = "vote"; }
  }
  const room = new Room();
  reconcileReaction(room, st);
  assert.equal(st.roleMemory.__system.phaseDeadlineKind, "reaction");
  assert.equal(typeof st.roleMemory.__system.phaseDeadlineAt, "number");
  assert.equal(alarms.length, 1);
});

test("audit requireState persists a new deadline once and preserves it across a simulated restart", () => {
  const original = state([player("a", "villager")], "night");
  const alarms = [];
  class Room extends memoryMethods() {
    constructor(current) {
      super();
      this.current = current;
      this.saves = 0;
      this.ctx = { storage: { setAlarm: (at) => alarms.push(at), deleteAlarm() {} } };
    }
    requireState() { return this.current; }
    touchAndSave() { this.saves += 1; }
  }
  installCoreAuditHardeningRules(Room);

  const first = new Room(original);
  const loaded = first.requireState();
  const firstDeadline = loaded.roleMemory.__system.phaseDeadlineAt;
  assert.equal(typeof firstDeadline, "number");
  assert.equal(loaded.roleMemory.__system.phaseDeadlinePersistedAt, firstDeadline);
  assert.equal(first.saves, 1);
  first.requireState();
  assert.equal(first.saves, 1);

  const persisted = structuredClone(loaded);
  const restarted = new Room(persisted);
  restarted.requireState();
  assert.equal(persisted.roleMemory.__system.phaseDeadlineAt, firstDeadline);
  assert.equal(restarted.saves, 0);
});

test("sheriff alarm closes voting even when one human never votes", async () => {
  const a = player("a", "villager");
  const b = player("b", "werewolf");
  const st = state([a, b], "sheriff");
  st.sheriff.candidates = ["a", "b"];
  st.sheriff.votes = { a: "a" };
  st.roleMemory.__system = { phaseDeadlineAt: Date.now() - 1, phaseDeadlineKind: "sheriff", phaseDeadlinePersistedAt: Date.now() - 1 };

  class Room extends memoryMethods() {
    constructor() { super(); this.current = st; this.ctx = { storage: { setAlarm() {}, deleteAlarm() {} } }; }
    requireState() { return this.current; }
    touchAndSave() {}
    alarm() { throw new Error("base alarm should not handle sheriff"); }
    finishSheriffElection(current) { this.finished = true; current.phase = "night"; }
  }
  installCoreAuditHardeningRules(Room);
  const room = new Room();
  await room.alarm();
  assert.equal(room.finished, true);
  assert.equal(st.phase, "night");
});

test("reaction alarm skips an unresponsive human and resumes the queued phase", async () => {
  const hunter = player("h", "hunter", { alive: false });
  const target = player("v", "villager");
  const st = state([hunter, target], "reaction");
  const expired = Date.now() - 1;
  st.pendingReaction = { actorId: "h", effect: "death_shot", reason: "test", resumePhase: "debate" };
  st.roleMemory.__system = { phaseDeadlineAt: expired, phaseDeadlineKind: "reaction", phaseDeadlinePersistedAt: expired };

  class Room extends memoryMethods() {
    constructor() { super(); this.current = st; this.ctx = { storage: { setAlarm() {}, deleteAlarm() {} } }; }
    requireState() { return this.current; }
    touchAndSave() {}
    saveBroadcast() {}
    alarm() { throw new Error("base alarm should not handle reaction"); }
    legalTargets() { return [target]; }
    popDeathReaction() { return false; }
    checkAndMaybeEnd() {}
    beginDebate(current) { current.phase = "debate"; }
    enterNight(current) { current.phase = "night"; }
    enterVote(current) { current.phase = "vote"; }
  }
  installCoreAuditHardeningRules(Room);
  const room = new Room();
  await room.alarm();
  assert.equal(st.pendingReaction, undefined);
  assert.equal(st.phase, "debate");
});

test("control pre-stage rechecks actor availability so an earlier disable cancels later nullify", () => {
  const dream = player("d", "dream_wolf");
  const warlock = player("w", "warlock");
  const seer = player("s", "seer");
  const st = state([dream, warlock, seer]);
  st.nightActions.roleActions.d = { effect: "disable_current_action", targetIds: ["w"], submittedAt: 1 };
  st.nightActions.roleActions.w = { effect: "warlock_choice", targetIds: ["s"], option: "nullify", submittedAt: 2 };

  class Room extends memoryMethods() {
    killPlayer(current, id) { const p = current.players.find((candidate) => candidate.id === id); if (p) p.alive = false; return Boolean(p); }
  }
  preStageNightInvariants(new Room(), st);
  assert.equal(st.roleMemory.w.disabledUntilRound, 1);
  assert.equal(st.roleMemory.s?.disabledUntilRound, undefined);
});

test("redirect pre-stage rewrites a core Seer submission before core night resolution", () => {
  const redirector = player("r", "wind_wolf");
  const seer = player("s", "seer");
  const victim = player("v", "villager");
  const st = state([redirector, seer, victim]);
  st.nightActions.seerTargets.s = "v";
  st.nightActions.roleActions.r = { effect: "redirect_targeted_action", targetIds: ["s"], submittedAt: 1 };

  class Room extends memoryMethods() {
    killPlayer(current, id) { const p = current.players.find((candidate) => candidate.id === id); if (p) p.alive = false; return Boolean(p); }
  }
  preStageNightInvariants(new Room(), st);
  assert.equal(st.nightActions.seerTargets.s, "r");
  assert.equal(st.roleMemory.s.redirectNextActionTo, undefined);
});

test("shared targeted-action prelude catches Demon Wolf in a second target before a core override", () => {
  const cupid = player("c", "cupid");
  const villager = player("v", "villager");
  const demon = player("d", "demon_wolf");
  const st = state([cupid, villager, demon]);

  class Room extends memoryMethods() {
    resolveNightRoleAction() { this.baseCalled = true; }
    killPlayer(current, id) { const p = current.players.find((candidate) => candidate.id === id && candidate.alive); if (!p) return false; p.alive = false; return true; }
  }
  installCoreAuditHardeningRules(Room);
  const room = new Room();
  room.resolveNightRoleAction(st, cupid, { effect: "link_lovers", targetIds: ["v", "d"], submittedAt: 1 });
  assert.equal(room.baseCalled, undefined);
  assert.equal(cupid.alive, false);
  assert.equal(st.roleMemory.d.retaliationUsed, true);
});

test("second Cupid cannot overwrite a CP member already claimed earlier in the same resolution", () => {
  const cupid = player("c", "cupid");
  const free = player("v", "villager");
  const claimed = player("p", "villager");
  const mate = player("m", "villager");
  const st = state([cupid, free, claimed, mate]);
  st.roleMemory.p = { loverGroupId: "cp:existing", loverGroupMembers: ["p", "m"] };
  st.roleMemory.m = { loverGroupId: "cp:existing", loverGroupMembers: ["p", "m"] };
  st.roleMemory.c = { cupidLinkedIds: ["v", "p"] };

  class Room extends memoryMethods() {
    resolveNightRoleAction() { this.baseCalled = true; }
    killPlayer() { return true; }
  }
  installCoreAuditHardeningRules(Room);
  const room = new Room();
  room.resolveNightRoleAction(st, cupid, { effect: "link_lovers", targetIds: ["v", "p"], submittedAt: 1 });
  assert.equal(room.baseCalled, undefined);
  assert.deepEqual(st.roleMemory.p.loverGroupMembers, ["p", "m"]);
  assert.deepEqual(st.roleMemory.c.cupidLinkedIds, []);
  assert.match(st.roleResults.c["cupid:conflict"], /不覆寫既有 CP/);
});
