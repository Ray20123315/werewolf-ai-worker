import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installChatChannels } from "../.test-build/chat-channels.js";

function player(id, role, token = `t-${id}`) {
  return { id, token, name: id, nameKey: id, alive: true, isAI: false, isSpectator: false, role, joinedAt: 0 };
}

class FakeRoom {
  constructor() { this.saved = 0; this.publicCalls = 0; }
  requireState() { return this.state; }
  playerByToken(state, token) { return state.players.find((p) => p.token === token); }
  wolfTeammates(state, actor) { return state.players.filter((p) => p.id !== actor.id && p.alive && p.role === "werewolf"); }
  normalizeChat(content) { return String(content).trim(); }
  normalizeMessageLocale(locale) { return locale === "en" || locale === "zh-CN" ? locale : "zh-TW"; }
  chatMessage(state, actor, content, sourceLocale) { return { id: `${state.messages.length + 1}`, playerId: actor.id, playerName: actor.name, content, sourceLocale, kind: "chat", createdAt: 1, round: state.round, phase: state.phase }; }
  trimMessages() {}
  saveBroadcast() { this.saved += 1; }
  async handleClientMessage(_token, _command) { this.publicCalls += 1; }
  projectState(state, token) { const me = this.playerByToken(state, token); return { messages: [...state.messages], me: { id: me.id, alive: me.alive, isSpectator: me.isSpectator } }; }
  publicContext(state) { return state.messages.map((m) => m.content).join("|"); }
  privateContext(state, actor) { return `${this.publicContext(state)}::${actor.id}`; }
}

installChatChannels(FakeRoom);

function baseState() {
  const a = player("a", "werewolf");
  const b = player("b", "werewolf");
  const c = player("c", "villager");
  return {
    phase: "night", round: 1, players: [a, b, c], messages: [], roleMemory: { a: { lover: "c" }, c: { lover: "a" } }
  };
}

test("werewolf chat is only projected to known wolf participants", async () => {
  const room = new FakeRoom();
  room.state = baseState();
  await room.handleClientMessage("t-a", { type: "chat", channel: "werewolf", content: "刀誰？", locale: "zh-TW" });
  assert.equal(room.state.messages.length, 1);
  assert.equal(room.state.messages[0].channel, "werewolf");
  assert.equal(room.state.messages[0].sourceLocale, undefined);
  assert.equal(room.projectState(room.state, "t-a").messages.length, 1);
  assert.equal(room.projectState(room.state, "t-b").messages.length, 1);
  assert.equal(room.projectState(room.state, "t-c").messages.length, 0);
  assert.deepEqual(room.projectState(room.state, "t-a").chatChannels, ["public", "werewolf", "lovers"]);
});

test("lovers chat is only projected to the reciprocal living pair", async () => {
  const room = new FakeRoom();
  room.state = baseState();
  await room.handleClientMessage("t-c", { type: "chat", channel: "lovers", content: "我相信你", locale: "zh-TW" });
  assert.equal(room.projectState(room.state, "t-a").messages.length, 1);
  assert.equal(room.projectState(room.state, "t-c").messages.length, 1);
  assert.equal(room.projectState(room.state, "t-b").messages.length, 0);
  assert.equal(room.projectState(room.state, "t-c").me.loverId, "a");
});

test("unauthorized players cannot write secret channels", async () => {
  const room = new FakeRoom();
  room.state = baseState();
  await assert.rejects(() => room.handleClientMessage("t-c", { type: "chat", channel: "werewolf", content: "偷聽", locale: "zh-TW" }), /狼人秘密聊天室/);
});

test("public AI context excludes secret messages while private context can include authorized secrets", async () => {
  const room = new FakeRoom();
  room.state = baseState();
  await room.handleClientMessage("t-a", { type: "chat", channel: "werewolf", content: "狼密", locale: "zh-TW" });
  room.state.messages.push({ id: "p", playerName: "c", content: "公開", kind: "chat", createdAt: 2, round: 1, phase: "night" });
  assert.equal(room.publicContext(room.state), "公開");
  assert.match(room.privateContext(room.state, room.state.players[0]), /狼密/);
  assert.doesNotMatch(room.privateContext(room.state, room.state.players[2]), /狼密/);
});

test("frontend channel controller contains stable currentTarget reset fix and translated channel labels", () => {
  const source = readFileSync(new URL("../public/chat-channels.js", import.meta.url), "utf8");
  assert.match(source, /currentTarget.*aiForm/s);
  assert.match(source, /zh-TW/);
  assert.match(source, /zh-CN/);
  assert.match(source, /Werewolf/);
  assert.match(source, /Lovers/);
  assert.match(source, /payload\.channel/);
});
