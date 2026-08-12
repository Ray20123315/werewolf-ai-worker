import test from "node:test";
import assert from "node:assert/strict";
import {
  fakeDeathActionAvailable,
  installCoreFakeDeathRules,
  isRealDeadForDeathGate
} from "../.test-build/core-fake-death.js";
import { needsNightAction, roleActionPrompt } from "../.test-build/game-engine.js";

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

function state(players, phase = "night", initialPlayerCount = players.length) {
  return {
    roomId: "ABC234",
    hostPlayerId: players[0]?.id || "a",
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
    initialPlayerCount,
    createdAt: 0,
    updatedAt: 0
  };
}

test("fake death never satisfies Bee, Persuader, Red Axe, Lurking Wolf, or Necromancer real-death gates", () => {
  {
    const bee = player("bee", "bee");
    const hive = player("hive", "hive", { alive: false });
    const st = state([bee, hive]);
    st.roleMemory.hive = { fakeDeath: true };
    const prompt = roleActionPrompt(bee, st);
    assert.equal(prompt?.effect, "kill_if_hive_dead");
    assert.equal(fakeDeathActionAvailable(st, bee, prompt), false);
    delete st.roleMemory.hive.fakeDeath;
    assert.equal(fakeDeathActionAvailable(st, bee, roleActionPrompt(bee, st)), true);
  }

  {
    const persuader = player("p", "persuader_wolf");
    const fakeWolf = player("w", "werewolf", { alive: false });
    const villager = player("v", "villager");
    const st = state([persuader, fakeWolf, villager]);
    st.roleMemory.w = { fakeDeath: true };
    const prompt = roleActionPrompt(persuader, st);
    assert.equal(prompt?.effect, "convert_to_werewolf_if_last");
    assert.equal(fakeDeathActionAvailable(st, persuader, prompt), false);
    delete st.roleMemory.w.fakeDeath;
    assert.equal(fakeDeathActionAvailable(st, persuader, roleActionPrompt(persuader, st)), true);
  }

  {
    const axe = player("axe", "red_axe_madman");
    const fakeWolf = player("w", "werewolf", { alive: false });
    const villager = player("v", "villager");
    const st = state([axe, fakeWolf, villager]);
    st.roleMemory.w = { fakeDeath: true };
    const prompt = roleActionPrompt(axe, st);
    assert.equal(prompt?.effect, "kill_if_no_wolves");
    assert.equal(fakeDeathActionAvailable(st, axe, prompt), false);
    delete st.roleMemory.w.fakeDeath;
    assert.equal(fakeDeathActionAvailable(st, axe, roleActionPrompt(axe, st)), true);
  }

  {
    const lurking = player("l", "lurking_wolf");
    const fakeWolf = player("w", "werewolf", { alive: false });
    const villager = player("v", "villager");
    const st = state([lurking, fakeWolf, villager]);
    st.roleMemory.w = { fakeDeath: true };
    const prompt = roleActionPrompt(lurking, st);
    assert.ok(prompt, "legacy prompt currently sees alive=false and would wake the lurking wolf");
    assert.equal(fakeDeathActionAvailable(st, lurking, prompt), false);
    delete st.roleMemory.w.fakeDeath;
    assert.equal(fakeDeathActionAvailable(st, lurking, roleActionPrompt(lurking, st)), true);
  }

  {
    const necromancer = player("n", "necromancer");
    const fakeDead = player("f", "villager", { alive: false });
    const a = player("a", "villager");
    const b = player("b", "villager");
    const st = state([necromancer, fakeDead, a, b], "night", 4);
    st.roleMemory.f = { fakeDeath: true };
    const prompt = roleActionPrompt(necromancer, st);
    assert.equal(prompt?.effect, "necromancer_milestone");
    assert.equal(fakeDeathActionAvailable(st, necromancer, prompt), false);
    delete st.roleMemory.f.fakeDeath;
    assert.equal(fakeDeathActionAvailable(st, necromancer, roleActionPrompt(necromancer, st)), true);
  }
});

test("one_dead target mode excludes fake-dead players", () => {
  class Room {
    legalTargets(st, _actor, mode) {
      if (mode !== "one_dead") return [];
      return st.players.filter((p) => !p.alive);
    }
  }
  installCoreFakeDeathRules(Room);

  const actor = player("g", "gravedigger");
  const realDead = player("d", "seer", { alive: false });
  const fakeDead = player("f", "hunter", { alive: false });
  const st = state([actor, realDead, fakeDead]);
  st.roleMemory.f = { fakeDeath: true };

  const targets = new Room().legalTargets(st, actor, "one_dead");
  assert.deepEqual(targets.map((p) => p.id), ["d"]);
  assert.equal(isRealDeadForDeathGate(st, fakeDead), false);
  assert.equal(isRealDeadForDeathGate(st, realDead), true);
});

test("fake-death-gated night actions auto-pass instead of blocking phase completion", () => {
  class Room {
    enterNight(st, round) { st.phase = "night"; st.round = round; }
    finishNight(st) { this.finished = true; st.phase = "debate"; }
    saveBroadcast() { this.saved = true; }
    pendingAITask(st) {
      const actor = st.players.find((p) => p.alive && needsNightAction(st, p));
      return actor ? { playerId: actor.id, operation: "role_action" } : undefined;
    }
  }
  installCoreFakeDeathRules(Room);

  const bee = player("bee", "bee");
  const fakeHive = player("hive", "hive", { alive: false });
  const st = state([bee, fakeHive], "night");
  st.roleMemory.hive = { fakeDeath: true };

  const room = new Room();
  room.enterNight(st, 2);
  assert.equal(st.nightActions.roleActions.bee?.option, "__pass__");
  assert.equal(room.finished, true);
  assert.equal(st.phase, "debate");
});

test("Necromancer milestone ratio excludes fake deaths during resolver execution", () => {
  class Room {
    mem(st, id) { st.roleMemory[id] ??= {}; return st.roleMemory[id]; }
    resolveNightRoleAction() { this.baseResolverCalled = true; }
    storeRoleResult(_st, _actor, target, result) { this.result = { targetId: target.id, result }; }
    killPlayer() { this.killCalled = true; }
  }
  installCoreFakeDeathRules(Room);

  const necromancer = player("n", "necromancer");
  const realDead = player("d", "villager", { alive: false });
  const fakeDead = player("f", "villager", { alive: false });
  const target = player("t", "seer");
  const st = state([necromancer, realDead, fakeDead, target], "night", 4);
  st.roleMemory.f = { fakeDeath: true };

  const room = new Room();
  room.resolveNightRoleAction(st, necromancer, {
    effect: "necromancer_milestone",
    targetIds: ["t"],
    submittedAt: 1
  });

  assert.equal(st.roleMemory.n?.deathShield, undefined, "25% real deaths must not be promoted to 50% by a fake death");
  assert.equal(room.killCalled, undefined);
  assert.deepEqual(room.result, { targetId: "t", result: "預言家" });
  assert.equal(room.baseResolverCalled, undefined);
});
