import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installChatChannels } from "../.test-build/chat-channels.js";
import { installRelationshipRules } from "../.test-build/relationship-rules.js";
import { ROLE_IDS } from "../.test-build/types.js";
import { WORD_ROLE_IDS, unsupportedWordRoleIds } from "../.test-build/word-role-allowlist.js";

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
  projectState(state, token) { const me = this.playerByToken(state, token); return { messages: [...state.messages], players: state.players.map(({ token: _token, role: _role, ...p }) => p), me: { id: me.id, alive: me.alive, isSpectator: me.isSpectator } }; }
  publicContext(state) { return state.messages.map((m) => m.content).join("|"); }
  privateContext(state, actor) { return `${this.publicContext(state)}::${actor.id}`; }
}

// This unit fake validates chat-channel isolation only. House-rule behavior has
// separate engine/browser regression coverage and needs a full GameRoom shape.
FakeRoom.prototype.__houseRulesInstalled = true;
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

test("lover identity remains privately known after a partner dies but secret chat closes", () => {
  const room = new FakeRoom();
  room.state = baseState();
  room.state.players.find((p) => p.id === "a").alive = false;
  const cView = room.projectState(room.state, "t-c");
  assert.equal(cView.me.loverId, "a");
  assert.deepEqual(cView.chatChannels, ["public"]);
});

test("Cupid privately receives the exact linked pair and other viewers do not", () => {
  const room = new FakeRoom();
  const cupid = player("cup", "cupid");
  const a = player("a", "villager");
  const b = player("b", "werewolf");
  room.state = { phase: "night", round: 1, players: [cupid, a, b], messages: [], roleMemory: { cup: { cupidLinkedIds: ["a", "b"] }, a: { lover: "b" }, b: { lover: "a" } } };
  assert.deepEqual(room.projectState(room.state, "t-cup").me.cupidLinkedIds, ["a", "b"]);
  assert.equal(room.projectState(room.state, "t-a").me.cupidLinkedIds, undefined);
  assert.equal(room.projectState(room.state, "t-b").me.cupidLinkedIds, undefined);
});

test("relationship runtime records a successful Cupid submission only for Cupid", () => {
  class RelationshipRoom {
    mem(state, id) { state.roleMemory[id] ??= {}; return state.roleMemory[id]; }
    submitRoleActionInternal(state, actor, effect, targetIds) {
      if (effect === "link_lovers") {
        this.mem(state, targetIds[0]).lover = targetIds[1];
        this.mem(state, targetIds[1]).lover = targetIds[0];
      }
    }
  }
  installRelationshipRules(RelationshipRoom);
  const cupid = player("cup", "cupid");
  const a = player("a", "villager");
  const b = player("b", "werewolf");
  const state = { players: [cupid, a, b], roleMemory: {} };
  const room = new RelationshipRoom();
  room.submitRoleActionInternal(state, cupid, "link_lovers", ["a", "b"]);
  assert.deepEqual(state.roleMemory.cup.cupidLinkedIds, ["a", "b"]);
  assert.equal(state.roleMemory.a.lover, "b");
  assert.equal(state.roleMemory.b.lover, "a");
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

test("frontend channel controller shows viewer-private relationship feedback without replacing WebSocket", () => {
  const source = readFileSync(new URL("../public/chat-channels.js", import.meta.url), "utf8");
  assert.match(source, /zh-TW/);
  assert.match(source, /zh-CN/);
  assert.match(source, /Werewolf/);
  assert.match(source, /Lovers/);
  assert.match(source, /cupidLinkedIds/);
  assert.match(source, /privateRelationshipNotice/);
  assert.match(source, /你的戀人/);
  assert.match(source, /邱比特配對/);
  assert.match(source, /channelSocket\.send\(JSON\.stringify\(\{ type: "chat", content, channel \}\)\)/);
  assert.match(source, /const socket = new WebSocket\(/);
  assert.doesNotMatch(source, /window\.WebSocket\s*=/);
  assert.doesNotMatch(source, /extends\s+NativeWebSocket/);
  assert.match(source, /element\.disabled !== disabled/);
});

test("generic speech and skill cards are neutral while relationship badges use separate semantics", () => {
  const css = readFileSync(new URL("../public/ui-fixes.css", import.meta.url), "utf8");
  assert.match(css, /\.message-speech,\s*\.role-skill \{ border-left-color: var\(--line\) !important; \}/);
  assert.match(css, /\.pill\.private-relationship\.lover-private/);
  assert.match(css, /\.pill\.private-relationship\.cupid-private/);
});

test("runtime canonical role ids are restricted to the audited Word product allowlist", () => {
  const canonicalRoleIds = ROLE_IDS.filter((id) => id !== "confirmed_villager");
  assert.deepEqual([...WORD_ROLE_IDS].sort(), [...canonicalRoleIds].sort());
  assert.deepEqual(unsupportedWordRoleIds(canonicalRoleIds), []);
  assert.equal(WORD_ROLE_IDS.includes("confirmed_villager"), false);
  assert.equal(new Set(WORD_ROLE_IDS).size, WORD_ROLE_IDS.length);
});
