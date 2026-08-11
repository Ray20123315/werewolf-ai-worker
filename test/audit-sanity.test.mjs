import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installAISanityRules } from "../.test-build/ai-sanity.js";

function player(id, role, isAI = false) {
  return {
    id,
    token: `token-${id}`,
    name: id,
    nameKey: id,
    alive: true,
    isAI,
    isSpectator: false,
    ...(isAI ? { ai: { provider: "deepseek", model: "deepseek-v4-flash" } } : {}),
    role,
    joinedAt: 1
  };
}

function nightState(players) {
  return {
    roomId: "ABC234",
    hostPlayerId: "host",
    phase: "night",
    round: 1,
    players,
    roleSetup: {},
    settings: { sheriffEnabled: true, deathInfo: "names", tieRule: "random_elimination", autoRoleSetup: false },
    sheriff: { enabled: true, electionRound: 1, candidates: [], votes: {}, successors: [] },
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

test("admin static asset routing does not send /admin through the worker first", () => {
  const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(config.assets.run_worker_first, ["/api/*"]);
  assert.ok(!config.assets.run_worker_first.some((pattern) => pattern.startsWith("/admin")));
});

test("AI wolf leader is selected before an earlier AI witch can decide", () => {
  class FakeRoom {}
  FakeRoom.prototype.participatesWolfVote = (_state, actor) => actor.id === "wolf";
  FakeRoom.prototype.pendingAITask = (state) => ({ playerId: "witch", operation: "role_action" });
  installAISanityRules(FakeRoom);

  const state = nightState([player("witch", "witch", true), player("wolf", "werewolf", true), player("villager", "villager")]);
  const task = new FakeRoom().pendingAITask(state);
  assert.deepEqual(task, { playerId: "wolf", operation: "night_action" });
});

test("AI witch waits for a human wolf leader, then becomes runnable after the wolf vote", () => {
  class FakeRoom {}
  FakeRoom.prototype.participatesWolfVote = (_state, actor) => actor.id === "wolf";
  FakeRoom.prototype.pendingAITask = (_state) => ({ playerId: "witch", operation: "role_action" });
  installAISanityRules(FakeRoom);

  const room = new FakeRoom();
  const state = nightState([player("witch", "witch", true), player("wolf", "werewolf", false), player("villager", "villager")]);
  assert.equal(room.pendingAITask(state), undefined);
  state.nightActions.wolfVotes.wolf = "villager";
  assert.deepEqual(room.pendingAITask(state), { playerId: "witch", operation: "role_action" });
});

test("AI witch is not blocked when no legal non-wolf target exists", () => {
  class FakeRoom {}
  FakeRoom.prototype.participatesWolfVote = (_state, actor) => actor.id === "wolf";
  FakeRoom.prototype.pendingAITask = (_state) => ({ playerId: "witch", operation: "role_action" });
  installAISanityRules(FakeRoom);

  const state = nightState([player("wolf", "werewolf", false), player("witch", "witch", true)]);
  state.players[1].role = "werewolf";
  assert.deepEqual(new FakeRoom().pendingAITask(state), { playerId: "witch", operation: "role_action" });
});
