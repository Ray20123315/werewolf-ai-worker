import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installCoreMagicianRules, magicianPrompt, resolveMagicianBySource } from "../.test-build/core-magician.js";

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
    hostPlayerId: players[0]?.id || "m",
    phase,
    round: 2,
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

class FakeRoom {
  projectState(st, token) {
    const me = this.playerByToken(st, token);
    return { me: { id: me.id, role: me.role }, roleAction: undefined };
  }
  playerByToken(st, token) { return st.players.find((p) => p.token === token); }
  submitRoleActionInternal() { this.baseSubmissions = (this.baseSubmissions || 0) + 1; }
  resolveNightRoleAction() { this.baseNightResolutions = (this.baseNightResolutions || 0) + 1; }
  mem(st, id) { st.roleMemory[id] ??= {}; return st.roleMemory[id]; }
  systemMem(st) { st.roleMemory.__system ??= {}; return st.roleMemory.__system; }
  killPlayer(st, id, reason) {
    const target = st.players.find((p) => p.id === id && p.alive && !p.isSpectator && !p.kickedAt);
    if (!target) return false;
    target.alive = false;
    st.deathReasons[id] = `r${st.round}:${reason}`;
    this.killCalls = (this.killCalls || 0) + 1;
    return true;
  }
  saveBroadcast() { this.saved = (this.saved || 0) + 1; }
  enterVote(st) { st.phase = "vote"; }
  finishVote(st) { this.finishedVote = true; st.phase = "night"; }
}

installCoreMagicianRules(FakeRoom);

test("Magician is privately available once during night, debate, or vote, including daytime", () => {
  const mage = player("m", "magician");
  const a = player("a", "seer");
  const b = player("b", "werewolf");
  for (const phase of ["night", "debate", "vote"]) {
    const st = state([mage, a, b], phase);
    assert.equal(magicianPrompt(st, mage)?.effect, "magician_swap");
  }
  const lobby = state([mage, a, b], "lobby");
  assert.equal(magicianPrompt(lobby, mage), undefined);
  lobby.phase = "debate";
  lobby.roleMemory.m = { "used:magician_swap": true };
  assert.equal(magicianPrompt(lobby, mage), undefined);
});

test("final Magician layer exposes the daytime action and accepts it instead of falling through to the night-only base prompt", () => {
  const mage = player("m", "magician");
  const a = player("a", "seer");
  const b = player("b", "werewolf");
  const st = state([mage, a, b], "debate");
  st.debateOrder = ["m", "a", "b"];
  st.votes = { a: "m", b: "a" };
  const room = new FakeRoom();
  const view = room.projectState(st, mage.token);
  assert.equal(view.roleAction?.effect, "magician_swap");
  assert.equal(view.roleAction?.timing, "day");
  room.submitRoleActionInternal(st, mage, "magician_swap", [a.id, b.id]);
  assert.equal(room.baseSubmissions || 0, 0);
  assert.equal(st.roleMemory.m["used:magician_swap"], true);
  assert.deepEqual(st.votes, { a: "a", b: "m" });
});

test("one true-dead and one living target exchange life/death through the death and revive invariants", () => {
  const mage = player("m", "magician");
  const living = player("a", "hunter");
  const dead = player("d", "villager", { alive: false });
  const st = state([mage, living, dead], "night");
  st.deathReasons.d = "r1:old";
  const room = new FakeRoom();
  resolveMagicianBySource(room, st, mage, { effect: "magician_swap", targetIds: [living.id, dead.id], submittedAt: 1 });
  assert.equal(room.killCalls, 1);
  assert.equal(living.alive, false);
  assert.equal(dead.alive, true);
  assert.equal(st.deathReasons.d, undefined);
  assert.match(st.deathReasons.a, /magician_swap/);
});

test("both living targets swap current ballots during daytime but not their roles", () => {
  const mage = player("m", "magician");
  const a = player("a", "seer");
  const b = player("b", "werewolf");
  const st = state([mage, a, b], "vote");
  st.votes = { a: "m", b: "a" };
  resolveMagicianBySource(new FakeRoom(), st, mage, { effect: "magician_swap", targetIds: [a.id, b.id], submittedAt: 1 });
  assert.deepEqual(st.votes, { a: "a", b: "m" });
  assert.equal(a.role, "seer");
  assert.equal(b.role, "werewolf");
});

test("both living targets at night swap role and victory allegiance", () => {
  const mage = player("m", "magician");
  const a = player("a", "seer", { factionOverride: "spirit" });
  const b = player("b", "werewolf", { factionOverride: "blood" });
  const st = state([mage, a, b], "night");
  resolveMagicianBySource(new FakeRoom(), st, mage, { effect: "magician_swap", targetIds: [a.id, b.id], submittedAt: 1 });
  assert.equal(a.role, "werewolf");
  assert.equal(b.role, "seer");
  assert.equal(a.factionOverride, "blood");
  assert.equal(b.factionOverride, "spirit");
});

test("both true-dead targets fall through to role and victory-allegiance exchange rather than no-op", () => {
  const mage = player("m", "magician");
  const a = player("a", "seer", { alive: false, factionOverride: "spirit" });
  const b = player("b", "hunter", { alive: false, factionOverride: "blood" });
  const st = state([mage, a, b], "night");
  resolveMagicianBySource(new FakeRoom(), st, mage, { effect: "magician_swap", targetIds: [a.id, b.id], submittedAt: 1 });
  assert.equal(a.role, "hunter");
  assert.equal(b.role, "seer");
  assert.equal(a.factionOverride, "blood");
  assert.equal(b.factionOverride, "spirit");
});

test("CoreRules installs the source-correct Magician override after fake-death and integrity compatibility layers", () => {
  const source = readFileSync(new URL("../src/core-rules.ts", import.meta.url), "utf8");
  const fakeIndex = source.indexOf("installCoreFakeDeathRules(GameRoomCtor)");
  const magicianIndex = source.indexOf("installCoreMagicianRules(GameRoomCtor)");
  assert.ok(fakeIndex >= 0);
  assert.ok(magicianIndex > fakeIndex);
});
