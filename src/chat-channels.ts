import { installAIFlowRules } from "./ai-flow.js";
import { installAISanityRules } from "./ai-sanity.js";
import { installAddonIdentityRules } from "./addon-identities.js";
import { installCoreRules } from "./core-rules.js";
import { installEqualVoteRules } from "./equal-vote.js";
import { playerFaction } from "./game-engine.js";
import { installHouseRules } from "./house-rules.js";
import { installInspectionRules } from "./inspection-rules.js";
import { installRelationshipRules } from "./relationship-rules.js";
import { installRuntimeIntegrityRules } from "./runtime-integrity.js";
import { installOfficialSourceRules } from "./source-rules.js";
import { ROLE_IDS } from "./types.js";
import type { ChatMessage, GameState, Player } from "./types.js";
import { unsupportedWordRoleIds } from "./word-role-allowlist.js";

type ChatChannel = "public" | "werewolf" | "lovers";
type RuntimeMessage = ChatMessage & {
  channel?: ChatChannel;
  audienceIds?: string[];
};
type RoomPrototype = Record<string, any> & { __chatChannelsInstalled?: boolean };

export function installChatChannels(GameRoomCtor: { prototype: RoomPrototype }): void {
  const proto = GameRoomCtor.prototype;
  if (proto.__chatChannelsInstalled) return;
  // Gold Water is a user-explicit product removal. Keep its legacy type id only
  // for old-room migration; it must not participate in the canonical source guard.
  const canonicalRoleIds = ROLE_IDS.filter((id) => id !== "confirmed_villager");
  const unsupported = unsupportedWordRoleIds(canonicalRoleIds);
  if (unsupported.length) throw new Error(`角色不在酷米家族 Word 白名單：${unsupported.join(", ")}`);
  proto.__chatChannelsInstalled = true;

  const originalHandleClientMessage = proto.handleClientMessage;
  const originalProjectState = proto.projectState;
  const originalPublicContext = proto.publicContext;
  const originalPrivateContext = proto.privateContext;

  proto.handleClientMessage = async function (token: string, command: any): Promise<void> {
    if (command?.type === "chat" && command.channel && command.channel !== "public") {
      return sendSecretChat.call(this, token, command.content, command.channel);
    }
    return originalHandleClientMessage.call(this, token, command);
  };

  proto.projectState = function (state: GameState, token: string): any {
    const view = originalProjectState.call(this, state, token);
    const me = this.playerByToken(state, token) as Player;
    view.messages = (view.messages as RuntimeMessage[])
      .filter((message) => canViewMessage(me.id, message))
      .map(({ audienceIds: _audienceIds, ...message }) => message);
    view.chatChannels = availableChannels(this, state, me);

    const loverId = reciprocalLoverId(state, me);
    if (loverId) view.me.loverId = loverId;

    if (me.role === "cupid") {
      const linkedIds = asValidPair(state, state.roleMemory[me.id]?.cupidLinkedIds);
      if (linkedIds) view.me.cupidLinkedIds = linkedIds;
    }
    return view;
  };

  proto.publicContext = function (state: GameState): string {
    const allMessages = state.messages;
    state.messages = allMessages.filter((message) => {
      const runtime = message as RuntimeMessage;
      return !runtime.channel || runtime.channel === "public";
    });
    try {
      return originalPublicContext.call(this, state);
    } finally {
      state.messages = allMessages;
    }
  };

  proto.privateContext = function (state: GameState, actor: Player): string {
    const base = originalPrivateContext.call(this, state, actor) as string;
    const secret = (state.messages as RuntimeMessage[])
      .filter((message) => message.channel && message.channel !== "public" && canViewMessage(actor.id, message))
      .slice(-12)
      .map((message) => `${message.channel === "werewolf" ? "狼人密聊" : "情侶密聊"}｜${message.playerName}: ${message.content}`)
      .join("\n");
    return secret ? `${base}\n依法可見的秘密聊天：\n${secret}` : base;
  };

  installHouseRules(GameRoomCtor);
  installEqualVoteRules(GameRoomCtor);
  installAIFlowRules(GameRoomCtor);
  installAISanityRules(GameRoomCtor);
  installAddonIdentityRules(GameRoomCtor);
  installOfficialSourceRules(GameRoomCtor);
  installInspectionRules(GameRoomCtor);
  installRelationshipRules(GameRoomCtor);
  installCoreRules(GameRoomCtor);
  // Final composed-runtime invariant layer. It must be installed last so it can
  // reconcile phase/death/night/AI behavior after every legacy compatibility layer.
  installRuntimeIntegrityRules(GameRoomCtor);
}

function sendSecretChat(this: any, token: string, content: string, channel: ChatChannel): void {
  const state = this.requireState() as GameState;
  const actor = this.playerByToken(state, token) as Player;
  if (!actor.alive || actor.isSpectator) throw new Error("只有存活的正式玩家可以使用秘密聊天");

  const audienceIds = channel === "werewolf"
    ? werewolfAudience(this, state, actor)
    : channel === "lovers"
      ? loversAudience(state, actor)
      : [];
  if (audienceIds.length < 2) throw new Error(channel === "werewolf" ? "你目前沒有可用的狼人秘密聊天室" : "你目前沒有可用的情侶秘密聊天室");

  const message = this.chatMessage(state, actor, this.normalizeChat(content)) as RuntimeMessage;
  message.channel = channel;
  message.audienceIds = audienceIds;
  state.messages.push(message);
  this.trimMessages(state);
  this.saveBroadcast(state);
}

function availableChannels(room: any, state: GameState, actor: Player): ChatChannel[] {
  const channels: ChatChannel[] = ["public"];
  if (!actor.alive || actor.isSpectator) return channels;
  if (werewolfAudience(room, state, actor).length >= 2) channels.push("werewolf");
  if (loversAudience(state, actor).length === 2) channels.push("lovers");
  return channels;
}

function werewolfAudience(room: any, state: GameState, actor: Player): string[] {
  if (playerFaction(actor) !== "werewolf") return [];
  const teammates = room.wolfTeammates(state, actor) as Player[];
  if (!teammates.length) return [];
  return [actor.id, ...teammates.map((player) => player.id)];
}

function loversAudience(state: GameState, actor: Player): string[] {
  const loverId = reciprocalLivingLoverId(state, actor);
  return loverId ? [actor.id, loverId] : [];
}

function reciprocalLoverId(state: GameState, actor: Player): string | undefined {
  const loverId = state.roleMemory[actor.id]?.lover;
  if (typeof loverId !== "string") return undefined;
  const lover = state.players.find((player) => player.id === loverId && !player.isSpectator && !player.kickedAt);
  if (!lover) return undefined;
  return state.roleMemory[lover.id]?.lover === actor.id ? lover.id : undefined;
}

function reciprocalLivingLoverId(state: GameState, actor: Player): string | undefined {
  if (!actor.alive || actor.isSpectator || actor.kickedAt) return undefined;
  const loverId = reciprocalLoverId(state, actor);
  if (!loverId) return undefined;
  return state.players.some((player) => player.id === loverId && player.alive && !player.isSpectator && !player.kickedAt) ? loverId : undefined;
}

function asValidPair(state: GameState, value: unknown): [string, string] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = [...new Set(value.filter((item): item is string => typeof item === "string"))]
    .filter((id) => state.players.some((player) => player.id === id && !player.isSpectator && !player.kickedAt));
  return ids.length === 2 ? [ids[0]!, ids[1]!] : undefined;
}

function canViewMessage(viewerId: string, message: RuntimeMessage): boolean {
  if (!message.channel || message.channel === "public") return true;
  return Array.isArray(message.audienceIds) && message.audienceIds.includes(viewerId);
}
