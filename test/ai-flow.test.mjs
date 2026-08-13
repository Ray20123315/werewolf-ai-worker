import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installAIFlowRules } from "../.test-build/ai-flow.js";

function player(id, role, isAI = false, alive = true) {
  return {
    id,
    token: `token-${id}`,
    name: id,
    nameKey: id,
    alive,
    isAI,
    isSpectator: false,
    role,
    ...(isAI ? { ai: { provider: "deepseek", model: "deepseek-v4-flash" } } : {}),
    joinedAt: 0
  };
}

function state(players, phase = "night") {
  return {
    roomId: "TEST01",
    hostPlayerId: players[0]?.id ?? "host",
    phase,
    round: 1,
    players,
    roleSetup: {},
    settings: { sheriffEnabled: true, deathInfo: "names", tieRule: "no_elimination", autoRoleSetup: false, winCondition: "slaughter_edge" },
    sheriff: { enabled: true, electionRound: 1, candidates: players.filter((p) => p.alive).map((p) => p.id), votes: {}, successors: [] },
    messages: [],
    votes: {},
    nightActions: { wolfVotes: {}, seerTargets: {}, guardTargets: {}, witchActions: {}, roleActions: {} },
    roleMemory: { __system: {} },
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
  constructor(value) {
    this.state = value;
    this.finishedNight = 0;
    this.finishedVote = 0;
    this.afterNight = 0;
    this.originalAIRuns = 0;
    this.saved = 0;
  }
  requireState() { return this.state; }
  assertHost() {}
  playerByToken(value, token) { return value.players.find((p) => p.token === token); }
  systemMem(value) { return (value.roleMemory.__system ??= {}); }
  asStringArray(value) { return Array.isArray(value) ? [...value] : []; }
  participatesWolfVote(value, actor) { return actor.role === "werewolf" && value.roleMemory.__system?.wolfLeaderId === actor.id; }
  enterNight(value, round) { value.phase = "night"; value.round = round; }
  afterNightSubmission() { this.afterNight += 1; }
  finishNight(value) { this.finishedNight += 1; value.phase = "debate"; }
  enterVote(value) { value.phase = "vote"; value.votes = {}; }
  castVoteById(value, voterId, targetId) { value.votes[voterId] = targetId; }
  finishVote(value) { this.finishedVote += 1; value.phase = "night"; }
  submitRoleActionInternal() {}
  pendingAITask() { return { playerId: "wolf", operation: "wolf_chat" }; }
  async runAI() { this.originalAIRuns += 1; return { ok: true }; }
  saveBroadcast() { this.saved += 1; }
  touchAndSave() { this.saved += 1; }
  broadcast() {}
  async decideAITarget(_value, _actor, _keys, candidates) { return candidates[0].id; }
  legalTargets(value, actor, mode) {
    const alive = value.players.filter((p) => p.alive && !p.isSpectator);
    const dead = value.players.filter((p) => !p.alive && !p.isSpectator);
    if (mode === "none") return [];
    if (mode === "one_dead") return dead;
    if (mode === "one_alive_any" || mode === "two_alive_any") return alive;
    if (mode === "one_alive_non_wolf") return alive.filter((p) => p.id !== actor.id && p.role !== "werewolf");
    if (mode === "two_any") return value.players.filter((p) => !p.isSpectator && p.id !== actor.id);
    return alive.filter((p) => p.id !== actor.id);
  }
  castSheriffVote(token, targetId) {
    const voter = this.playerByToken(this.state, token);
    this.state.sheriff.votes[voter.id] = targetId;
  }
  finishSheriffElection(value) { value.phase = "night"; }
  validateWitchAction() {}
  privateContext() { return "context"; }
  aiSystemPrompt() { return "system"; }
  checkAndMaybeEnd() {}
  popDeathReaction() { return false; }
  beginDebate(value) { value.phase = "debate"; }
}

installAIFlowRules(FakeRoom);

test("required night AI action outranks optional wolf chat", () => {
  const wolf = player("wolf", "werewolf", true);
  const mate = player("mate", "werewolf");
  const villager = player("villager", "villager");
  const value = state([wolf, mate, villager]);
  value.roleMemory.__system.wolfLeaderId = wolf.id;
  const room = new FakeRoom(value);

  assert.deepEqual(room.pendingAITask(value), { playerId: "wolf", operation: "night_action" });
});

test("AI with no meaningful night action is skipped without a model call and cannot block night", () => {
  const seer = player("seer", "seer", true);
  const value = state([seer], "lobby");
  const room = new FakeRoom(value);

  room.enterNight(value, 1);

  assert.equal(room.finishedNight, 1);
  assert.equal(room.originalAIRuns, 0);
  assert.deepEqual(value.nightActions.seerTargets, {}, "internal skip sentinel must not reach resolution");
  assert.equal(value.phase, "debate");
});

test("AI seer uses the dedicated seer submission map instead of looping on generic role actions", async () => {
  const seer = player("seer", "seer", true);
  const target = player("target", "villager");
  const value = state([seer, target]);
  const room = new FakeRoom(value);

  assert.deepEqual(room.pendingAITask(value), { playerId: "seer", operation: "role_action" });
  await room.runAI("host-token", seer.id, ["key"]);

  assert.equal(value.nightActions.seerTargets.seer, target.id);
  assert.deepEqual(value.nightActions.roleActions, {});
  assert.equal(room.afterNight, 1);
  assert.equal(room.originalAIRuns, 0);
});

test("a delayed AI response cannot mutate a replacement night with the same visible task", async () => {
  const seer = player("seer", "seer", true);
  const target = player("target", "villager");
  const value = state([seer, target]);
  const room = new FakeRoom(value);

  room.decideAITarget = async () => {
    room.state = state([seer, target]);
    return target.id;
  };

  await assert.rejects(
    room.runAI("host-token", seer.id, ["key"]),
    /AI 操作已過期/
  );
  assert.deepEqual(room.state.nightActions.seerTargets, {});
  assert.equal(room.afterNight, 0);
});

test("AI sheriff election vote is an automatic pending task", async () => {
  const bot = player("bot", "villager", true);
  const human = player("human", "villager");
  const value = state([bot, human], "sheriff");
  const room = new FakeRoom(value);

  assert.deepEqual(room.pendingAITask(value), { playerId: "bot", operation: "sheriff_vote" });
  await room.runAI("host-token", bot.id, ["key"]);
  assert.equal(value.sheriff.votes.bot, bot.id);
});

test("AI with no legal exile target is skipped and cannot hold the vote gate open", () => {
  const bot = player("bot", "villager", true);
  const value = state([bot], "debate");
  value.sheriff.enabled = false;
  value.sheriff.candidates = [];
  const room = new FakeRoom(value);

  room.enterVote(value);

  assert.equal(room.finishedVote, 1);
  assert.deepEqual(value.votes, {}, "skip sentinel must not be counted as a real vote");
});

test("AI flow implementation covers core night roles, sheriff votes, reactions, and zero-token skips", () => {
  const source = readFileSync(new URL("../src/ai-flow.ts", import.meta.url), "utf8");
  assert.match(source, /autoSkipNonActionableNightAIs/);
  assert.match(source, /actor\.role === "seer"/);
  assert.match(source, /actor\.role === "guard"/);
  assert.match(source, /actor\.role === "witch"/);
  assert.match(source, /operation: "sheriff_vote"/);
  assert.match(source, /operation: "reaction_action"/);
  assert.match(source, /AUTO_SKIP_TARGET/);
  assert.match(source, /stripNightAutoSkips/);
});

test("every model-backed AI state mutator revalidates its captured task context", () => {
  for (const relative of [
    "../src/room.ts",
    "../src/house-rules.ts",
    "../src/ai-flow.ts",
    "../src/core-phase-ai.ts",
    "../src/core-integrity.ts",
    "../src/core-post28-repair.ts"
  ]) {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8");
    assert.match(source, /captureAITaskContext/, relative);
    assert.match(source, /(?:assertCurrentAITask|isCurrentAITask)/, relative);
  }
});
