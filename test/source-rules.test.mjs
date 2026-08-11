import test from "node:test";
import assert from "node:assert/strict";
import { installOfficialSourceRules, wraithNightInvincibilityApplies } from "../.test-build/source-rules.js";
import { roleDefinition } from "../.test-build/roles.js";

function player(id, role, factionOverride) {
  return {
    id,
    token: `token-${id}`,
    name: id,
    nameKey: id,
    alive: true,
    isAI: false,
    isSpectator: false,
    role,
    ...(factionOverride ? { factionOverride } : {}),
    joinedAt: 1
  };
}

function state(players) {
  return {
    roomId: "ABC234",
    hostPlayerId: "host",
    phase: "night",
    round: 1,
    players,
    roleSetup: {},
    settings: { sheriffEnabled: false, deathInfo: "names", tieRule: "random_elimination", autoRoleSetup: false },
    sheriff: { enabled: false, electionRound: 0, candidates: [], votes: {}, successors: [] },
    messages: [], votes: {},
    nightActions: { wolfVotes: {}, seerTargets: {}, guardTargets: {}, witchActions: {}, roleActions: {} },
    roleMemory: {}, seerResults: {}, roleResults: {}, witchHealAvailable: true, witchPoisonAvailable: true,
    guardLastTargets: {}, debateOrder: [], debateIndex: 0, debateCompleted: [], lastNightDeaths: [], deathReasons: {},
    moderatorIds: [], initialPlayerCount: players.length, createdAt: 0, updatedAt: 0
  };
}

test("official source: wraith is night-invincible while a living village-aligned player remains", () => {
  const st = state([player("wraith", "wraith"), player("villager", "villager"), player("wolf", "werewolf")]);
  assert.equal(wraithNightInvincibilityApplies(st, "wolf"), true);
  assert.equal(wraithNightInvincibilityApplies(st, "poison"), true);
  assert.equal(wraithNightInvincibilityApplies(st, "role_kill"), true);
});

test("wraith night invincibility ends after the good side is gone", () => {
  const good = player("villager", "villager");
  good.alive = false;
  const st = state([player("wraith", "wraith"), good, player("wolf", "werewolf")]);
  assert.equal(wraithNightInvincibilityApplies(st, "wolf"), false);
  assert.equal(wraithNightInvincibilityApplies(st, "poison"), false);
});

test("explicit project priority: lover suicide still kills a wraith", () => {
  const st = state([player("wraith", "wraith"), player("villager", "villager")]);
  assert.equal(wraithNightInvincibilityApplies(st, "lover"), false);
});

test("installed source rule blocks normal night deaths before legacy protection wrappers", () => {
  class FakeRoom {}
  FakeRoom.prototype.killPlayer = function (st, targetId, reason) {
    const target = st.players.find((p) => p.id === targetId && p.alive);
    if (!target) return false;
    target.alive = false;
    target.lastReason = reason;
    return true;
  };
  installOfficialSourceRules(FakeRoom);
  const room = new FakeRoom();
  const wraith = player("wraith", "wraith");
  const villager = player("villager", "villager");
  const st = state([wraith, villager, player("wolf", "werewolf")]);

  assert.equal(room.killPlayer(st, "wraith", "poison"), false);
  assert.equal(wraith.alive, true);
  assert.equal(room.killPlayer(st, "wraith", "lover"), true);
  assert.equal(wraith.alive, false);
  assert.equal(wraith.lastReason, "lover");
  assert.match(roleDefinition("wraith").summary, /夜晚無敵/);
});
