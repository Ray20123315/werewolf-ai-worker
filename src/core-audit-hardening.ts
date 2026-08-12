import { playerFaction, roleActionPrompt } from "./game-engine.js";
import { DEFAULT_PHASE_SECONDS } from "./core-state.js";
import type { RuntimeSettings } from "./core-state.js";
import { loverGroupMembers } from "./core-relationships.js";
import { roleDefinition } from "./roles.js";
import type {
  GameState,
  PendingAITask,
  Player,
  RoleActionPrompt,
  RoleActionSubmission,
  RoleMemoryValue
} from "./types.js";

type DeadlineKind = "day" | "night" | "sheriff" | "reaction";
type RuntimeMemory = Record<string, RoleMemoryValue | undefined>;
type AlarmStorage = {
  setAlarm?: (scheduledTime: number) => unknown;
  deleteAlarm?: () => unknown;
};

type PreparedNightAction = {
  submittedAt: number;
  targetIds: string[];
  cancelled: boolean;
};

interface CoreRuntimeRoom {
  ctx?: { storage?: AlarmStorage };
  requireState(): GameState;
  saveBroadcast(state: GameState): void;
  touchAndSave(state: GameState): void;
  broadcast(state: GameState): void;
  systemMem(state: GameState): RuntimeMemory;
  mem(state: GameState, playerId: string): RuntimeMemory;
  addSystemMessage(state: GameState, content: string): void;
  beginSheriffElection(state: GameState): void;
  finishSheriffElection(state: GameState): void;
  enterNight(state: GameState, round: number): void;
  beginDebate(state: GameState): void;
  enterVote(state: GameState): void;
  finishNight(state: GameState): void;
  resolveNightRoleAction(state: GameState, actor: Player, action: RoleActionSubmission): void;
  killPlayer(state: GameState, targetId: string, reason: string, killerId?: string, bypassProtection?: boolean): boolean;
  legalTargets(state: GameState, actor: Player, mode: string): Player[];
  popDeathReaction(state: GameState): boolean;
  checkAndMaybeEnd(state: GameState): void;
  projectState(state: GameState, token: string): unknown;
  pendingAITask(state: GameState): PendingAITask | undefined;
  alarm(): Promise<void>;
  __auditReactionReconciling?: boolean;
  __auditPreparedNightActions?: Map<string, PreparedNightAction>;
}

type RoomPrototype = Partial<CoreRuntimeRoom> & {
  __coreAuditHardeningInstalled?: boolean;
};

const PRESTAGE_EFFECTS = new Set([
  "disable_current_action",
  "disable_permanently",
  "hide_inspection_result",
  "warlock_choice",
  "alchemist_sequence",
  "observe_and_redirect",
  "redirect_targeted_action"
]);

export function installCoreAuditHardeningRules(GameRoomCtor: { prototype: RoomPrototype }): void {
  const proto = GameRoomCtor.prototype;
  if (proto.__coreAuditHardeningInstalled) return;
  proto.__coreAuditHardeningInstalled = true;
  enforceCanonicalMasochistText();

  const originalRequireState = proto.requireState;
  const originalSaveBroadcast = proto.saveBroadcast;
  const originalBeginSheriffElection = proto.beginSheriffElection;
  const originalEnterNight = proto.enterNight;
  const originalBeginDebate = proto.beginDebate;
  const originalEnterVote = proto.enterVote;
  const originalProjectState = proto.projectState;
  const originalPendingAITask = proto.pendingAITask;
  const originalFinishNight = proto.finishNight;
  const originalResolveNightRoleAction = proto.resolveNightRoleAction;
  const originalKillPlayer = proto.killPlayer;
  const originalAlarm = proto.alarm;

  if (typeof originalRequireState === "function") {
    proto.requireState = function (this: CoreRuntimeRoom): GameState {
      const state = originalRequireState.call(this);
      const changed = ensurePhaseDeadline(this, state);
      if (changed || deadlineNeedsPersistence(this, state)) persistDeadline(this, state);
      return state;
    };
  }

  if (typeof originalSaveBroadcast === "function") {
    proto.saveBroadcast = function (this: CoreRuntimeRoom, state: GameState): void {
      if (!this.__auditReactionReconciling) reconcileReaction(this, state);
      ensurePhaseDeadline(this, state);
      markDeadlinePersisted(this, state);
      return originalSaveBroadcast.call(this, state);
    };
  }

  if (typeof originalBeginSheriffElection === "function") {
    proto.beginSheriffElection = function (this: CoreRuntimeRoom, state: GameState): void {
      const result = originalBeginSheriffElection.call(this, state);
      persistCurrentDeadline(this, state);
      return result;
    };
  }

  if (typeof originalEnterNight === "function") {
    proto.enterNight = function (this: CoreRuntimeRoom, state: GameState, round: number): void {
      const result = originalEnterNight.call(this, state, round);
      persistCurrentDeadline(this, state);
      return result;
    };
  }

  if (typeof originalBeginDebate === "function") {
    proto.beginDebate = function (this: CoreRuntimeRoom, state: GameState): void {
      const result = originalBeginDebate.call(this, state);
      persistCurrentDeadline(this, state);
      return result;
    };
  }

  if (typeof originalEnterVote === "function") {
    proto.enterVote = function (this: CoreRuntimeRoom, state: GameState): void {
      const result = originalEnterVote.call(this, state);
      persistCurrentDeadline(this, state);
      return result;
    };
  }

  if (typeof originalProjectState === "function") {
    proto.projectState = function (this: CoreRuntimeRoom, state: GameState, token: string): unknown {
      reconcileReaction(this, state);
      return originalProjectState.call(this, state, token);
    };
  }

  if (typeof originalPendingAITask === "function") {
    proto.pendingAITask = function (this: CoreRuntimeRoom, state: GameState): PendingAITask | undefined {
      reconcileReaction(this, state);
      return originalPendingAITask.call(this, state);
    };
  }

  if (typeof originalFinishNight === "function") {
    proto.finishNight = function (this: CoreRuntimeRoom, state: GameState): void {
      const previous = this.__auditPreparedNightActions;
      this.__auditPreparedNightActions = preStageNightInvariants(this, state);
      try {
        return originalFinishNight.call(this, state);
      } finally {
        if (previous) this.__auditPreparedNightActions = previous;
        else delete this.__auditPreparedNightActions;
      }
    };
  }

  if (typeof originalResolveNightRoleAction === "function") {
    proto.resolveNightRoleAction = function (
      this: CoreRuntimeRoom,
      state: GameState,
      actor: Player,
      action: RoleActionSubmission
    ): void {
      const prepared = this.__auditPreparedNightActions?.get(actor.id);
      let effective = action;
      if (prepared?.submittedAt === action.submittedAt) {
        if (prepared.cancelled) return;
        effective = { ...action, targetIds: [...prepared.targetIds] };
      } else {
        const prelude = applyTargetedActionPrelude(this, state, actor, action);
        if (!prelude) return;
        effective = prelude;
      }

      if (effective.effect === "link_lovers" && loverResolutionConflicts(state, effective.targetIds)) {
        const memory = this.mem(state, actor.id);
        memory.cupidLinkedIds = [];
        state.roleResults[actor.id] ??= {};
        state.roleResults[actor.id]!["cupid:conflict"] = "配對目標已被另一名邱比特先完成配對；本次已提交技能視為失敗且不覆寫既有 CP。";
        return;
      }
      return originalResolveNightRoleAction.call(this, state, actor, effective);
    };
  }

  if (typeof originalKillPlayer === "function") {
    proto.killPlayer = function (
      this: CoreRuntimeRoom,
      state: GameState,
      targetId: string,
      reason: string,
      killerId?: string,
      bypassProtection = false
    ): boolean {
      return originalKillPlayer.call(
        this,
        state,
        targetId,
        normalizeRelationshipDeathReason(reason),
        killerId,
        bypassProtection
      );
    };
  }

  if (typeof originalAlarm === "function") {
    proto.alarm = async function (this: CoreRuntimeRoom): Promise<void> {
      const state = this.requireState();
      const kind = deadlineKind(state);
      const deadline = deadlineAt(state);
      if ((kind !== "sheriff" && kind !== "reaction") || !deadline) {
        return originalAlarm.call(this);
      }
      if (Date.now() + 25 < deadline) {
        void this.ctx?.storage?.setAlarm?.(deadline);
        return;
      }

      clearPhaseDeadline(this, state);
      if (kind === "sheriff" && state.phase === "sheriff") {
        this.addSystemMessage(state, "警長選舉時間到；尚未投票者視為棄權，依目前有效票直接結算。 ");
        this.finishSheriffElection(state);
        return;
      }
      if (kind === "reaction" && state.phase === "reaction" && state.pendingReaction) {
        const actor = state.players.find((player) => player.id === state.pendingReaction?.actorId);
        this.addSystemMessage(state, `${actor?.name ?? "反應玩家"} 的死亡反應時間到，未提交技能視為略過。`);
        skipCurrentReaction(this, state);
        reconcileReaction(this, state);
        if (state.phase === "reaction" && state.pendingReaction) this.saveBroadcast(state);
        return;
      }
      return originalAlarm.call(this);
    };
  }
}

export function normalizeRelationshipDeathReason(reason: string): string {
  return reason === "lover_group" ? "lover" : reason;
}

export function reconcileReaction(room: CoreRuntimeRoom, state: GameState): void {
  if (room.__auditReactionReconciling || state.phase !== "reaction" || !state.pendingReaction) return;
  room.__auditReactionReconciling = true;
  try {
    while (state.phase === "reaction" && state.pendingReaction) {
      const pending = state.pendingReaction;
      const actor = state.players.find((player) => player.id === pending.actorId);
      if (!actor || actor.kickedAt || actor.isSpectator) {
        room.addSystemMessage(state, "待處理反應玩家已不再是有效正式玩家，該反應自動略過。 ");
        skipCurrentReaction(room, state);
        continue;
      }

      const prompt = roleActionPrompt(actor, state);
      if (!prompt || prompt.effect !== pending.effect) {
        room.addSystemMessage(state, `${actor.name} 已沒有可提交的有效反應，系統自動略過。`);
        skipCurrentReaction(room, state);
        continue;
      }

      const required = minimumTargets(prompt);
      const legal = room.legalTargets(state, actor, prompt.targetMode);
      if (required > 0 && legal.length < required) {
        room.addSystemMessage(state, `${actor.name} 的反應已沒有合法目標，系統自動略過。`);
        skipCurrentReaction(room, state);
        continue;
      }
      ensurePhaseDeadline(room, state);
      break;
    }
  } finally {
    room.__auditReactionReconciling = false;
  }
}

export function preStageNightInvariants(room: CoreRuntimeRoom, state: GameState): Map<string, PreparedNightAction> {
  const prepared = new Map<string, PreparedNightAction>();
  if (state.phase !== "night") return prepared;
  const entries = Object.entries(state.nightActions.roleActions)
    .sort((left, right) => left[1].submittedAt - right[1].submittedAt || left[0].localeCompare(right[0]));

  for (const [actorId, action] of entries) {
    if (!PRESTAGE_EFFECTS.has(action.effect)) continue;
    const actor = state.players.find((player) => player.id === actorId && player.alive && !player.isSpectator && !player.kickedAt);
    if (!actor || isActionDisabled(state, actor.id)) continue;
    const prelude = applyTargetedActionPrelude(room, state, actor, action);
    if (!prelude) {
      prepared.set(actorId, { submittedAt: action.submittedAt, targetIds: [...action.targetIds], cancelled: true });
      continue;
    }
    prepared.set(actorId, { submittedAt: action.submittedAt, targetIds: [...prelude.targetIds], cancelled: false });
    applyPreStageEffect(room, state, actor, prelude);
  }

  applyRedirectsToCoreNightSubmissions(room, state);
  return prepared;
}

function applyTargetedActionPrelude(
  room: CoreRuntimeRoom,
  state: GameState,
  actor: Player,
  action: RoleActionSubmission
): RoleActionSubmission | undefined {
  const targetIds = [...action.targetIds];
  const memory = room.mem(state, actor.id);
  const redirectTo = memory.redirectNextActionTo;
  if (typeof redirectTo === "string" && targetIds.length > 0) {
    const redirected = state.players.find((player) =>
      player.id === redirectTo && player.alive && !player.isSpectator && !player.kickedAt
    );
    if (redirected) targetIds[0] = redirected.id;
    delete memory.redirectNextActionTo;
  }

  if (playerFaction(actor) === "village") {
    const demon = targetIds
      .map((id) => state.players.find((player) => player.id === id && player.alive && !player.isSpectator && !player.kickedAt))
      .find((player) => player?.role === "demon_wolf" && room.mem(state, player.id).retaliationUsed !== true);
    if (demon) {
      room.mem(state, demon.id).retaliationUsed = true;
      room.killPlayer(state, actor.id, "demon_wolf_retaliation", demon.id, true);
      return undefined;
    }
  }

  return { ...action, targetIds };
}

function applyPreStageEffect(room: CoreRuntimeRoom, state: GameState, actor: Player, action: RoleActionSubmission): void {
  const target = action.targetIds[0]
    ? state.players.find((player) => player.id === action.targetIds[0] && player.alive && !player.isSpectator && !player.kickedAt)
    : undefined;
  if (!target) return;
  const targetMemory = room.mem(state, target.id);
  const actorMemory = room.mem(state, actor.id);

  if (action.effect === "disable_current_action") targetMemory.disabledUntilRound = state.round;
  if (action.effect === "disable_permanently") targetMemory.disabledPermanently = true;
  if (action.effect === "hide_inspection_result") targetMemory.inspectionHiddenRound = state.round;
  if (action.effect === "warlock_choice" && action.option === "nullify" && actorMemory.warlockNullifyUsed !== true) {
    targetMemory.disabledUntilRound = state.round;
  }
  if (action.effect === "alchemist_sequence" && Number(actorMemory.alchemistStage ?? 0) === 0) {
    targetMemory.disabledUntilRound = state.round;
  }
  if (action.effect === "observe_and_redirect" || action.effect === "redirect_targeted_action") {
    targetMemory.redirectNextActionTo = actor.id;
  }
}

function applyRedirectsToCoreNightSubmissions(room: CoreRuntimeRoom, state: GameState): void {
  for (const player of state.players) {
    if (!player.alive || player.isSpectator || player.kickedAt) continue;
    const memory = room.mem(state, player.id);
    const redirectTo = memory.redirectNextActionTo;
    if (typeof redirectTo !== "string") continue;
    const redirected = state.players.find((candidate) =>
      candidate.id === redirectTo && candidate.alive && !candidate.isSpectator && !candidate.kickedAt
    );
    if (!redirected) continue;

    if (typeof state.nightActions.seerTargets[player.id] === "string") {
      state.nightActions.seerTargets[player.id] = redirected.id;
      delete memory.redirectNextActionTo;
      continue;
    }
    if (typeof state.nightActions.guardTargets[player.id] === "string") {
      state.nightActions.guardTargets[player.id] = redirected.id;
      delete memory.redirectNextActionTo;
      continue;
    }
    const witch = state.nightActions.witchActions[player.id];
    if (witch?.type === "poison") {
      state.nightActions.witchActions[player.id] = { type: "poison", targetId: redirected.id };
      delete memory.redirectNextActionTo;
    }
  }
}

function loverResolutionConflicts(state: GameState, targetIds: string[]): boolean {
  if (new Set(targetIds).size !== targetIds.length) return true;
  return targetIds.some((id) => loverGroupMembers(state, id).length > 0);
}

function skipCurrentReaction(room: CoreRuntimeRoom, state: GameState): void {
  const pending = state.pendingReaction;
  if (!pending) return;
  const resume = pending.resumePhase;
  delete state.pendingReaction;
  clearPhaseDeadline(room, state);

  if (room.popDeathReaction(state)) return;
  room.checkAndMaybeEnd(state);
  if (state.winner) return;
  if (resume === "night") room.enterNight(state, state.round + 1);
  else if (resume === "vote") room.enterVote(state);
  else room.beginDebate(state);
}

function minimumTargets(prompt: RoleActionPrompt): number {
  if (prompt.targetMode === "none" || prompt.targetMode === "optional_alive_other") return 0;
  return prompt.targetMode.startsWith("two_") ? 2 : 1;
}

function isActionDisabled(state: GameState, playerId: string): boolean {
  const memory = state.roleMemory[playerId] ?? {};
  if (memory.disabledPermanently === true) return true;
  if (typeof memory.disabledUntilRound === "number" && memory.disabledUntilRound >= state.round) return true;
  if (state.roleMemory.__system?.goodSkillsDisabledRound === state.round) {
    const player = state.players.find((candidate) => candidate.id === playerId);
    if (player && playerFaction(player) === "village") return true;
  }
  return false;
}

function phaseDeadlineKind(state: GameState): DeadlineKind | undefined {
  if (state.phase === "night") return "night";
  if (state.phase === "debate" || state.phase === "vote") return "day";
  if (state.phase === "sheriff") return "sheriff";
  if (state.phase === "reaction") return "reaction";
  return undefined;
}

function deadlineKind(state: GameState): DeadlineKind | undefined {
  const value = state.roleMemory.__system?.phaseDeadlineKind;
  return value === "day" || value === "night" || value === "sheriff" || value === "reaction" ? value : undefined;
}

function deadlineAt(state: GameState): number | undefined {
  const value = state.roleMemory.__system?.phaseDeadlineAt;
  return typeof value === "number" ? value : undefined;
}

function ensurePhaseDeadline(room: CoreRuntimeRoom, state: GameState): boolean {
  const expected = phaseDeadlineKind(state);
  if (!expected) return false;
  const system = room.systemMem(state);
  const current = deadlineAt(state);
  const currentKind = deadlineKind(state);
  if (current && currentKind === expected) return false;

  const settings = state.settings as RuntimeSettings;
  const seconds = expected === "night"
    ? settings.nightDurationSeconds ?? DEFAULT_PHASE_SECONDS
    : settings.dayDurationSeconds ?? DEFAULT_PHASE_SECONDS;
  const deadline = Date.now() + clampSeconds(seconds) * 1000;
  system.phaseDeadlineAt = deadline;
  system.phaseDeadlineKind = expected;
  delete system.phaseDeadlinePersistedAt;
  void room.ctx?.storage?.setAlarm?.(deadline);
  return true;
}

function clampSeconds(value: unknown): number {
  const parsed = Math.floor(Number(value) || DEFAULT_PHASE_SECONDS);
  return Math.max(15, Math.min(3600, parsed));
}

function deadlineNeedsPersistence(room: CoreRuntimeRoom, state: GameState): boolean {
  const deadline = deadlineAt(state);
  if (!deadline) return false;
  return room.systemMem(state).phaseDeadlinePersistedAt !== deadline;
}

function markDeadlinePersisted(room: CoreRuntimeRoom, state: GameState): void {
  const deadline = deadlineAt(state);
  if (!deadline) return;
  room.systemMem(state).phaseDeadlinePersistedAt = deadline;
}

function persistDeadline(room: CoreRuntimeRoom, state: GameState): void {
  markDeadlinePersisted(room, state);
  room.touchAndSave(state);
}

function persistCurrentDeadline(room: CoreRuntimeRoom, state: GameState): void {
  ensurePhaseDeadline(room, state);
  if (deadlineNeedsPersistence(room, state)) persistDeadline(room, state);
}

function clearPhaseDeadline(room: CoreRuntimeRoom, state: GameState): void {
  const system = room.systemMem(state);
  delete system.phaseDeadlineAt;
  delete system.phaseDeadlineKind;
  delete system.phaseDeadlinePersistedAt;
  void room.ctx?.storage?.deleteAlarm?.();
}

function enforceCanonicalMasochistText(): void {
  const definition = roleDefinition("masochist_cultist");
  definition.summary = "附加身份：保留本體角色與陣營；普通放逐票固定為無效票。若自己被一般放逐處決，立即達成個人特殊勝利。";
  definition.passives = [...new Set([...(definition.passives ?? []), "vote_weight_zero"])];
}
