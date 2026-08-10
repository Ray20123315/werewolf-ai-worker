import { playerFaction } from "./game-engine";
import type { AppLocale, ChatMessage, GameState, Player } from "./types";

type ChatChannel = "public" | "werewolf" | "lovers";
type RuntimeMessage = ChatMessage & {
  channel?: ChatChannel;
  audienceIds?: string[];
};
type RoomPrototype = Record<string, any> & { __chatChannelsInstalled?: boolean };

export function installChatChannels(GameRoomCtor: { prototype: RoomPrototype }): void {
  const proto = GameRoomCtor.prototype;
  if (proto.__chatChannelsInstalled) return;
  proto.__chatChannelsInstalled = true;

  const originalHandleClientMessage = proto.handleClientMessage;
  const originalProjectState = proto.projectState;
  const originalPublicContext = proto.publicContext;
  const originalPrivateContext = proto.privateContext;

  proto.handleClientMessage = async function (token: string, command: any): Promise<void> {
    if (command?.type === "chat" && command.channel && command.channel !== "public") {
      return sendSecretChat.call(this, token, command.content, command.locale, command.channel);
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
    const loverId = reciprocalLivingLoverId(state, me);
    if (loverId) view.me.loverId = loverId;
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
      .slice(-20)
      .map((message) => `${message.channel === "werewolf" ? "狼人密聊" : "情侶密聊"}｜${message.playerName}: ${message.content}`)
      .join("\n");
    return secret ? `${base}\n依法可見的秘密聊天：\n${secret}` : base;
  };
}

function sendSecretChat(this: any, token: string, content: string, locale: AppLocale | undefined, channel: ChatChannel): void {
  const state = this.requireState() as GameState;
  const actor = this.playerByToken(state, token) as Player;
  if (!actor.alive || actor.isSpectator) throw new Error("只有存活的正式玩家可以使用秘密聊天");

  const audienceIds = channel === "werewolf"
    ? werewolfAudience(this, state, actor)
    : channel === "lovers"
      ? loversAudience(state, actor)
      : [];
  if (audienceIds.length < 2) throw new Error(channel === "werewolf" ? "你目前沒有可用的狼人秘密聊天室" : "你目前沒有可用的情侶秘密聊天室");

  const message = this.chatMessage(
    state,
    actor,
    this.normalizeChat(content),
    this.normalizeMessageLocale(locale)
  ) as RuntimeMessage;
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

function reciprocalLivingLoverId(state: GameState, actor: Player): string | undefined {
  const loverId = state.roleMemory[actor.id]?.lover;
  if (typeof loverId !== "string") return undefined;
  const lover = state.players.find((player) => player.id === loverId && player.alive && !player.isSpectator && !player.kickedAt);
  if (!lover) return undefined;
  return state.roleMemory[lover.id]?.lover === actor.id ? lover.id : undefined;
}

function canViewMessage(viewerId: string, message: RuntimeMessage): boolean {
  if (!message.channel || message.channel === "public") return true;
  return Array.isArray(message.audienceIds) && message.audienceIds.includes(viewerId);
}
