import { callAIWithKeys, parseJSONObject } from "./ai.js";
import { assertCurrentAITask, captureAITaskContext, isCurrentAITask } from "./ai-task-freshness.js";
import type { AITaskContext } from "./ai-task-freshness.js";
import { countsAsAliveForDeathGate, isRealDeadForDeathGate } from "./core-fake-death.js";
import { loverGroupMembers } from "./core-relationships.js";
import { activeCoreRoleDefinitions } from "./core-state.js";
import { ABSTAIN_TARGET } from "./equal-vote.js";
import { activePlayers, areNightActionsComplete, canGuardTarget, livingPlayers, playerFaction, roleActionPrompt, secureShuffle } from "./game-engine.js";
import { roleDefinition } from "./roles.js";
import type { Faction, GameState, Player, RoleActionPrompt, RoleActionSubmission } from "./types.js";

type RoomPrototype = Record<string, any> & { __post28FullRepairInstalled?: boolean };
type RuntimeTask = { playerId: string; operation: string };
type EffectiveNightAction = { actorId: string; effect: string; targetIds: string[]; source: "role" | "seer" | "guard" | "witch" | "wolf" };

type CopiedPrompt = RoleActionPrompt & { copiedFromRole: string; copiedSourceId: string };

const FIRST_NIGHT_ONLY = new Map<string, string>([
  ["cupid", "link_lovers"],
  ["gambler", "choose_allegiance"],
  ["guardian", "set_permanent_guard"]
]);
const ADDON_ONLY_ROLE_IDS = new Set(["masochist_cultist", "sadist_leader"]);
const PRESTAGE_EFFECTS = new Set([
  "disable_current_action",
  "disable_next_action",
  "disable_permanently",
  "hide_inspection_result",
  "warlock_choice",
  "alchemist_sequence",
  "observe_and_redirect",
  "redirect_targeted_action",
  "copy_ability_and_block",
  "curse_caster_mark",
  "pollen_block",
  "spend_stacks_to_disable"
]);
const EMPTY_ROOM_GRACE_MS = 2 * 60_000;
const DISBAND_SENTINEL = "__disband_room__";

export function installPost28FullRepairRules(GameRoomCtor: { prototype: RoomPrototype }): void {
  const proto = GameRoomCtor.prototype;
  if (proto.__post28FullRepairInstalled) return;
  proto.__post28FullRepairInstalled = true;

  const originalRequireState = proto.requireState;
  const originalInitializeRoleMemories = proto.initializeRoleMemories;
  const originalEnterNight = proto.enterNight;
  const originalFinishNight = proto.finishNight;
  const originalApplyEndOfNightStatuses = proto.applyEndOfNightStatuses;
  const originalResolveNightRoleAction = proto.resolveNightRoleAction;
  const originalSubmitRoleActionInternal = proto.submitRoleActionInternal;
  const originalSubmitDebateSpeech = proto.submitDebateSpeech;
  const originalRecordDebateSpeech = proto.recordDebateSpeech;
  const originalProjectState = proto.projectState;
  const originalPendingAITask = proto.pendingAITask;
  const originalRunAI = proto.runAI;
  const originalWolfTeammates = proto.wolfTeammates;
  const originalParticipatesWolfVote = proto.participatesWolfVote;
  const originalCastVoteById = proto.castVoteById;
  const originalSetSheriffCandidate = proto.setSheriffCandidate;
  const originalFinishSheriffElection = proto.finishSheriffElection;
  const originalKillPlayer = proto.killPlayer;
  const originalResolveSpiritInspection = proto.resolveSpiritInspection;
  const originalEndGame = proto.endGame;
  const originalCheckAndMaybeEnd = proto.checkAndMaybeEnd;
  const originalAdminSnapshot = proto.adminSnapshot;
  const originalAdminKick = proto.adminKick;
  const originalInitialize = proto.initialize;
  const originalJoinHuman = proto.joinHuman;
  const originalLoginHuman = proto.loginHuman;
  const originalFetch = proto.fetch;
  const originalWebSocketClose = proto.webSocketClose;
  const originalWebSocketError = proto.webSocketError;
  const originalAlarm = proto.alarm;
  const originalSaveBroadcast = proto.saveBroadcast;

  proto.rescheduleRoomAlarm = function (state: GameState): void {
    scheduleNextAlarm(this, state);
  };

  if (typeof originalRequireState === "function") {
    proto.requireState = function (): GameState {
      const state = originalRequireState.call(this) as GameState;
      migratePost28State(this, state);
      if (state.phase === "debate") normalizeDebateSlots(state);
      return state;
    };
  }

  if (typeof originalInitializeRoleMemories === "function") {
    proto.initializeRoleMemories = function (state: GameState): void {
      const result = originalInitializeRoleMemories.call(this, state);
      migrateSecretAllegiances(this, state, true);
      return result;
    };
  }

  if (typeof originalEnterNight === "function") {
    proto.enterNight = function (state: GameState, round: number): void {
      reconcileDeathTransitions(state);
      expireRoundScopedState(this, state, round);
      const result = originalEnterNight.call(this, state, round);
      migratePost28State(this, state);
      const changed = markUnavailableNightActions(this, state);
      if (changed && state.phase === "night") {
        if (areNightActionsComplete(state)) this.finishNight(state);
        else this.saveBroadcast(state);
      }
      scheduleNextAlarm(this, state);
      return result;
    };
  }

  if (typeof originalFinishNight === "function") {
    proto.finishNight = function (state: GameState): void {
      if (state.phase !== "night") return originalFinishNight.call(this, state);
      normalizeEffectiveNightActions(this, state);
      const elder = findElderForceDawn(state);
      if (elder) resolveElderForceDawn(this, state, elder.actor, elder.action);
      this.__post28NightSnapshot = buildEffectiveNightSnapshot(state);
      try {
        return originalFinishNight.call(this, state);
      } finally {
        clearRoundScopedResolutionState(this, state);
        delete this.__post28NightSnapshot;
        scheduleNextAlarm(this, state);
      }
    };
  }

  if (typeof originalApplyEndOfNightStatuses === "function") {
    proto.applyEndOfNightStatuses = function (state: GameState): void {
      const pendingRevives = state.players.filter((player) => {
        const reviveRound = this.mem(state, player.id).reviveRound;
        return !player.alive && typeof reviveRound === "number" && reviveRound <= state.round;
      }).map((player) => player.id);
      const result = originalApplyEndOfNightStatuses.call(this, state);
      for (const playerId of pendingRevives) {
        const player = state.players.find((candidate) => candidate.id === playerId && candidate.alive);
        if (player) revivePlayerInvariant(this, state, player);
      }
      resolveDawnDeaths(this, state);
      reconcileDeathTransitions(state);
      return result;
    };
  }

  if (typeof originalResolveNightRoleAction === "function") {
    proto.resolveNightRoleAction = function (state: GameState, actor: Player, action: RoleActionSubmission): void {
      const target = action.targetIds[0] ? state.players.find((player) => player.id === action.targetIds[0]) : undefined;
      const targetMemory = target ? this.mem(state, target.id) as Record<string, any> : undefined;
      const actorMemory = this.mem(state, actor.id) as Record<string, any>;

      if (action.effect === "redirect_wolf_kill") {
        if (target?.alive && !target.isSpectator && !target.kickedAt) {
          const system = this.systemMem(state) as Record<string, any>;
          system.redirectWolfKill = target.id;
          system.redirectWolfKillTarget = target.id;
          system.redirectWolfKillRound = state.round;
        }
        return;
      }
      if (action.effect === "choose_allegiance") {
        if (action.option === "village" || action.option === "werewolf" || action.option === "spirit") actorMemory.winningAllegiance = action.option;
        delete actor.factionOverride;
        return;
      }
      if (action.effect === "sacrifice_revive") {
        if (!target || !isRealDeadForDeathGate(state, target)) return;
        this.killPlayer(state, actor.id, "substitute_sacrifice", actor.id, true);
        revivePlayerInvariant(this, state, target);
        reconcileDeathTransitions(state);
        return;
      }
      if (action.effect === "angel_check") {
        if (target?.role) {
          this.storeRoleResult(state, actor, target, target.role);
          if (state.round >= 2 && playerFaction(target) === "werewolf") queueDawnDeath(this, state, target.id, "angel", actor.id);
        }
        return;
      }
      if (action.effect === "devil_check") {
        if (target?.role) {
          this.storeRoleResult(state, actor, target, target.role);
          if (state.round >= 2 && target.role === "angel") queueDawnDeath(this, state, target.id, "devil", actor.id);
        }
        return;
      }
      if ((action as any).effect === "elder_force_dawn") return;
      if (action.effect === "mark_convert_on_death") {
        if (target) {
          actorMemory.convertOnDeath = target.id;
          actorMemory.convertOnDeathRound = state.round;
        }
        return;
      }
      if (action.effect === "inspect_action") {
        if (target) this.storeRoleResult(state, actor, target, describeEffectiveAction(this, state, target.id));
        return;
      }
      if (action.effect === "observe_and_redirect") {
        if (target) this.storeRoleResult(state, actor, target, describeEffectiveAction(this, state, target.id));
        return;
      }
      if (action.effect === "kill_if_targeted_by_other") {
        if (target && wasEffectivelyTargetedByOther(this, target.id, actor.id)) this.killPlayer(state, target.id, "shadow_wolf", actor.id);
        return;
      }
      if (action.effect === "disable_next_action") return;
      if (action.effect === "copy_ability_and_block") {
        if (target?.role) {
          actorMemory.copiedRole = target.role;
          actorMemory.copiedSourceId = target.id;
          delete actorMemory.copiedAbilityUsed;
        }
        return;
      }
      if (action.effect === "curse_caster_mark" && action.option === "block") return;
      if (action.effect === "pollen_block") {
        if (target) actorMemory.pollenTarget = target.id;
        return;
      }
      if (action.effect === "spend_stacks_to_disable") {
        if (Number(actorMemory.vomitStacks ?? 0) > 0) actorMemory.vomitStacks = 0;
        return;
      }
      if (action.effect === "reroll_same_faction_role") {
        if (!target?.role) return;
        const faction = playerFaction(target);
        const pool = activeCoreRoleDefinitions().filter((definition) =>
          definition.faction === faction && definition.id !== target.role && !ADDON_ONLY_ROLE_IDS.has(definition.id)
        );
        if (pool.length) target.role = secureShuffle(pool)[0]!.id;
        return;
      }
      if (actor.role === "vampire_wolf_copy" && isCopiedAction(this, state, actor, action)) {
        if (action.effect === "witch_choice") return resolveCopiedWitch(this, state, actor, action);
        if (action.effect === "wolf_kill") {
          if (target) this.killPlayer(state, target.id, "copied_wolf_kill", actor.id);
          return;
        }
      }
      return originalResolveNightRoleAction.call(this, state, actor, action);
    };
  }

  if (typeof originalSubmitRoleActionInternal === "function") {
    proto.submitRoleActionInternal = function (state: GameState, actor: Player, effect: string, targetIds: string[], option?: string): void {
      migratePost28State(this, state);
      if (isExpiredFirstNightAction(actor, effect, state.round)) throw new Error("此技能只能在首夜使用");
      if (effect === "day_assassinate" && state.phase === "debate" && speechCount(state, actor.id) < 1) throw new Error("日狼必須先完成自己的正式發言才能刺殺");
      if (effect === "spend_stacks_to_disable" && Number(this.mem(state, actor.id).vomitStacks ?? 0) <= 0) throw new Error("嘔吐狼目前沒有可消耗層數");
      if (actor.role === "vampire_wolf_copy" && effect === "copy_ability_and_block" && copiedPrompt(this, state, actor)) throw new Error("目前複製能力仍有效；目標死亡後才能重新複製");

      const elderPrompt = actor.role === "elder_wolf" && effect === "elder_force_dawn" ? roleActionPrompt(actor, state) : undefined;
      const copied = copiedPrompt(this, state, actor);
      const delegated = copied && copied.effect === effect ? copied : undefined;
      if (elderPrompt || delegated) {
        const prompt = delegated ?? elderPrompt!;
        validatePromptSelection(this, state, actor, prompt, targetIds, option);
        const submission = { effect, targetIds: [...targetIds], ...(option ? { option } : {}), submittedAt: Date.now() } as unknown as RoleActionSubmission;
        if (prompt.timing === "night") state.nightActions.roleActions[actor.id] = submission;
        else this.resolveImmediateRoleAction(state, actor, submission);
        if (delegated?.oncePerGame) this.mem(state, actor.id).copiedAbilityUsed = true;
        if (elderPrompt?.oncePerGame) this.mem(state, actor.id)["used:strong_kill"] = true;
        return;
      }

      const magicianAllianceSwap = effect === "magician_swap" ? magicianWillSwapRoles(state, targetIds) : false;
      const beforeAllegiances = magicianAllianceSwap ? targetIds.map((id) => this.mem(state, id).winningAllegiance) : [];
      const result = originalSubmitRoleActionInternal.call(this, state, actor, effect, targetIds, option);
      if (magicianAllianceSwap) swapWinningAllegiances(this, state, targetIds, beforeAllegiances);
      return result;
    };
  }

  if (typeof originalSubmitDebateSpeech === "function") {
    proto.submitDebateSpeech = function (...args: any[]): void {
      const state = this.requireState() as GameState;
      normalizeDebateSlots(state);
      return originalSubmitDebateSpeech.apply(this, args);
    };
  }

  if (typeof originalRecordDebateSpeech === "function") {
    proto.recordDebateSpeech = function (state: GameState, actor: Player, text: string, locale?: string): void {
      const result = originalRecordDebateSpeech.call(this, state, actor, text, locale);
      if (state.phase === "debate") normalizeDebateSlots(state);
      return result;
    };
  }

  if (typeof originalProjectState === "function") {
    proto.projectState = function (state: GameState, token: string): any {
      migratePost28State(this, state);
      if (state.phase === "debate") normalizeDebateSlots(state);
      const view = originalProjectState.call(this, state, token);
      if (!view?.me) return view;
      const actor = this.playerByToken(state, token) as Player;
      const baseEffect = view.roleAction?.effect;
      if (typeof baseEffect === "string" && isExpiredFirstNightAction(actor, baseEffect, state.round)) delete view.roleAction;
      if (actor.role === "sun_wolf" && view.roleAction?.effect === "day_assassinate" && speechCount(state, actor.id) < 1) delete view.roleAction;
      if (actor.role === "vomit_wolf" && Number(this.mem(state, actor.id).vomitStacks ?? 0) <= 0) delete view.roleAction;
      const copied = copiedPrompt(this, state, actor);
      if (copied && !state.nightActions.roleActions[actor.id]) view.roleAction = copied;
      if (actor.role === "elder_wolf" && view.roleAction?.effect === "strong_kill") view.roleAction = { ...view.roleAction, effect: "elder_force_dawn" };
      const allegiance = this.mem(state, actor.id).winningAllegiance;
      if (allegiance === "village" || allegiance === "werewolf" || allegiance === "spirit") view.me.winningAllegiance = allegiance;
      return view;
    };
  }

  if (typeof originalPendingAITask === "function") {
    proto.pendingAITask = function (state: GameState): RuntimeTask | undefined {
      migratePost28State(this, state);
      if (state.phase === "debate") normalizeDebateSlots(state);
      if (state.phase === "night") markUnavailableNightActions(this, state);
      let task = originalPendingAITask.call(this, state) as RuntimeTask | undefined;
      let attempts = 0;
      while (task?.operation === "core_wolf_council" && attempts < state.players.length) {
        const actor = state.players.find((player) => player.id === task!.playerId);
        if (actor && safeCouncilCohort(this, state, actor)) break;
        const system = this.systemMem(state) as Record<string, any>;
        const used = Array.isArray(system.coreWolfCouncilActors) ? system.coreWolfCouncilActors.filter((id: unknown): id is string => typeof id === "string") : [];
        if (task.playerId && !used.includes(task.playerId)) used.push(task.playerId);
        system.coreWolfCouncilActors = used;
        task = originalPendingAITask.call(this, state) as RuntimeTask | undefined;
        attempts += 1;
      }
      return task;
    };
  }

  if (typeof originalRunAI === "function") {
    proto.runAI = async function (hostToken: string, playerId: string, apiKeys: string[]): Promise<{ ok: true }> {
      const state = this.requireState() as GameState;
      const task = this.pendingAITask(state) as RuntimeTask | undefined;
      const taskContext = task ? captureAITaskContext(state, task) : undefined;
      const actor = state.players.find((player) => player.id === playerId && player.alive && player.isAI && !player.isSpectator && player.ai);
      if (task?.playerId === playerId && actor?.ai && task.operation === "core_wolf_council" && taskContext) {
        this.assertHost(state, hostToken);
        return runSafeWolfCouncilAI(this, state, actor, taskContext, apiKeys);
      }
      const copied = actor ? copiedPrompt(this, state, actor) : undefined;
      if (task?.playerId === playerId && actor?.ai && task.operation === "role_action" && copied && state.phase === "night") {
        this.assertHost(state, hostToken);
        const targets = legalTargetsForPrompt(this, state, actor, copied);
        const targetIds: string[] = [];
        if (minimumTargets(copied.targetMode) > 0 && targets.length) {
          const first = await this.decideAITarget(state, actor, apiKeys, targets);
          targetIds.push(first);
          if (copied.targetMode.startsWith("two_")) {
            const second = targets.find((candidate: Player) => candidate.id !== first);
            if (second) targetIds.push(second.id);
          }
        }
        const current = this.requireState() as GameState;
        this.assertHost(current, hostToken);
        assertCurrentAITask(this, current, taskContext!);
        const nowActor = current.players.find((player) => player.id === playerId && player.alive && player.isAI && !player.isSpectator && player.ai);
        const currentCopied = nowActor ? copiedPrompt(this, current, nowActor) : undefined;
        if (!nowActor?.ai || !currentCopied || currentCopied.effect !== copied.effect || currentCopied.targetMode !== copied.targetMode) {
          throw new Error("AI 操作已過期，請重新同步房間狀態");
        }
        this.submitRoleActionInternal(current, nowActor, currentCopied.effect, targetIds, currentCopied.options?.[0]);
        this.afterNightSubmission(current);
        return { ok: true };
      }
      return originalRunAI.call(this, hostToken, playerId, apiKeys);
    };
  }

  if (typeof originalWolfTeammates === "function") {
    proto.wolfTeammates = function (state: GameState, actor: Player): Player[] {
      migratePost28State(this, state);
      if (playerFaction(actor) !== "werewolf" || wolfIdentityHidden(this, state, actor)) return [];
      const wise = actor.role === "wise_wolf";
      return livingPlayers(state.players).filter((candidate) => {
        if (candidate.id === actor.id || candidate.kickedAt || wolfIdentityHidden(this, state, candidate)) return false;
        if (wise) return playerFaction(candidate) === "werewolf";
        return playerFaction(candidate) === "werewolf" || looksLikeWolfToOrdinaryPack(candidate);
      });
    };
  }

  if (typeof originalParticipatesWolfVote === "function") {
    proto.participatesWolfVote = function (state: GameState, actor: Player): boolean {
      migratePost28State(this, state);
      if (playerFaction(actor) !== "werewolf") return false;
      return Boolean(originalParticipatesWolfVote.call(this, state, actor));
    };
  }

  if (typeof originalCastVoteById === "function") {
    proto.castVoteById = function (state: GameState, voterId: string, targetId: string): void {
      const voter = state.players.find((player) => player.id === voterId && player.alive && !player.isSpectator && !player.kickedAt);
      const target = state.players.find((player) => player.id === targetId && player.alive && !player.isSpectator && !player.kickedAt);
      const memory = voter ? this.mem(state, voter.id) as Record<string, any> : undefined;
      const combined = Number(memory?.nextActionOrVoteDisabledCount ?? 0);
      if (combined > 0 && voter && target && voter.id !== target.id && targetId !== ABSTAIN_TARGET && targetId !== "__ai_auto_skip__") {
        memory!.nextActionOrVoteDisabledCount = combined - 1;
        const history = Array.isArray((state as any).invalidatedVoteHistory) ? (state as any).invalidatedVoteHistory : [];
        history.push({ voterId: voter.id, targetId, reason: "受嘔吐狼影響，下一次普通投票失效" });
        (state as any).invalidatedVoteHistory = history.slice(-50);
        return originalCastVoteById.call(this, state, voterId, ABSTAIN_TARGET);
      }
      return originalCastVoteById.call(this, state, voterId, targetId);
    };
  }

  if (typeof originalSetSheriffCandidate === "function") {
    proto.setSheriffCandidate = function (token: string, running: boolean): void {
      const state = this.requireState() as GameState;
      const actor = this.playerByToken(state, token) as Player;
      if (!running) {
        for (const [voterId, targetId] of Object.entries(state.sheriff.votes)) if (targetId === actor.id) delete state.sheriff.votes[voterId];
      }
      return originalSetSheriffCandidate.call(this, token, running);
    };
  }

  if (typeof originalFinishSheriffElection === "function") {
    proto.finishSheriffElection = function (state: GameState): void {
      const candidates = new Set(state.sheriff.candidates);
      for (const [voterId, targetId] of Object.entries(state.sheriff.votes)) if (!candidates.has(targetId)) delete state.sheriff.votes[voterId];
      return originalFinishSheriffElection.call(this, state);
    };
  }

  if (typeof originalKillPlayer === "function") {
    proto.killPlayer = function (state: GameState, targetId: string, reason: string, killerId?: string, bypassProtection = false): boolean {
      const result = originalKillPlayer.call(this, state, targetId, reason, killerId, bypassProtection) as boolean;
      const target = state.players.find((player) => player.id === targetId);
      if (target?.role === "betrayer" && !target.alive && target.factionOverride === "werewolf") {
        this.mem(state, target.id).winningAllegiance = "werewolf";
        delete target.factionOverride;
      }
      if (result) {
        clearCopiesWhoseSourceDied(this, state, targetId);
        reconcileDeathTransitions(state);
      }
      return result;
    };
  }

  if (typeof originalResolveSpiritInspection === "function") {
    proto.resolveSpiritInspection = function (state: GameState, actor: Player, target: Player): void {
      const result = originalResolveSpiritInspection.call(this, state, actor, target);
      if (target.role === "cursed_spirit") {
        const memory = this.mem(state, actor.id) as Record<string, any>;
        if (typeof memory.disabledUntilRound === "number" && memory.disabledUntilRound === state.round + 1) {
          delete memory.disabledUntilRound;
          memory.nextActionDisabledCount = Number(memory.nextActionDisabledCount ?? 0) + 1;
        }
      }
      return result;
    };
  }

  if (typeof originalEndGame === "function") {
    proto.endGame = function (state: GameState, winner: any): void {
      migratePost28State(this, state);
      if (!state.winnerPlayerIds?.length && !state.winnerLabel) {
        const soleGroup = soleLivingLoverGroup(state);
        if (soleGroup) {
          state.winnerPlayerIds = [...soleGroup];
          state.winnerLabel = `${soleGroup.map((id) => state.players.find((player) => player.id === id)?.name ?? id).join("、")}（CP）成為最後存活群組，CP 共同獲勝`;
          const result = originalEndGame.call(this, state, "neutral");
          augmentWinningAllegiance(this, state, "neutral");
          return result;
        }
        if (winner !== "neutral" && mixedLivingLoverGroupBlocksFactionWin(state)) {
          (this.systemMem(state) as Record<string, any>).addonBlockedFactionWinner = true;
          return;
        }
      }
      if (winner === "neutral" && !state.winnerPlayerIds?.length && !state.winnerLabel) {
        const living = formalLiving(state);
        if (living.length === 1 && (living[0]!.role === "spy" || living[0]!.role === "gambler")) {
          const allegiance = this.mem(state, living[0]!.id).winningAllegiance;
          if (allegiance === "village" || allegiance === "werewolf" || allegiance === "spirit") winner = allegiance;
        }
      }
      const result = originalEndGame.call(this, state, winner);
      if (winner === "village" || winner === "werewolf" || winner === "spirit" || winner === "neutral" || winner === "blood") augmentWinningAllegiance(this, state, winner);
      return result;
    };
  }

  if (typeof originalCheckAndMaybeEnd === "function") {
    proto.checkAndMaybeEnd = function (state: GameState): void {
      const result = originalCheckAndMaybeEnd.call(this, state);
      if (!state.winner && !mixedLivingLoverGroupBlocksFactionWin(state)) delete (this.systemMem(state) as Record<string, any>).addonBlockedFactionWinner;
      return result;
    };
  }

  if (typeof originalAdminSnapshot === "function") {
    proto.adminSnapshot = async function (): Promise<any> {
      const snapshot = await originalAdminSnapshot.call(this);
      const state = this.requireState() as GameState;
      if (state.phase === "lobby") return snapshot;
      snapshot.players = snapshot.players.map((publicPlayer: any) => {
        const player = state.players.find((candidate) => candidate.id === publicPlayer.id);
        if (!player) return publicPlayer;
        const memory = this.mem(state, player.id) as Record<string, any>;
        const group = loverGroupMembers(state, player.id);
        const addons = Array.isArray((player as any).addonRoles) ? (player as any).addonRoles.filter((item: unknown): item is string => typeof item === "string") : [];
        return {
          ...publicPlayer,
          ...(player.role ? { role: player.role, roleName: roleDefinition(player.role).name } : {}),
          mechanicalFaction: playerFaction(player),
          ...(memory.winningAllegiance ? { winningAllegiance: memory.winningAllegiance } : {}),
          ...(addons.length ? { addonRoles: addons } : {}),
          ...(group.length ? { loverGroupIds: group } : {})
        };
      });
      return snapshot;
    };
  }

  if (typeof originalAdminKick === "function") {
    proto.adminKick = async function (targetId: string): Promise<void> {
      if (targetId === DISBAND_SENTINEL) return disbandRoom(this, "全站管理員解散房間");
      return originalAdminKick.call(this, targetId);
    };
  }

  if (typeof originalInitialize === "function") {
    proto.initialize = async function (...args: any[]): Promise<any> {
      const result = await originalInitialize.apply(this, args);
      const state = this.requireState() as GameState;
      armEmptyRoomCleanup(this, state);
      return result;
    };
  }

  if (typeof originalJoinHuman === "function") {
    proto.joinHuman = async function (...args: any[]): Promise<any> {
      const result = await originalJoinHuman.apply(this, args);
      const state = this.requireState() as GameState;
      armEmptyRoomCleanup(this, state);
      return result;
    };
  }

  if (typeof originalLoginHuman === "function") {
    proto.loginHuman = async function (...args: any[]): Promise<any> {
      const result = await originalLoginHuman.apply(this, args);
      const state = this.requireState() as GameState;
      armEmptyRoomCleanup(this, state);
      return result;
    };
  }

  if (typeof originalFetch === "function") {
    proto.fetch = async function (request: Request): Promise<Response> {
      const response = await originalFetch.call(this, request) as Response;
      if (response.status === 101) {
        const state = this.requireState() as GameState;
        clearEmptyRoomCleanup(this, state);
      }
      return response;
    };
  }

  if (typeof originalWebSocketClose === "function") {
    proto.webSocketClose = async function (...args: any[]): Promise<void> {
      await originalWebSocketClose.apply(this, args);
      const state = safeState(this);
      if (state && openSocketCount(this) === 0) armEmptyRoomCleanup(this, state);
    };
  }

  if (typeof originalWebSocketError === "function") {
    proto.webSocketError = async function (...args: any[]): Promise<void> {
      await originalWebSocketError.apply(this, args);
      const state = safeState(this);
      if (state && openSocketCount(this) === 0) armEmptyRoomCleanup(this, state);
    };
  }

  if (typeof originalAlarm === "function") {
    proto.alarm = async function (): Promise<void> {
      const state = safeState(this);
      if (state && emptyCleanupExpired(this, state) && openSocketCount(this) === 0) return disbandRoom(this, "房間已無連線玩家");
      await originalAlarm.call(this);
      const current = safeState(this);
      if (current) scheduleNextAlarm(this, current);
    };
  }

  if (typeof originalSaveBroadcast === "function") {
    proto.saveBroadcast = function (state: GameState): void {
      const result = originalSaveBroadcast.call(this, state);
      scheduleNextAlarm(this, state);
      return result;
    };
  }
}

function migratePost28State(room: any, state: GameState): void {
  if (!state?.roleMemory || !Array.isArray(state.players)) return;
  migrateSecretAllegiances(room, state, false);
  const system = room.systemMem(state) as Record<string, any>;
  const legacyRedirect = system.redirectWolfKill;
  const redirectRound = Number(system.redirectWolfKillRound ?? NaN);
  if (typeof legacyRedirect === "string" && !Number.isFinite(redirectRound)) {
    system.redirectWolfKillTarget = legacyRedirect;
    system.redirectWolfKillRound = state.round;
  }
  for (const wolf of state.players.filter((player) => player.role === "confusing_wolf")) {
    const memory = room.mem(state, wolf.id) as Record<string, any>;
    if (typeof memory.convertOnDeath === "string" && typeof memory.convertOnDeathRound !== "number") memory.convertOnDeathRound = state.round;
  }
  clearCopiesWhoseSourceDied(room, state);
}

function migrateSecretAllegiances(room: any, state: GameState, initializeSpy: boolean): void {
  for (const player of state.players) {
    if (player.role !== "spy" && player.role !== "gambler") continue;
    const memory = room.mem(state, player.id) as Record<string, any>;
    if ((player.factionOverride === "village" || player.factionOverride === "werewolf" || player.factionOverride === "spirit") && !memory.winningAllegiance) {
      memory.winningAllegiance = player.factionOverride;
    }
    delete player.factionOverride;
    if (player.role === "spy" && initializeSpy && !memory.winningAllegiance) memory.winningAllegiance = secureShuffle<Faction>(["village", "werewolf", "spirit"])[0]!;
  }
}

function expireRoundScopedState(room: any, state: GameState, nextRound: number): void {
  const system = room.systemMem(state) as Record<string, any>;
  if (Number(system.redirectWolfKillRound ?? NaN) !== nextRound) {
    delete system.redirectWolfKill;
    delete system.redirectWolfKillTarget;
    delete system.redirectWolfKillRound;
  }
  for (const wolf of state.players.filter((player) => player.role === "confusing_wolf")) {
    const memory = room.mem(state, wolf.id) as Record<string, any>;
    if (typeof memory.convertOnDeath === "string" && Number(memory.convertOnDeathRound ?? NaN) !== nextRound) {
      delete memory.convertOnDeath;
      delete memory.convertOnDeathRound;
    }
  }
}

function clearRoundScopedResolutionState(room: any, state: GameState): void {
  const system = room.systemMem(state) as Record<string, any>;
  delete system.redirectWolfKill;
  delete system.redirectWolfKillTarget;
  delete system.redirectWolfKillRound;
  delete system.earlyDawnRound;
  for (const player of state.players) delete (room.mem(state, player.id) as Record<string, any>).redirectNextActionTo;
}

function markUnavailableNightActions(room: any, state: GameState): boolean {
  if (state.phase !== "night") return false;
  let changed = false;
  for (const actor of state.players) {
    if (!actor.alive || actor.isSpectator || actor.kickedAt || !actor.role || state.nightActions.roleActions[actor.id]) continue;
    const def = roleDefinition(actor.role);
    if (!def.action || def.action.timing !== "night") continue;
    const firstOnly = FIRST_NIGHT_ONLY.get(actor.role) === def.action.effect && state.round !== 1;
    const noVomitStacks = actor.role === "vomit_wolf" && def.action.effect === "spend_stacks_to_disable" && Number(room.mem(state, actor.id).vomitStacks ?? 0) <= 0;
    if (!firstOnly && !noVomitStacks) continue;
    state.nightActions.roleActions[actor.id] = { effect: def.action.effect, targetIds: [], option: "__pass__", submittedAt: Date.now() } as RoleActionSubmission;
    changed = true;
  }
  return changed;
}

function isExpiredFirstNightAction(actor: Player, effect: string, round: number): boolean {
  return Boolean(actor.role && FIRST_NIGHT_ONLY.get(actor.role) === effect && round !== 1);
}

function normalizeEffectiveNightActions(room: any, state: GameState): void {
  if (state.phase !== "night") return;
  const entries = Object.entries(state.nightActions.roleActions)
    .sort((left, right) => left[1].submittedAt - right[1].submittedAt || left[0].localeCompare(right[0]));

  for (const [actorId, action] of entries) {
    if (!isPrestageAction(action)) continue;
    const actor = validLivingPlayer(state, actorId);
    if (!actor || action.option === "__pass__" || roundDisabled(room, state, actor.id)) continue;
    if (consumeNextSkillBlock(room, state, actor.id)) {
      delete state.nightActions.roleActions[actorId];
      continue;
    }
    const effective = redirectedAndValidatedAction(room, state, actor, action);
    if (!effective) {
      delete state.nightActions.roleActions[actorId];
      continue;
    }
    state.nightActions.roleActions[actorId] = effective;
    applyPrestageEffect(room, state, actor, effective);
  }

  normalizeCoreSubmissions(room, state);

  for (const [actorId, current] of Object.entries({ ...state.nightActions.roleActions })) {
    if (isPrestageAction(current) || current.option === "__pass__") continue;
    const actor = validLivingPlayer(state, actorId);
    if (!actor || roundDisabled(room, state, actor.id) || consumeNextSkillBlock(room, state, actor.id)) {
      delete state.nightActions.roleActions[actorId];
      continue;
    }
    const effective = redirectedAndValidatedAction(room, state, actor, current);
    if (!effective) delete state.nightActions.roleActions[actorId];
    else state.nightActions.roleActions[actorId] = effective;
  }
}

function isPrestageAction(action: RoleActionSubmission): boolean {
  if (!PRESTAGE_EFFECTS.has(action.effect)) return false;
  if (action.effect === "curse_caster_mark") return action.option === "block";
  if (action.effect === "warlock_choice") return action.option === "nullify";
  if (action.effect === "alchemist_sequence") return true;
  return true;
}

function applyPrestageEffect(room: any, state: GameState, actor: Player, action: RoleActionSubmission): void {
  const target = action.targetIds[0] ? validLivingPlayer(state, action.targetIds[0]) : undefined;
  if (!target) return;
  const tm = room.mem(state, target.id) as Record<string, any>;
  const am = room.mem(state, actor.id) as Record<string, any>;
  if (action.effect === "disable_current_action") tm.disabledUntilRound = state.round;
  if (action.effect === "disable_permanently") tm.disabledPermanently = true;
  if (action.effect === "hide_inspection_result") tm.inspectionHiddenRound = state.round;
  if (action.effect === "warlock_choice" && action.option === "nullify") tm.disabledUntilRound = state.round;
  if (action.effect === "alchemist_sequence" && Number(am.alchemistStage ?? 0) === 0) tm.disabledUntilRound = state.round;
  if (action.effect === "observe_and_redirect" || action.effect === "redirect_targeted_action") tm.redirectNextActionTo = actor.id;
  if (action.effect === "disable_next_action" || action.effect === "copy_ability_and_block" || action.effect === "pollen_block" || (action.effect === "curse_caster_mark" && action.option === "block")) {
    tm.nextActionDisabledCount = Number(tm.nextActionDisabledCount ?? 0) + 1;
  }
  if (action.effect === "spend_stacks_to_disable") {
    if (Number(am.vomitStacks ?? 0) <= 0) return;
    tm.nextActionOrVoteDisabledCount = Number(tm.nextActionOrVoteDisabledCount ?? 0) + 1;
  }
}

function redirectedAndValidatedAction(room: any, state: GameState, actor: Player, action: RoleActionSubmission): RoleActionSubmission | undefined {
  const memory = room.mem(state, actor.id) as Record<string, any>;
  const targetIds = [...action.targetIds];
  const redirectTo = memory.redirectNextActionTo;
  if (typeof redirectTo === "string" && targetIds.length) {
    targetIds[0] = redirectTo;
    delete memory.redirectNextActionTo;
  }
  const prompt = promptForSubmittedEffect(room, state, actor, action.effect);
  if (prompt && !selectionLegal(room, state, actor, prompt, targetIds, action.option)) return undefined;
  if (playerFaction(actor) === "village") {
    const demon = targetIds.map((id) => validLivingPlayer(state, id)).find((target) => target?.role === "demon_wolf" && room.mem(state, target.id).retaliationUsed !== true);
    if (demon) {
      room.mem(state, demon.id).retaliationUsed = true;
      room.killPlayer(state, actor.id, "demon_wolf_retaliation", demon.id, true);
      return undefined;
    }
  }
  return { ...action, targetIds };
}

function normalizeCoreSubmissions(room: any, state: GameState): void {
  for (const actor of state.players) {
    if (!actor.alive || actor.isSpectator || actor.kickedAt) continue;
    const memory = room.mem(state, actor.id) as Record<string, any>;
    const redirectTo = typeof memory.redirectNextActionTo === "string" ? memory.redirectNextActionTo : undefined;
    if (actor.role === "seer" && typeof state.nightActions.seerTargets[actor.id] === "string") {
      if (redirectTo) state.nightActions.seerTargets[actor.id] = redirectTo;
      delete memory.redirectNextActionTo;
      const target = validLivingPlayer(state, state.nightActions.seerTargets[actor.id]!);
      if (!target || target.id === actor.id || consumeNextSkillBlock(room, state, actor.id)) delete state.nightActions.seerTargets[actor.id];
      continue;
    }
    if (actor.role === "guard" && typeof state.nightActions.guardTargets[actor.id] === "string") {
      if (redirectTo) state.nightActions.guardTargets[actor.id] = redirectTo;
      delete memory.redirectNextActionTo;
      const targetId = state.nightActions.guardTargets[actor.id]!;
      const target = validLivingPlayer(state, targetId);
      if (!target || !canGuardTarget(state.guardLastTargets[actor.id], targetId) || consumeNextSkillBlock(room, state, actor.id)) delete state.nightActions.guardTargets[actor.id];
      continue;
    }
    const witch = state.nightActions.witchActions[actor.id];
    if (actor.role === "witch" && witch) {
      if (redirectTo && witch.type === "poison") state.nightActions.witchActions[actor.id] = { type: "poison", targetId: redirectTo };
      delete memory.redirectNextActionTo;
      const effective = state.nightActions.witchActions[actor.id];
      const target = effective?.type === "poison" ? validLivingPlayer(state, effective.targetId) : undefined;
      if ((effective?.type === "poison" && (!target || target.id === actor.id)) || consumeNextSkillBlock(room, state, actor.id)) delete state.nightActions.witchActions[actor.id];
      continue;
    }
  }
}

function consumeNextSkillBlock(room: any, state: GameState, playerId: string): boolean {
  const memory = room.mem(state, playerId) as Record<string, any>;
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

function buildEffectiveNightSnapshot(state: GameState): EffectiveNightAction[] {
  const snapshot: EffectiveNightAction[] = [];
  for (const [actorId, action] of Object.entries(state.nightActions.roleActions)) {
    if (action.option === "__pass__") continue;
    snapshot.push({ actorId, effect: action.effect, targetIds: [...action.targetIds], source: "role" });
  }
  for (const [actorId, targetId] of Object.entries(state.nightActions.seerTargets)) snapshot.push({ actorId, effect: "inspect_team", targetIds: [targetId], source: "seer" });
  for (const [actorId, targetId] of Object.entries(state.nightActions.guardTargets)) snapshot.push({ actorId, effect: "protect", targetIds: [targetId], source: "guard" });
  for (const [actorId, action] of Object.entries(state.nightActions.witchActions)) {
    if (action.type === "poison") snapshot.push({ actorId, effect: "witch_poison", targetIds: [action.targetId], source: "witch" });
    else if (action.type === "heal") snapshot.push({ actorId, effect: "witch_heal", targetIds: [], source: "witch" });
  }
  for (const [actorId, targetId] of Object.entries(state.nightActions.wolfVotes)) snapshot.push({ actorId, effect: "wolf_kill", targetIds: [targetId], source: "wolf" });
  return snapshot;
}

function describeEffectiveAction(room: any, state: GameState, targetId: string): string {
  const actions = (room.__post28NightSnapshot as EffectiveNightAction[] | undefined)?.filter((action) => action.actorId === targetId) ?? [];
  if (!actions.length) return "無有效主動技能";
  return actions.map((action) => {
    const names = action.targetIds.map((id) => state.players.find((player) => player.id === id)?.name ?? id);
    return names.length ? `${action.effect} → ${names.join("、")}` : action.effect;
  }).join("；");
}

function wasEffectivelyTargetedByOther(room: any, targetId: string, actorId: string): boolean {
  const actions = room.__post28NightSnapshot as EffectiveNightAction[] | undefined;
  return Boolean(actions?.some((action) => action.actorId !== actorId && action.targetIds.includes(targetId)));
}

function findElderForceDawn(state: GameState): { actor: Player; action: RoleActionSubmission } | undefined {
  for (const [actorId, action] of Object.entries(state.nightActions.roleActions)) {
    if ((action as any).effect !== "elder_force_dawn" || action.option === "__pass__") continue;
    const actor = validLivingPlayer(state, actorId);
    if (actor?.role === "elder_wolf") return { actor, action };
  }
  return undefined;
}

function resolveElderForceDawn(room: any, state: GameState, actor: Player, action: RoleActionSubmission): void {
  const target = action.targetIds[0] ? validLivingPlayer(state, action.targetIds[0]) : undefined;
  if (!target) return;
  room.killPlayer(state, target.id, "elder_force_dawn", actor.id, true);
  const system = room.systemMem(state) as Record<string, any>;
  system.earlyDawnRound = state.round;
  room.addSystemMessage(state, `${actor.name}（長老狼）發動強制死亡，本夜其餘尚未結算行動全部取消並立即進入天亮結算。`);
  state.nightActions.wolfVotes = {};
  state.nightActions.seerTargets = {};
  state.nightActions.guardTargets = {};
  state.nightActions.witchActions = {};
  state.nightActions.roleActions = {};
}

function queueDawnDeath(room: any, state: GameState, targetId: string, reason: string, killerId: string): void {
  const system = room.systemMem(state) as Record<string, any>;
  const queue = Array.isArray(system.dawnDeathQueue) ? system.dawnDeathQueue.filter((item: unknown): item is string => typeof item === "string") : [];
  const value = `${targetId}|${reason}|${killerId}`;
  if (!queue.some((item: string) => item.startsWith(`${targetId}|`))) queue.push(value);
  system.dawnDeathQueue = queue;
}

function resolveDawnDeaths(room: any, state: GameState): void {
  const system = room.systemMem(state) as Record<string, any>;
  const queue = Array.isArray(system.dawnDeathQueue) ? system.dawnDeathQueue.filter((item: unknown): item is string => typeof item === "string") : [];
  delete system.dawnDeathQueue;
  for (const raw of queue) {
    const [targetId, reason, killerId] = raw.split("|");
    if (targetId) room.killPlayer(state, targetId, `dawn_${reason || "effect"}`, killerId || undefined, true);
  }
}

export function revivePlayerInvariant(room: any, state: GameState, player: Player): void {
  player.alive = true;
  player.isSpectator = false;
  delete state.deathReasons[player.id];
  const memory = room.mem(state, player.id) as Record<string, any>;
  delete memory.fakeDeath;
  delete memory.reviveRound;
  delete memory.bloodLastStandRound;
  for (const key of Object.keys(memory)) if (key.startsWith("announced:")) delete memory[key];
  if (player.role === "betrayer") {
    delete player.factionOverride;
    delete memory.winningAllegiance;
  }
  if (state.pendingReaction?.actorId === player.id) delete state.pendingReaction;
  const system = room.systemMem(state) as Record<string, any>;
  const queue = Array.isArray(system.deathReactionQueue) ? system.deathReactionQueue.filter((item: unknown): item is string => typeof item === "string") : [];
  system.deathReactionQueue = queue.filter((raw: string) => !raw.startsWith(`${player.id}|`));
}

function reconcileDeathTransitions(state: GameState): void {
  const livingSeer = state.players.some((player) => countsAsAliveForDeathGate(state, player) && player.role === "seer");
  if (!livingSeer) for (const player of state.players) if (player.role === "apprentice_seer" && countsAsAliveForDeathGate(state, player)) player.role = "seer";
  const fists = state.players.filter((player) => player.role === "fist_brother" && countsAsAliveForDeathGate(state, player));
  if (fists.length === 1) fists[0]!.role = "coward";
}

function clearCopiesWhoseSourceDied(room: any, state: GameState, sourceId?: string): void {
  for (const player of state.players.filter((candidate) => candidate.role === "vampire_wolf_copy")) {
    const memory = room.mem(state, player.id) as Record<string, any>;
    const copiedSourceId = typeof memory.copiedSourceId === "string" ? memory.copiedSourceId : undefined;
    if (!copiedSourceId || (sourceId && copiedSourceId !== sourceId)) continue;
    const source = state.players.find((candidate) => candidate.id === copiedSourceId);
    if (!source || !countsAsAliveForDeathGate(state, source)) {
      delete memory.copiedRole;
      delete memory.copiedSourceId;
      delete memory.copiedAbilityUsed;
    }
  }
}

function copiedPrompt(room: any, state: GameState, actor: Player): CopiedPrompt | undefined {
  if (actor.role !== "vampire_wolf_copy" || !actor.alive || actor.isSpectator || actor.kickedAt) return undefined;
  const memory = room.mem(state, actor.id) as Record<string, any>;
  const copiedRole = typeof memory.copiedRole === "string" ? memory.copiedRole : undefined;
  const sourceId = typeof memory.copiedSourceId === "string" ? memory.copiedSourceId : undefined;
  if (!copiedRole || !sourceId) return undefined;
  const source = state.players.find((candidate) => candidate.id === sourceId);
  if (!source || !countsAsAliveForDeathGate(state, source)) return undefined;
  const definition = roleDefinition(copiedRole as any);
  const action = definition?.action;
  if (!action || action.timing === "reaction" || action.timing === "setup" || action.timing === "sheriff") return undefined;
  if (FIRST_NIGHT_ONLY.get(copiedRole) === action.effect && state.round !== 1) return undefined;
  const timingMatches = (action.timing === "night" && state.phase === "night") || (action.timing === "day" && state.phase === "debate") || (action.timing === "vote" && state.phase === "vote");
  if (!timingMatches || (action.fromRound && state.round < action.fromRound)) return undefined;
  if (action.oncePerGame && memory.copiedAbilityUsed === true) return undefined;
  return {
    role: actor.role,
    timing: action.timing,
    effect: action.effect,
    targetMode: action.targetMode,
    ...(action.options ? { options: action.options } : {}),
    ...(action.oncePerGame ? { oncePerGame: true } : {}),
    label: `吸血狼複製：${definition.name}`,
    description: `目前複製 ${definition.name} 的主動能力；來源玩家死亡後失效。`,
    copiedFromRole: copiedRole,
    copiedSourceId: sourceId
  };
}

function isCopiedAction(room: any, state: GameState, actor: Player, action: RoleActionSubmission): boolean {
  const prompt = copiedPrompt(room, state, actor);
  return Boolean(prompt && prompt.effect === action.effect);
}

function resolveCopiedWitch(room: any, state: GameState, actor: Player, action: RoleActionSubmission): void {
  if (action.option === "poison") {
    const target = action.targetIds[0] ? validLivingPlayer(state, action.targetIds[0]) : undefined;
    if (target) room.killPlayer(state, target.id, "copied_witch_poison", actor.id);
    return;
  }
  if (action.option === "heal") {
    const victimId = room.wolfTarget(state);
    if (typeof victimId === "string") room.mem(state, victimId).nightProtectedRound = state.round;
  }
}

function promptForSubmittedEffect(room: any, state: GameState, actor: Player, effect: string): RoleActionPrompt | undefined {
  const copied = copiedPrompt(room, state, actor);
  if (copied?.effect === effect) return copied;
  if (actor.role === "elder_wolf" && effect === "elder_force_dawn") return roleActionPrompt(actor, state);
  const prompt = roleActionPrompt(actor, state);
  return prompt?.effect === effect ? prompt : undefined;
}

function validatePromptSelection(room: any, state: GameState, actor: Player, prompt: RoleActionPrompt, targetIds: string[], option?: string): void {
  if (!selectionLegal(room, state, actor, prompt, targetIds, option)) throw new Error("技能目標或選項無效");
}

function selectionLegal(room: any, state: GameState, actor: Player, prompt: RoleActionPrompt, targetIds: string[], option?: string): boolean {
  const required = minimumTargets(prompt.targetMode);
  const optional = prompt.targetMode === "optional_alive_other";
  if ((!optional && targetIds.length !== required) || (optional && targetIds.length > 1) || new Set(targetIds).size !== targetIds.length) return false;
  if (prompt.options && (!option || !prompt.options.includes(option))) return false;
  const legal = new Set(legalTargetsForPrompt(room, state, actor, prompt).map((player: Player) => player.id));
  return targetIds.every((id) => legal.has(id));
}

function legalTargetsForPrompt(room: any, state: GameState, actor: Player, prompt: RoleActionPrompt): Player[] {
  let targets = room.legalTargets(state, actor, prompt.targetMode) as Player[];
  if (prompt.effect === "protect" && (actor.role === "guard" || copiedPrompt(room, state, actor)?.copiedFromRole === "guard")) {
    targets = targets.filter((target) => canGuardTarget(state.guardLastTargets[actor.id], target.id));
  }
  return targets;
}

function minimumTargets(mode: string): number {
  if (mode === "none" || mode === "optional_alive_other") return 0;
  return mode.startsWith("two_") ? 2 : 1;
}

function validLivingPlayer(state: GameState, id: string): Player | undefined {
  return state.players.find((player) => player.id === id && player.alive && !player.isSpectator && !player.kickedAt);
}

function roundDisabled(room: any, state: GameState, playerId: string): boolean {
  const memory = room.mem(state, playerId) as Record<string, any>;
  if (memory.disabledPermanently === true) return true;
  if (typeof memory.disabledUntilRound === "number" && memory.disabledUntilRound >= state.round) return true;
  if (room.systemMem(state).goodSkillsDisabledRound === state.round) {
    const player = state.players.find((candidate) => candidate.id === playerId);
    if (player && playerFaction(player) === "village") return true;
  }
  return false;
}

function wolfIdentityHidden(room: any, state: GameState, player: Player): boolean {
  if (!player.role) return false;
  const hidden = new Set(roleDefinition(player.role).passives ?? []).has("hidden_from_wolf_list");
  if (!hidden) return false;
  if (player.role === "lurking_wolf" && room.mem(state, player.id).awake === true) return false;
  return true;
}

function looksLikeWolfToOrdinaryPack(player: Player): boolean {
  if (!player.role) return false;
  return new Set(roleDefinition(player.role).passives ?? []).has("seer_looks_werewolf");
}

function safeCouncilCohort(room: any, state: GameState, actor: Player): boolean {
  if (playerFaction(actor) !== "werewolf" || wolfIdentityHidden(room, state, actor)) return false;
  const cohort = [actor, ...(room.wolfTeammates(state, actor) as Player[])];
  return cohort.length >= 2 && cohort.every((player) => player.isAI && player.ai);
}

async function runSafeWolfCouncilAI(room: any, state: GameState, actor: Player, taskContext: AITaskContext, apiKeys: string[]): Promise<{ ok: true }> {
  const cohort = [actor, ...(room.wolfTeammates(state, actor) as Player[])];
  if (cohort.length < 2 || cohort.some((player) => !player.isAI || !player.ai)) return { ok: true };
  const result = await callAIWithKeys(apiKeys, {
    config: actor.ai,
    system: room.aiSystemPrompt(actor, state),
    prompt: `${room.privateContext(state, actor)}\n\n目前可相認的狼隊成員全部由 AI 操作。只和依法可見的狼隊成員討論今晚刀口。請用 20~70 個繁體中文字，只回 JSON：{"message":"內容"}。`
  });
  const parsed = parseJSONObject(result.text) as Record<string, unknown>;
  const content = typeof parsed.message === "string" && parsed.message.trim() ? room.normalizeChat(parsed.message) : "請可相認的狼隊成員綜合公開資訊決定今晚刀口。";
  const current = room.requireState() as GameState;
  if (!isCurrentAITask(room, current, taskContext)) return { ok: true };
  const nowActor = current.players.find((player) => player.id === actor.id && player.alive && player.isAI && !player.isSpectator && !player.kickedAt && player.ai);
  if (!nowActor || !safeCouncilCohort(room, current, nowActor)) return { ok: true };
  const audienceIds = [nowActor.id, ...(room.wolfTeammates(current, nowActor) as Player[]).map((player) => player.id)];
  const message = room.chatMessage(current, nowActor, content);
  message.channel = "werewolf";
  message.audienceIds = audienceIds;
  current.messages.push(message);
  const system = room.systemMem(current) as Record<string, any>;
  const used = Array.isArray(system.coreWolfCouncilActors) ? system.coreWolfCouncilActors.filter((id: unknown): id is string => typeof id === "string") : [];
  if (!used.includes(nowActor.id)) used.push(nowActor.id);
  system.coreWolfCouncilActors = used;
  room.trimMessages(current);
  room.touchAndSave(current);
  room.broadcast(current);
  return { ok: true };
}

export function normalizeDebateSlots(state: GameState): boolean {
  if (state.phase !== "debate") return false;
  const completed = new Map<string, number>();
  for (const id of state.debateCompleted) completed.set(id, (completed.get(id) ?? 0) + 1);
  const occurrences = new Map<string, number>();
  for (let index = 0; index < state.debateOrder.length; index += 1) {
    const id = state.debateOrder[index]!;
    const ordinal = (occurrences.get(id) ?? 0) + 1;
    occurrences.set(id, ordinal);
    const player = state.players.find((candidate) => candidate.id === id);
    const done = completed.get(id) ?? 0;
    if (!player || !player.alive || player.isSpectator || player.kickedAt) {
      if (done < ordinal) {
        state.debateCompleted.push(id);
        completed.set(id, done + 1);
      }
      continue;
    }
    if (done < ordinal) {
      const changed = state.debateIndex !== index;
      state.debateIndex = index;
      return changed;
    }
  }
  const changed = state.debateIndex !== state.debateOrder.length;
  state.debateIndex = state.debateOrder.length;
  return changed;
}

function speechCount(state: GameState, playerId: string): number {
  return state.debateCompleted.filter((id) => id === playerId).length;
}

function magicianWillSwapRoles(state: GameState, targetIds: string[]): boolean {
  if (targetIds.length !== 2) return false;
  const [a, b] = targetIds.map((id) => state.players.find((player) => player.id === id));
  if (!a || !b) return false;
  const aDead = isRealDeadForDeathGate(state, a);
  const bDead = isRealDeadForDeathGate(state, b);
  if (aDead !== bDead) return false;
  return !(a.alive && b.alive && (state.phase === "debate" || state.phase === "vote"));
}

function swapWinningAllegiances(room: any, state: GameState, targetIds: string[], before: unknown[]): void {
  if (targetIds.length !== 2) return;
  const [aId, bId] = targetIds;
  const aMemory = room.mem(state, aId) as Record<string, any>;
  const bMemory = room.mem(state, bId) as Record<string, any>;
  const [a, b] = before;
  if (b === "village" || b === "werewolf" || b === "spirit") aMemory.winningAllegiance = b; else delete aMemory.winningAllegiance;
  if (a === "village" || a === "werewolf" || a === "spirit") bMemory.winningAllegiance = a; else delete bMemory.winningAllegiance;
}

function formalLiving(state: GameState): Player[] {
  return activePlayers(state.players).filter((player) => player.alive && !player.kickedAt);
}

function canonicalLivingLoverGroups(state: GameState): string[][] {
  const groups = new Map<string, string[]>();
  for (const player of formalLiving(state)) {
    const members = loverGroupMembers(state, player.id).filter((id) => formalLiving(state).some((candidate) => candidate.id === id));
    if (members.length < 2) continue;
    const key = [...members].sort().join("|");
    groups.set(key, [...new Set(members)]);
  }
  return [...groups.values()];
}

function soleLivingLoverGroup(state: GameState): string[] | undefined {
  const alive = formalLiving(state);
  if (alive.length < 2) return undefined;
  return canonicalLivingLoverGroups(state).find((group) => group.length === alive.length && alive.every((player) => group.includes(player.id)));
}

function mixedLivingLoverGroupBlocksFactionWin(state: GameState): boolean {
  return canonicalLivingLoverGroups(state).some((group) => {
    const factions = new Set(group.map((id) => state.players.find((player) => player.id === id)).filter(Boolean).map((player) => playerFaction(player!)).filter(Boolean));
    return factions.size > 1;
  });
}

function augmentWinningAllegiance(room: any, state: GameState, winner: string): void {
  if (!state.winner) return;
  const ids = new Set(state.winnerPlayerIds ?? []);
  for (const player of activePlayers(state.players).filter((candidate) => !candidate.kickedAt)) {
    const allegiance = room.mem(state, player.id).winningAllegiance;
    if (allegiance === winner) ids.add(player.id);
  }
  state.winnerPlayerIds = [...ids];
}

function armEmptyRoomCleanup(room: any, state: GameState): void {
  if (openSocketCount(room) > 0) {
    clearEmptyRoomCleanup(room, state);
    return;
  }
  const system = room.systemMem(state) as Record<string, any>;
  system.roomEmptyDisposeAt = Date.now() + EMPTY_ROOM_GRACE_MS;
  room.touchAndSave(state);
  scheduleNextAlarm(room, state);
}

function clearEmptyRoomCleanup(room: any, state: GameState): void {
  const system = room.systemMem(state) as Record<string, any>;
  if (system.roomEmptyDisposeAt === undefined) return;
  delete system.roomEmptyDisposeAt;
  room.touchAndSave(state);
  scheduleNextAlarm(room, state);
}

function emptyCleanupExpired(room: any, state: GameState): boolean {
  const value = Number(room.systemMem(state).roomEmptyDisposeAt ?? NaN);
  return Number.isFinite(value) && value <= Date.now();
}

function scheduleNextAlarm(room: any, state: GameState): void {
  const system = room.systemMem(state) as Record<string, any>;
  const phase = typeof system.phaseDeadlineAt === "number" ? system.phaseDeadlineAt : undefined;
  const empty = openSocketCount(room) === 0 && typeof system.roomEmptyDisposeAt === "number" ? system.roomEmptyDisposeAt : undefined;
  const next = [phase, empty].filter((value): value is number => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b)[0];
  if (next) void room.ctx?.storage?.setAlarm?.(next);
  else void room.ctx?.storage?.deleteAlarm?.();
}

function openSocketCount(room: any): number {
  const sockets = typeof room.ctx?.getWebSockets === "function" ? room.ctx.getWebSockets() : [];
  return sockets.filter((socket: any) => socket?.readyState === 1).length;
}

function safeState(room: any): GameState | undefined {
  try { return room.requireState() as GameState; }
  catch { return undefined; }
}

async function disbandRoom(room: any, reason: string): Promise<void> {
  const state = safeState(room);
  if (!state) throw new Error("房間不存在");
  const roomId = state.roomId;
  const removedAt = Date.now();
  for (const socket of typeof room.ctx?.getWebSockets === "function" ? room.ctx.getWebSockets() : []) {
    try { socket.close(4000, reason); } catch { /* best effort */ }
  }
  if (typeof room.ctx?.storage?.deleteAll === "function") await room.ctx.storage.deleteAll();
  room.stateCache = undefined;
  if (room.env?.ROOM_DIRECTORY) {
    await room.env.ROOM_DIRECTORY.getByName("global").unregisterRoom(roomId, removedAt);
  }
}
