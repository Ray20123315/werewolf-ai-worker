import { countsAsAliveForDeathGate } from "./core-fake-death.js";
import { roleActionPrompt } from "./game-engine.js";
import { roleDefinition } from "./roles.js";
import type { GameState, Player, RoleActionPrompt } from "./types.js";

type RoomPrototype = Record<string, any> & { __post28FinalizeInstalled?: boolean };

export function installPost28FinalizeRules(GameRoomCtor: { prototype: RoomPrototype }): void {
  const proto = GameRoomCtor.prototype;
  if (proto.__post28FinalizeInstalled) return;
  proto.__post28FinalizeInstalled = true;

  const originalFinishNight = proto.finishNight;
  const originalPendingAITask = proto.pendingAITask;
  const originalSubmitRoleActionInternal = proto.submitRoleActionInternal;

  if (typeof originalFinishNight === "function") {
    proto.finishNight = function (state: GameState): void {
      const pending = pendingCopiedNightActors(this, state);
      if (pending.length) {
        this.saveBroadcast(state);
        return;
      }
      return originalFinishNight.call(this, state);
    };
  }

  if (typeof originalPendingAITask === "function") {
    proto.pendingAITask = function (state: GameState): any {
      const base = originalPendingAITask.call(this, state);
      if (base) return base;
      const actor = pendingCopiedNightActors(this, state).find((player) => player.isAI && player.ai);
      return actor ? { playerId: actor.id, operation: "role_action" } : undefined;
    };
  }

  if (typeof originalSubmitRoleActionInternal === "function") {
    proto.submitRoleActionInternal = function (state: GameState, actor: Player, rawEffect: string, targetIds: string[], option?: string): void {
      const effect = actor.role === "elder_wolf" && rawEffect === "strong_kill" ? "elder_force_dawn" : rawEffect;
      if (state.phase !== "night" && consumeImmediateSkillBlock(this, state, actor, effect)) {
        const prompt = promptForEffect(this, state, actor, effect);
        if (prompt?.oncePerGame) this.mem(state, actor.id)[`used:${rawEffect}`] = true;
        state.roleResults[actor.id] ??= {};
        state.roleResults[actor.id]![`disabled:${state.round}:${Date.now()}`] = "本次主動技能受到『下一次技能失效』效果影響，已消耗封鎖並使本次技能無效。";
        this.saveBroadcast(state);
        return;
      }
      return originalSubmitRoleActionInternal.call(this, state, actor, effect, targetIds, option);
    };
  }
}

function pendingCopiedNightActors(room: any, state: GameState): Player[] {
  if (state.phase !== "night") return [];
  return state.players.filter((player) => {
    if (!player.alive || player.isSpectator || player.kickedAt || player.role !== "vampire_wolf_copy") return false;
    if (state.nightActions.roleActions[player.id]) return false;
    return copiedPrompt(room, state, player)?.timing === "night";
  });
}

function copiedPrompt(room: any, state: GameState, actor: Player): RoleActionPrompt | undefined {
  const memory = room.mem(state, actor.id) as Record<string, any>;
  const copiedRole = typeof memory.copiedRole === "string" ? memory.copiedRole : undefined;
  const sourceId = typeof memory.copiedSourceId === "string" ? memory.copiedSourceId : undefined;
  if (!copiedRole || !sourceId) return undefined;
  const source = state.players.find((player) => player.id === sourceId);
  if (!source || !countsAsAliveForDeathGate(state, source)) return undefined;
  const definition = roleDefinition(copiedRole as any);
  const action = definition?.action;
  if (!action || action.timing === "reaction" || action.timing === "setup" || action.timing === "sheriff") return undefined;
  if (action.fromRound && state.round < action.fromRound) return undefined;
  if (action.oncePerGame && memory.copiedAbilityUsed === true) return undefined;
  const timingMatches = (action.timing === "night" && state.phase === "night") || (action.timing === "day" && state.phase === "debate") || (action.timing === "vote" && state.phase === "vote");
  if (!timingMatches) return undefined;
  return {
    role: actor.role!,
    timing: action.timing,
    effect: action.effect,
    targetMode: action.targetMode,
    ...(action.options ? { options: action.options } : {}),
    ...(action.oncePerGame ? { oncePerGame: true } : {}),
    label: `吸血狼複製：${definition.name}`,
    description: definition.summary
  };
}

function promptForEffect(room: any, state: GameState, actor: Player, effect: string): RoleActionPrompt | undefined {
  const native = roleActionPrompt(actor, state);
  if (native?.effect === effect || (actor.role === "elder_wolf" && effect === "elder_force_dawn" && native?.effect === "strong_kill")) return native;
  const copied = copiedPrompt(room, state, actor);
  return copied?.effect === effect ? copied : undefined;
}

function consumeImmediateSkillBlock(room: any, state: GameState, actor: Player, effect: string): boolean {
  const prompt = promptForEffect(room, state, actor, effect);
  if (!prompt) return false;
  const memory = room.mem(state, actor.id) as Record<string, any>;
  const actionOnly = Number(memory.nextActionDisabledCount ?? 0);
  if (actionOnly > 0) {
    memory.nextActionDisabledCount = actionOnly - 1;
    return true;
  }
  const combined = Number(memory.nextActionOrVoteDisabledCount ?? 0);
  if (combined > 0) {
    memory.nextActionOrVoteDisabledCount = combined - 1;
    return true;
  }
  return false;
}
