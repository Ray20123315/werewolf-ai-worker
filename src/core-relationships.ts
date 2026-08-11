import { roleActionPrompt } from "./game-engine.js";
import { formalLiving } from "./core-state.js";
import type { RuntimeSettings } from "./core-state.js";
import type { ChatMessage, GameState, Player, RoleActionSubmission } from "./types.js";

type RoomPrototype = Record<string, any> & { __coreRelationshipRulesInstalled?: boolean };
type RuntimeMessage = ChatMessage & { channel?: "public" | "werewolf" | "lovers"; audienceIds?: string[] };
type RuntimePlayer = Player & { addonRoles?: string[] };

export function installCoreRelationshipRules(GameRoomCtor: { prototype: RoomPrototype }): void {
  const proto = GameRoomCtor.prototype;
  if (proto.__coreRelationshipRulesInstalled) return;
  proto.__coreRelationshipRulesInstalled = true;

  const originalRequireState = proto.requireState;
  const originalSubmitRoleActionInternal = proto.submitRoleActionInternal;
  const originalResolveNightRoleAction = proto.resolveNightRoleAction;
  const originalKillPlayer = proto.killPlayer;
  const originalProjectState = proto.projectState;
  const originalHandleClientMessage = proto.handleClientMessage;

  if (typeof originalRequireState === "function") {
    proto.requireState = function (): GameState {
      const state = originalRequireState.call(this) as GameState;
      if (state?.roleMemory && Array.isArray(state.players)) migrateLegacyLoverPairs(this, state);
      return state;
    };
  }

  if (typeof originalSubmitRoleActionInternal === "function") {
    proto.submitRoleActionInternal = function (state: GameState, actor: Player, effect: string, targetIds: string[], option?: string): void {
      if (effect !== "link_lovers" || actor.role !== "cupid") return originalSubmitRoleActionInternal.call(this, state, actor, effect, targetIds, option);
      const prompt = roleActionPrompt(actor, state);
      if (!prompt || prompt.effect !== "link_lovers" || prompt.timing !== "night") throw new Error("目前不能使用邱比特配對");
      if (prompt.oncePerGame && option === "__pass__") {
        state.nightActions.roleActions[actor.id] = { effect: "link_lovers", targetIds: [], option, submittedAt: Date.now() } as RoleActionSubmission;
        return;
      }
      const expected = effectiveLoverGroupSize(state);
      const unique = [...new Set(targetIds)];
      if (unique.length !== expected) throw new Error(`邱比特必須選擇 ${expected} 名不同玩家組成一組 CP`);
      const legal = new Set(formalLiving(state).map((player) => player.id));
      if (unique.some((id) => !legal.has(id))) throw new Error("邱比特配對目標無效");
      if (unique.some((id) => loverGroupMembers(state, id).length > 0)) throw new Error("同一名玩家不能同時加入兩組 CP");
      state.nightActions.roleActions[actor.id] = { effect: "link_lovers", targetIds: unique, submittedAt: Date.now() } as RoleActionSubmission;
      roomMem(this, state, actor.id).cupidLinkedIds = unique;
      roomMem(this, state, actor.id)["used:link_lovers"] = true;
    };
  }

  if (typeof originalResolveNightRoleAction === "function") {
    proto.resolveNightRoleAction = function (state: GameState, actor: Player, action: RoleActionSubmission): void {
      if (action.effect !== "link_lovers") return originalResolveNightRoleAction.call(this, state, actor, action);
      if (action.option === "__pass__" || !action.targetIds.length) return;
      createLoverGroup(this, state, actor, action.targetIds);
    };
  }

  if (typeof originalKillPlayer === "function") {
    proto.killPlayer = function (state: GameState, targetId: string, reason: string, killerId?: string, bypassProtection = false): boolean {
      const groupId = loverGroupId(state, targetId);
      const members = loverGroupMembers(state, targetId);
      const killed = originalKillPlayer.call(this, state, targetId, reason, killerId, bypassProtection) as boolean;
      if (!killed || !groupId || members.length < 2) return killed;
      const system = roomSystemMem(this, state);
      if (system.activeLoverCascadeGroup === groupId) return killed;
      system.activeLoverCascadeGroup = groupId;
      try {
        for (const memberId of members) {
          if (memberId === targetId) continue;
          const member = state.players.find((player) => player.id === memberId && player.alive && !player.isSpectator && !player.kickedAt);
          if (member) this.killPlayer(state, member.id, "lover_group", targetId, true);
        }
      } finally {
        delete system.activeLoverCascadeGroup;
      }
      return killed;
    };
  }

  if (typeof originalProjectState === "function") {
    proto.projectState = function (state: GameState, token: string): any {
      const view = originalProjectState.call(this, state, token);
      if (!view?.me) return view;
      const me = this.playerByToken(state, token) as Player;
      const group = loverGroupMembers(state, me.id);
      if (group.length >= 2) {
        view.me.loverGroupIds = group;
        if (livingLoverAudience(state, me).length >= 2) view.chatChannels = Array.from(new Set([...(view.chatChannels ?? ["public"]), "lovers"]));
      }
      const linked = roomMem(this, state, me.id).cupidLinkedIds;
      if (me.role === "cupid" && Array.isArray(linked)) view.me.cupidLinkedIds = [...linked];
      return view;
    };
  }

  if (typeof originalHandleClientMessage === "function") {
    proto.handleClientMessage = async function (token: string, command: any): Promise<void> {
      const state = this.requireState() as GameState;
      const actor = this.playerByToken(state, token) as Player;
      if (command?.type === "chat" && command.channel === "lovers" && loverGroupMembers(state, actor.id).length >= 2) {
        return sendLoverGroupChat(this, state, actor, String(command.content ?? ""));
      }
      return originalHandleClientMessage.call(this, token, command);
    };
  }
}

export function effectiveLoverGroupSize(state: GameState): number {
  const configured = Number((state.settings as RuntimeSettings).loverGroupSize ?? 2);
  const normalized = Number.isFinite(configured) ? Math.max(2, Math.min(50, Math.floor(configured))) : 2;
  return Math.min(normalized, Math.max(2, formalLiving(state).length));
}

export function loverGroupMembers(state: GameState, playerId: string): string[] {
  const memory = state.roleMemory[playerId];
  const groupId = typeof memory?.loverGroupId === "string" ? memory.loverGroupId : undefined;
  const raw = Array.isArray(memory?.loverGroupMembers) ? memory.loverGroupMembers.filter((id): id is string => typeof id === "string") : [];
  if (!groupId || raw.length < 2) return [];
  return [...new Set(raw)].filter((id) => state.roleMemory[id]?.loverGroupId === groupId && state.players.some((player) => player.id === id && !player.kickedAt));
}

export function availableUnlinkedLoverTargets(state: GameState): Player[] {
  return formalLiving(state).filter((player) => loverGroupMembers(state, player.id).length === 0);
}

function loverGroupId(state: GameState, playerId: string): string | undefined {
  const value = state.roleMemory[playerId]?.loverGroupId;
  return typeof value === "string" ? value : undefined;
}

function createLoverGroup(room: any, state: GameState, cupid: Player, rawMembers: string[]): void {
  const members = [...new Set(rawMembers)].filter((id) => formalLiving(state).some((player) => player.id === id));
  const expected = effectiveLoverGroupSize(state);
  if (members.length !== expected) return;
  const groupId = `cp:${state.round}:${cupid.id}:${crypto.randomUUID()}`;
  for (const memberId of members) {
    const memory = roomMem(room, state, memberId);
    memory.loverGroupId = groupId;
    memory.loverGroupMembers = [...members];
    const player = state.players.find((item) => item.id === memberId) as RuntimePlayer | undefined;
    if (player) {
      const addons = Array.isArray(player.addonRoles) ? player.addonRoles.filter((value) => typeof value === "string") : [];
      if (!addons.includes("lover")) addons.push("lover");
      player.addonRoles = addons;
    }
  }
  roomMem(room, state, cupid.id).cupidLinkedIds = [...members];
  state.roleResults[cupid.id] ??= {};
  state.roleResults[cupid.id]!["cupid:group"] = `已配對：${members.map((id) => state.players.find((player) => player.id === id)?.name ?? id).join("、")}`;
}

function migrateLegacyLoverPairs(room: any, state: GameState): void {
  for (const player of state.players) {
    const memory = roomMem(room, state, player.id);
    if (typeof memory.loverGroupId === "string") continue;
    const loverId = memory.lover;
    if (typeof loverId !== "string") continue;
    const other = state.players.find((candidate) => candidate.id === loverId);
    if (!other) continue;
    const otherMemory = roomMem(room, state, other.id);
    if (otherMemory.lover !== player.id) continue;
    const members = [player.id, other.id].sort();
    const groupId = `legacy:${members.join(":")}`;
    memory.loverGroupId = groupId;
    memory.loverGroupMembers = [...members];
    otherMemory.loverGroupId = groupId;
    otherMemory.loverGroupMembers = [...members];
  }
}

function livingLoverAudience(state: GameState, actor: Player): string[] {
  return loverGroupMembers(state, actor.id).filter((id) => state.players.some((player) => player.id === id && player.alive && !player.isSpectator && !player.kickedAt));
}

function sendLoverGroupChat(room: any, state: GameState, actor: Player, raw: string): void {
  if (!actor.alive || actor.isSpectator || actor.kickedAt) throw new Error("只有存活的正式玩家可以使用情侶秘密聊天室");
  const audienceIds = livingLoverAudience(state, actor);
  if (audienceIds.length < 2) throw new Error("你目前沒有可用的情侶秘密聊天室");
  const message = room.chatMessage(state, actor, room.normalizeChat(raw)) as RuntimeMessage;
  message.channel = "lovers";
  message.audienceIds = audienceIds;
  state.messages.push(message);
  room.trimMessages(state);
  room.saveBroadcast(state);
}

function roomMem(room: any, state: GameState, playerId: string): Record<string, any> {
  if (typeof room?.mem === "function") return room.mem(state, playerId) as Record<string, any>;
  state.roleMemory[playerId] ??= {};
  return state.roleMemory[playerId] as Record<string, any>;
}

function roomSystemMem(room: any, state: GameState): Record<string, any> {
  if (typeof room?.systemMem === "function") return room.systemMem(state) as Record<string, any>;
  return roomMem(room, state, "__system");
}
