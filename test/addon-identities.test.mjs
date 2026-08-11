import test from "node:test";
import assert from "node:assert/strict";
import { baseRoleSetup, baseRoleSetupTotal, installAddonIdentityRules } from "../.test-build/addon-identities.js";

function player(id, role, addons = [], isAI = false) {
  return {
    id,
    token: `token-${id}`,
    name: id,
    nameKey: id,
    alive: true,
    isAI,
    isSpectator: false,
    role,
    joinedAt: 1,
    ...(addons.length ? { addonRoles: [...addons] } : {}),
    ...(isAI ? { ai: { provider: "deepseek", model: "deepseek-v4-flash" } } : {})
  };
}

function state(players, phase = "night") {
  return {
    roomId: "ABC234",
    hostPlayerId: "host",
    phase,
    round: 1,
    players,
    roleSetup: {},
    settings: { sheriffEnabled: false, deathInfo: "names", tieRule: "random_elimination", autoRoleSetup: false },
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

function buildRoom(initialState) {
  class FakeRoom {
    constructor() { this.state = initialState; this.broadcasts = 0; this.baseStartSetup = null; this.originalAIRuns = 0; }
  }
  FakeRoom.prototype.requireState = function () { return this.state; };
  FakeRoom.prototype.assertHost = function (_state, token) { if (token !== "host-token") throw new Error("只有房主"); };
  FakeRoom.prototype.assertLobby = function (st) { if (st.phase !== "lobby") throw new Error("不是大廳"); };
  FakeRoom.prototype.playerByToken = function (st, token) { const p = st.players.find((x) => x.token === token); if (!p) throw new Error("bad token"); return p; };
  FakeRoom.prototype.mem = function (st, id) { st.roleMemory[id] ??= {}; return st.roleMemory[id]; };
  FakeRoom.prototype.systemMem = function (st) { return this.mem(st, "__system"); };
  FakeRoom.prototype.asStringArray = function (value) { return Array.isArray(value) ? [...value] : []; };
  FakeRoom.prototype.touchAndSave = function () {};
  FakeRoom.prototype.broadcast = function () { this.broadcasts += 1; };
  FakeRoom.prototype.saveBroadcast = function () { this.broadcasts += 1; };
  FakeRoom.prototype.addSystemMessage = function (st, content) { st.messages.push({ content }); };
  FakeRoom.prototype.beginDebate = function (st) { st.phase = "debate"; };
  FakeRoom.prototype.isPermanentlyGuarded = function () { return false; };
  FakeRoom.prototype.startGame = function (_token) {
    this.baseStartSetup = { ...this.state.roleSetup };
    assert.equal(this.state.players.some((p) => p.addonRoles?.includes("masochist_cultist")), true);
    assert.equal(this.state.players.some((p) => p.addonRoles?.includes("sadist_leader")), true);
    this.state.phase = "night";
  };
  FakeRoom.prototype.resetGame = function () { this.state.phase = "lobby"; };
  FakeRoom.prototype.projectState = function (st, token) {
    const me = this.playerByToken(st, token);
    return {
      phase: st.phase,
      players: st.players.map((p) => ({ id: p.id, name: p.name, alive: p.alive, isSpectator: p.isSpectator })),
      me: { id: me.id, alive: me.alive },
      roleSetup: st.roleSetup,
      canStart: true
    };
  };
  FakeRoom.prototype.handleClientMessage = async function () {};
  FakeRoom.prototype.pendingAITask = function () { return undefined; };
  FakeRoom.prototype.runAI = async function () { this.originalAIRuns += 1; return { ok: true }; };
  FakeRoom.prototype.finishNight = function (st) { st.phase = "debate"; };
  FakeRoom.prototype.resolveNightRoleAction = function (st, _actor, action) {
    if (action.effect === "link_lovers") {
      const [a, b] = action.targetIds;
      this.mem(st, a).lover = b;
      this.mem(st, b).lover = a;
    }
  };
  FakeRoom.prototype.killPlayer = function (st, targetId, reason, killerId, bypassProtection = false) {
    const target = st.players.find((p) => p.id === targetId && p.alive && !p.isSpectator);
    if (!target) return false;
    if (!bypassProtection && reason === "wolf" && target.role === "wraith") return false;
    target.alive = false;
    st.deathReasons[target.id] = `r${st.round}:${reason}`;
    const loverId = this.mem(st, target.id).lover;
    if (typeof loverId === "string") this.killPlayer(st, loverId, "lover", target.id, true);
    return true;
  };
  FakeRoom.prototype.endGame = function (st, winner) { st.phase = "ended"; st.winner = winner; };
  FakeRoom.prototype.checkAndMaybeEnd = function () {};
  installAddonIdentityRules(FakeRoom);
  return new FakeRoom();
}

test("M and S counts are addons and do not consume base-role slots", () => {
  const setup = { werewolf: 1, seer: 1, villager: 1, masochist_cultist: 1, sadist_leader: 1 };
  assert.deepEqual(baseRoleSetup(setup), { werewolf: 1, seer: 1, villager: 1 });
  assert.equal(baseRoleSetupTotal(setup), 3);
});

test("manual start assigns M and S on top of distinct base-role players", () => {
  const st = state([
    player("host", undefined),
    player("p2", undefined),
    player("p3", undefined)
  ], "lobby");
  st.players[0].token = "host-token";
  st.roleSetup = { werewolf: 1, seer: 1, villager: 1, masochist_cultist: 1, sadist_leader: 1 };
  const room = buildRoom(st);
  room.startGame("host-token");
  assert.deepEqual(room.baseStartSetup, { werewolf: 1, seer: 1, villager: 1 });
  assert.deepEqual(room.state.roleSetup, { werewolf: 1, seer: 1, villager: 1, masochist_cultist: 1, sadist_leader: 1 });
  const m = room.state.players.find((p) => p.addonRoles?.includes("masochist_cultist"));
  const s = room.state.players.find((p) => p.addonRoles?.includes("sadist_leader"));
  assert.ok(m && s);
  assert.notEqual(m.id, s.id);
});

test("wraith + lover keeps wraith wolf immunity, but still dies from lover suicide", () => {
  const wraith = player("wraith", "wraith", ["lover"]);
  const mate = player("mate", "villager", ["lover"]);
  const st = state([wraith, mate, player("wolf", "werewolf")]);
  st.roleMemory.wraith = { lover: "mate" };
  st.roleMemory.mate = { lover: "wraith" };
  const room = buildRoom(st);

  assert.equal(room.killPlayer(st, "wraith", "wolf", "wolf"), false);
  assert.equal(wraith.alive, true);
  assert.equal(mate.alive, true);

  assert.equal(room.killPlayer(st, "mate", "poison"), true);
  assert.equal(mate.alive, false);
  assert.equal(wraith.alive, false);
  assert.match(st.deathReasons.wraith, /lover/);
});

test("M addon wins when normally exiled without replacing its base role", () => {
  const m = player("m", "wraith", ["masochist_cultist"]);
  const st = state([m, player("wolf", "werewolf"), player("v", "villager")], "vote");
  const room = buildRoom(st);
  assert.equal(room.killPlayer(st, "m", "exile"), true);
  assert.equal(m.role, "wraith");
  assert.equal(st.winner, "neutral");
  assert.deepEqual(st.winnerPlayerIds, ["m"]);
  assert.match(st.winnerLabel, /抖M/);
});

test("S addon respects base immunity before consuming M bodyguard, then redirects an unprotected death", () => {
  const s = player("s", "wraith", ["sadist_leader"]);
  const m = player("m", "villager", ["masochist_cultist"]);
  const st = state([s, m, player("wolf", "werewolf")]);
  st.roleMemory.s = { sadistBodyguardId: "m" };
  const room = buildRoom(st);

  assert.equal(room.killPlayer(st, "s", "wolf", "wolf"), false);
  assert.equal(s.alive, true);
  assert.equal(m.alive, true);
  assert.equal(st.roleMemory.s.sadistBodyguardId, "m");

  assert.equal(room.killPlayer(st, "s", "poison", "wolf"), true);
  assert.equal(s.alive, true);
  assert.equal(m.alive, false);
  assert.equal(st.roleMemory.s.sadistBodyguardId, undefined);
});

test("S bodyguard never redirects normal exile or lover-suicide death", () => {
  for (const reason of ["exile", "lover"]) {
    const s = player("s", "villager", ["sadist_leader"]);
    const m = player("m", "villager", ["masochist_cultist"]);
    const st = state([s, m, player("wolf", "werewolf")], reason === "exile" ? "vote" : "night");
    st.roleMemory.s = { sadistBodyguardId: "m" };
    const room = buildRoom(st);
    assert.equal(room.killPlayer(st, "s", reason), true);
    assert.equal(s.alive, false);
    assert.equal(m.alive, true);
  }
});

test("a mixed-faction lover pair blocks faction victory until the pair is the last two alive", () => {
  const spirit = player("spirit", "wraith", ["lover"]);
  const villager = player("villager", "villager", ["lover"]);
  const third = player("third", "villager");
  const st = state([spirit, villager, third], "debate");
  st.roleMemory.spirit = { lover: "villager" };
  st.roleMemory.villager = { lover: "spirit" };
  const room = buildRoom(st);

  room.endGame(st, "spirit");
  assert.equal(st.winner, undefined);
  third.alive = false;
  room.endGame(st, "spirit");
  assert.equal(st.winner, "neutral");
  assert.deepEqual(new Set(st.winnerPlayerIds), new Set(["spirit", "villager"]));
  assert.match(st.winnerLabel, /情侶/);
});

test("AI S probe becomes pending only after base AI work and does not call the LLM path", async () => {
  const s = player("s", "seer", ["sadist_leader"], true);
  const m = player("m", "villager", ["masochist_cultist"]);
  const st = state([s, m, player("v", "villager")]);
  const room = buildRoom(st);
  room.pendingAITask = Object.getPrototypeOf(room).pendingAITask.bind(room);
  const originalBasePending = Object.getPrototypeOf(Object.getPrototypeOf(room))?.pendingAITask;
  void originalBasePending;
  // Base FakeRoom returns no task, so addon probe is immediately pending.
  assert.deepEqual(room.pendingAITask(st), { playerId: "s", operation: "addon_sadist_probe" });
  await room.runAI("host-token", "s", []);
  assert.equal(room.originalAIRuns, 0);
  assert.equal(typeof st.roleMemory.s.sadistProbeRound, "number");
});
