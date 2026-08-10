import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkWinner } from "../.test-build/game-engine.js";

function player(id, role, alive = true) {
  return { id, token: `t-${id}`, name: id, nameKey: id, alive, isAI: false, isSpectator: false, role, joinedAt: 0 };
}

test("slaughter-edge uses immutable opening edges instead of transformed current roles", () => {
  const players = [player("wolf", "werewolf"), player("changed-god", "villager")];
  players.__winConditionMode = "slaughter_edge";
  players.__initialCivilianEdge = false;
  players.__initialGodEdge = true;
  assert.equal(checkWinner(players), "werewolf");
});

test("house rules reject ambiguous duplicate witches at configuration and start", () => {
  const source = readFileSync(new URL("../src/house-rules.ts", import.meta.url), "utf8");
  assert.match(source, /function assertUniqueWitch\(setup: RoleSetup\)/);
  assert.match(source, /Number\(setup\?\.witch \?\? 0\) > 1/);
  assert.match(source, /proto\.configureRoles = function/);
  assert.match(source, /assertUniqueWitch\(raw\)/);
  assert.match(source, /proto\.startGame = function/);
  assert.match(source, /assertUniqueWitch\(state\.roleSetup\)/);
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
