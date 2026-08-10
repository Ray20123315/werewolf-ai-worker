import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkWinner } from "../.test-build/game-engine.js";
import { installHouseRules } from "../.test-build/house-rules.js";

function player(id, role, alive = true) {
  return { id, token: `t-${id}`, name: id, nameKey: id, alive, isAI: false, isSpectator: false, role, joinedAt: 0 };
}

function multiWitchState() {
  const w1 = player("w1", "witch");
  const w2 = player("w2", "witch");
  const victim = player("victim", "villager");
  const a = player("a", "villager");
  const b = player("b", "villager");
  return {
    roomId: "TEST01",
    hostPlayerId: "w1",
    phase: "night",
    round: 1,
    players: [w1, w2, victim, a, b],
    roleSetup: { witch: 2, werewolf: 1, villager: 2 },
    settings: { sheriffEnabled: false, deathInfo: "names", tieRule: "no_elimination", autoRoleSetup: false, winCondition: "slaughter_edge" },
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
    initialPlayerCount: 5,
    createdAt: 0,
    updatedAt: 0
  };
}

class FakeHouseRoom {
  constructor(state) { this.state = state; this.kills = []; this.saved = 0; }
  requireState() { return this.state; }
  playerByToken(state, token) { return state.players.find((p) => p.token === token); }
  mem(state, playerId) { state.roleMemory[playerId] ??= {}; return state.roleMemory[playerId]; }
  systemMem(state) { return this.mem(state, "__system"); }
  asStringArray(value) { return Array.isArray(value) ? [...value] : []; }
  touchAndSave() { this.saved += 1; }
  validateWitchAction(state, _actor, action) {
    if (action.type === "heal" && !state.witchHealAvailable) throw new Error("legacy heal unavailable");
    if (action.type === "poison" && !state.witchPoisonAvailable) throw new Error("legacy poison unavailable");
  }
  finishNight(state) {
    const healed = Object.values(state.nightActions.witchActions).some((a) => a.type === "heal") && state.witchHealAvailable;
    if (healed) state.witchHealAvailable = false;
    for (const action of Object.values(state.nightActions.witchActions)) {
      if (action.type === "poison" && state.witchPoisonAvailable) {
        this.kills.push(action.targetId);
        state.witchPoisonAvailable = false;
      }
    }
  }
  projectState(state, token) {
    const me = this.playerByToken(state, token);
    return {
      settings: { ...state.settings },
      me: {
        id: me.id,
        role: me.role,
        witchHealAvailable: state.witchHealAvailable,
        witchPoisonAvailable: state.witchPoisonAvailable,
        witchKnownVictim: "victim",
        witchCanHealKnownVictim: state.witchHealAvailable
      }
    };
  }
}

installHouseRules(FakeHouseRoom);

test("slaughter-edge uses immutable opening edges instead of transformed current roles", () => {
  const players = [player("wolf", "werewolf"), player("changed-god", "villager")];
  players.__winConditionMode = "slaughter_edge";
  players.__initialCivilianEdge = false;
  players.__initialGodEdge = true;
  assert.equal(checkWinner(players), "werewolf");
});

test("house rules allow multiple witches instead of rejecting duplicate witch setup", () => {
  const source = readFileSync(new URL("../src/house-rules.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /assertUniqueWitch/);
  assert.doesNotMatch(source, /女巫最多只能配置 1 名/);
  assert.match(source, /perWitchPotionsV2/);
  assert.match(source, /witchHealUsed/);
  assert.match(source, /witchPoisonUsed/);
});

test("multiple witches own independent antidote and poison inventories", () => {
  const state = multiWitchState();
  const room = new FakeHouseRoom(state);
  const [w1, w2] = state.players;

  assert.doesNotThrow(() => room.validateWitchAction(state, w1, { type: "heal" }));
  assert.doesNotThrow(() => room.validateWitchAction(state, w2, { type: "poison", targetId: "a" }));
  state.nightActions.witchActions = {
    w1: { type: "heal" },
    w2: { type: "poison", targetId: "a" }
  };
  room.finishNight(state);

  assert.equal(state.roleMemory.w1.witchHealUsed, true);
  assert.notEqual(state.roleMemory.w1.witchPoisonUsed, true);
  assert.equal(state.roleMemory.w2.witchPoisonUsed, true);
  assert.notEqual(state.roleMemory.w2.witchHealUsed, true);
  assert.deepEqual(room.kills, ["a"]);
  assert.equal(state.witchHealAvailable, true, "w2 still owns an unused antidote");
  assert.equal(state.witchPoisonAvailable, true, "w1 still owns an unused poison");

  assert.throws(() => room.validateWitchAction(state, w1, { type: "heal" }), /你的解藥已使用/);
  assert.doesNotThrow(() => room.validateWitchAction(state, w1, { type: "poison", targetId: "b" }));
  assert.throws(() => room.validateWitchAction(state, w2, { type: "poison", targetId: "b" }), /你的毒藥已使用/);
  assert.doesNotThrow(() => room.validateWitchAction(state, w2, { type: "heal" }));

  const w1View = room.projectState(state, "t-w1");
  const w2View = room.projectState(state, "t-w2");
  assert.equal(w1View.me.witchHealAvailable, false);
  assert.equal(w1View.me.witchPoisonAvailable, true);
  assert.equal(w2View.me.witchHealAvailable, true);
  assert.equal(w2View.me.witchPoisonAvailable, false);
});

test("two witches can both poison on the same night and both potions are consumed", () => {
  const state = multiWitchState();
  const room = new FakeHouseRoom(state);
  state.nightActions.witchActions = {
    w1: { type: "poison", targetId: "a" },
    w2: { type: "poison", targetId: "b" }
  };
  room.finishNight(state);
  assert.deepEqual(room.kills.sort(), ["a", "b"]);
  assert.equal(state.roleMemory.w1.witchPoisonUsed, true);
  assert.equal(state.roleMemory.w2.witchPoisonUsed, true);
  assert.equal(state.witchPoisonAvailable, false);
  assert.equal(state.witchHealAvailable, true);
});

test("legacy single-witch rooms preserve an already consumed potion during migration", () => {
  const state = multiWitchState();
  state.players = [state.players[0], ...state.players.slice(2)];
  state.witchHealAvailable = false;
  state.witchPoisonAvailable = true;
  const room = new FakeHouseRoom(state);
  const view = room.projectState(state, "t-w1");
  assert.equal(state.roleMemory.w1.witchHealUsed, true);
  assert.equal(view.me.witchHealAvailable, false);
  assert.equal(view.me.witchPoisonAvailable, true);
});

test("AI autonomy has hard conversation caps and never chains from AI chat", () => {
  const house = readFileSync(new URL("../src/house-rules.ts", import.meta.url), "utf8");
  const channels = readFileSync(new URL("../src/chat-channels.ts", import.meta.url), "utf8");
  assert.match(house, /MAX_PUBLIC_AI_REPLIES_PER_DAY = 2/);
  assert.match(house, /MAX_WOLF_AI_MESSAGES_PER_NIGHT = 2/);
  assert.match(house, /PUBLIC_CONTEXT_MESSAGES = 18/);
  assert.match(house, /command\?\.type !== "chat"/);
  assert.match(house, /actor\.isAI\) return/);
  assert.match(channels, /\.slice\(-12\)/);
});

test("wolf kill leader prefers wolf-king style roles before ordinary wolves", () => {
  const source = readFileSync(new URL("../src/house-rules.ts", import.meta.url), "utf8");
  const black = source.indexOf("black_wolf_king: 0");
  const white = source.indexOf("white_wolf_king: 1");
  const great = source.indexOf("great_wolf: 2");
  const ordinary = source.indexOf("werewolf: 3");
  assert.ok(black >= 0 && black < white && white < great && great < ordinary);
  assert.match(source, /return Boolean\(leaderId && actor\.id === leaderId\)/);
});

test("sheriff pseudo-ballot memory is cleaned after vote settlement", () => {
  const source = readFileSync(new URL("../src/house-rules.ts", import.meta.url), "utf8");
  assert.match(source, /proto\.finishVote = function/);
  assert.match(source, /key\.endsWith\(suffix\)/);
  assert.match(source, /delete state\.roleMemory\[key\]/);
});
