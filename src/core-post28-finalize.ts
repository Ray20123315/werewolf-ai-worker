import { countsAsAliveForDeathGate, isRealDeadForDeathGate } from "./core-fake-death.js";
import { playerFaction, roleActionPrompt } from "./game-engine.js";
import { roleDefinition } from "./roles.js";
import type { GameState, Player, RoleActionPrompt, RoleActionSubmission } from "./types.js";

type RoomPrototype = Record<string, any> & { __post28FinalizeInstalled?: boolean };

type EffectiveAction = { actorId: string; effect: string; targetIds: string[] };

export function installPost28FinalizeRules(GameRoomCtor: { prototype: RoomPrototype }): void {
  const proto = GameRoomCtor.prototype;
  if (proto.__post28FinalizeInstalled) return;
  proto.__post28FinalizeInstalled = true;

  const originalFinishNight = proto.finishNight;
  const originalPendingAITask = proto.pendingAITask;
  const originalSubmitRoleActionInternal = proto.submitRoleActionInternal;
  const originalResolveNightRoleAction = proto.resolveNightRoleAction;
  const originalWolfTeammates = proto.wolfTeammates;
  const originalProjectState = proto.projectState;
  const originalAiSystemPrompt = proto.aiSystemPrompt;

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

      const restoreAlliance = effect === "magician_swap" && state.phase === "night" && magicianWillSwapRoles(state, targetIds)
        ? captureWinningAllegiances(this, state, targetIds)
        : undefined;
      const result = originalSubmitRoleActionInternal.call(this, state, actor, effect, targetIds, option);
      // The inner compatibility layer used to swap allegiance at submission time.
      // Restore it here; the actual swap now happens only if night resolution reaches the Magician action.
      if (restoreAlliance) restoreWinningAllegiances(this, state, targetIds, restoreAlliance);

      if (actor.role === "elder_wolf" && effect === "elder_force_dawn" && state.phase === "night") {
        const stored = state.nightActions.roleActions[actor.id];
        if (stored && stored.effect === ("elder_force_dawn" as any) && stored.targetIds[0]) {
          if (consumeNightSkillBlock(this, state, actor.id)) {
            delete state.nightActions.roleActions[actor.id];
            state.roleResults[actor.id] ??= {};
            state.roleResults[actor.id]![`disabled:${state.round}:${Date.now()}`] = "長老狼的本次技能受到『下一次技能失效』效果影響；封鎖已消耗，夜晚繼續。";
            this.saveBroadcast(state);
            return result;
          }
          resolveElderImmediately(this, state, actor, stored);
        }
      }
      return result;
    };
  }

  if (typeof originalResolveNightRoleAction === "function") {
    proto.resolveNightRoleAction = function (state: GameState, actor: Player, action: RoleActionSubmission): void {
      if (action.effect === "inspect_action" || action.effect === "observe_and_redirect") {
        const targetId = action.targetIds[0];
        const target = targetId ? state.players.find((player) => player.id === targetId) : undefined;
        if (target) this.storeRoleResult(state, actor, target, describeEffectiveActionNow(this, state, target.id));
        return;
      }
      if (action.effect === "kill_if_targeted_by_other") {
        const targetId = action.targetIds[0];
        if (targetId && wasEffectivelyTargetedNow(this, state, targetId, actor.id)) this.killPlayer(state, targetId, "shadow_wolf", actor.id);
        return;
      }
      if (action.effect === "magician_swap") {
        const shouldSwap = magicianWillSwapRoles(state, action.targetIds);
        const before = shouldSwap ? captureWinningAllegiances(this, state, action.targetIds) : undefined;
        const result = originalResolveNightRoleAction.call(this, state, actor, action);
        if (before) swapWinningAllegiances(this, state, action.targetIds, before);
        return result;
      }
      return originalResolveNightRoleAction.call(this, state, actor, action);
    };
  }

  // Secret-channel authorization must only contain real mechanical wolves.
  // Perception can be fooled (and Wise Wolf can filter it) without granting a village role wolf chat access.
  if (typeof originalWolfTeammates === "function") {
    proto.wolfTeammates = function (state: GameState, actor: Player): Player[] {
      return (originalWolfTeammates.call(this, state, actor) as Player[])
        .filter((player) => playerFaction(player) === "werewolf");
    };
  }

  if (typeof originalProjectState === "function") {
    proto.projectState = function (state: GameState, token: string): any {
      const view = originalProjectState.call(this, state, token);
      if (!view?.me) return view;
      const actor = this.playerByToken(state, token) as Player;
      if (playerFaction(actor) === "werewolf") {
        // This is the perceived roster only. Actual wolf chat still uses wolfTeammates(), which is mechanical-only above.
        view.me.wolfTeammates = wolfPerception(this, state, actor).map((player) => player.id);
      }
      return view;
    };
  }

  if (typeof originalAiSystemPrompt === "function") {
    proto.aiSystemPrompt = function (actor: Player, state: GameState): string {
      const base = originalAiSystemPrompt.call(this, actor, state) as string;
      if (playerFaction(actor) !== "werewolf") return base;
      const perceived = wolfPerception(this, state, actor).map((player) => player.name);
      return `${base}\n狼隊名單認知（可能受偽裝影響；慧狼會自動排除假隊友）：${perceived.length ? perceived.join("、") : "無"}。`;
    };
  }
}

function resolveElderImmediately(room: any, state: GameState, actor: Player, action: RoleActionSubmission): void {
  const targetId = action.targetIds[0];
  const target = targetId ? state.players.find((player) => player.id === targetId && player.alive && !player.isSpectator && !player.kickedAt) : undefined;
  if (!target) return;
  room.killPlayer(state, target.id, "elder_force_dawn", actor.id, true);
  room.addSystemMessage(state, `${actor.name}（長老狼）發動強制死亡；立即終止本夜，其餘尚未結算的夜間行動全部取消。`);
  state.nightActions.wolfVotes = {};
  state.nightActions.seerTargets = {};
  state.nightActions.guardTargets = {};
  state.nightActions.witchActions = {};
  state.nightActions.roleActions = {};
  // With all night submissions cleared this finishes only the dawn/status/terminal pipeline.
  room.finishNight(state);
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
  return consumeNightSkillBlock(room, state, actor.id);
}

function consumeNightSkillBlock(room: any, state: GameState, actorId: string): boolean {
  const memory = room.mem(state, actorId) as Record<string, any>;
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

function isActionDisabledNow(room: any, state: GameState, actorId: string): boolean {
  const memory = room.mem(state, actorId) as Record<string, any>;
  if (memory.disabledPermanently === true) return true;
  if (typeof memory.disabledUntilRound === "number" && memory.disabledUntilRound >= state.round) return true;
  const actor = state.players.find((player) => player.id === actorId);
  return Boolean(room.systemMem(state).goodSkillsDisabledRound === state.round && actor && playerFaction(actor) === "village");
}

function effectiveActionsNow(room: any, state: GameState): EffectiveAction[] {
  const out: EffectiveAction[] = [];
  for (const [actorId, action] of Object.entries(state.nightActions.roleActions)) {
    if (action.option === "__pass__" || isActionDisabledNow(room, state, actorId)) continue;
    out.push({ actorId, effect: action.effect, targetIds: [...action.targetIds] });
  }
  for (const [actorId, targetId] of Object.entries(state.nightActions.seerTargets)) if (!isActionDisabledNow(room, state, actorId)) out.push({ actorId, effect: "inspect_team", targetIds: [targetId] });
  for (const [actorId, targetId] of Object.entries(state.nightActions.guardTargets)) if (!isActionDisabledNow(room, state, actorId)) out.push({ actorId, effect: "protect", targetIds: [targetId] });
  for (const [actorId, action] of Object.entries(state.nightActions.witchActions)) {
    if (isActionDisabledNow(room, state, actorId)) continue;
    if (action.type === "poison") out.push({ actorId, effect: "witch_poison", targetIds: [action.targetId] });
    else if (action.type === "heal") out.push({ actorId, effect: "witch_heal", targetIds: [] });
  }
  for (const [actorId, targetId] of Object.entries(state.nightActions.wolfVotes)) out.push({ actorId, effect: "wolf_kill", targetIds: [targetId] });
  return out;
}

function describeEffectiveActionNow(room: any, state: GameState, targetId: string): string {
  const actions = effectiveActionsNow(room, state).filter((action) => action.actorId === targetId);
  if (!actions.length) return "無有效主動技能";
  return actions.map((action) => {
    const names = action.targetIds.map((id) => state.players.find((player) => player.id === id)?.name ?? id);
    return names.length ? `${action.effect} → ${names.join("、")}` : action.effect;
  }).join("；");
}

function wasEffectivelyTargetedNow(room: any, state: GameState, targetId: string, actorId: string): boolean {
  return effectiveActionsNow(room, state).some((action) => action.actorId !== actorId && action.targetIds.includes(targetId));
}

function wolfPerception(room: any, state: GameState, actor: Player): Player[] {
  if (playerFaction(actor) !== "werewolf" || hiddenFromWolfList(room, state, actor)) return [];
  const wise = actor.role === "wise_wolf";
  return state.players.filter((candidate) => {
    if (candidate.id === actor.id || !candidate.alive || candidate.isSpectator || candidate.kickedAt || hiddenFromWolfList(room, state, candidate)) return false;
    if (playerFaction(candidate) === "werewolf") return true;
    if (wise || !candidate.role) return false;
    return new Set(roleDefinition(candidate.role).passives ?? []).has("seer_looks_werewolf");
  });
}

function hiddenFromWolfList(room: any, state: GameState, player: Player): boolean {
  if (!player.role) return false;
  if (!new Set(roleDefinition(player.role).passives ?? []).has("hidden_from_wolf_list")) return false;
  return !(player.role === "lurking_wolf" && room.mem(state, player.id).awake === true);
}

function magicianWillSwapRoles(state: GameState, targetIds: string[]): boolean {
  if (targetIds.length !== 2) return false;
  const a = state.players.find((player) => player.id === targetIds[0]);
  const b = state.players.find((player) => player.id === targetIds[1]);
  if (!a || !b) return false;
  const aDead = isRealDeadForDeathGate(state, a);
  const bDead = isRealDeadForDeathGate(state, b);
  if (aDead !== bDead) return false;
  return !(a.alive && b.alive && (state.phase === "debate" || state.phase === "vote"));
}

function captureWinningAllegiances(room: any, state: GameState, targetIds: string[]): unknown[] {
  return targetIds.map((id) => room.mem(state, id).winningAllegiance);
}

function restoreWinningAllegiances(room: any, state: GameState, targetIds: string[], values: unknown[]): void {
  targetIds.forEach((id, index) => setWinningAllegiance(room.mem(state, id), values[index]));
}

function swapWinningAllegiances(room: any, state: GameState, targetIds: string[], before: unknown[]): void {
  if (targetIds.length !== 2) return;
  setWinningAllegiance(room.mem(state, targetIds[0]), before[1]);
  setWinningAllegiance(room.mem(state, targetIds[1]), before[0]);
}

function setWinningAllegiance(memory: Record<string, any>, value: unknown): void {
  if (value === "village" || value === "werewolf" || value === "spirit") memory.winningAllegiance = value;
  else delete memory.winningAllegiance;
}
