import { callAIWithKeys, parseJSONObject } from "./ai.js";
import { areNightActionsComplete, livingPlayers, playerFaction, roleActionPrompt } from "./game-engine.js";
import type { GameState, Player, RoleActionPrompt, RoleActionSubmission } from "./types.js";

type RoomPrototype = Record<string, any> & { __coreIntegrityRulesInstalled?: boolean };
type RuntimeAITask = { playerId: string; operation: string };
type ResumePhase = "night" | "debate" | "vote" | "ended";

const PASS_OPTION = "__pass__";
const UNAVAILABLE_PASS = "__core_unavailable__";

export function installCoreIntegrityRules(GameRoomCtor: { prototype: RoomPrototype }): void {
  const proto = GameRoomCtor.prototype;
  if (proto.__coreIntegrityRulesInstalled) return;
  proto.__coreIntegrityRulesInstalled = true;

  const originalEnterNight = proto.enterNight;
  const originalBeginDebate = proto.beginDebate;
  const originalEnterVote = proto.enterVote;
  const originalAfterNightSubmission = proto.afterNightSubmission;
  const originalFinishNight = proto.finishNight;
  const originalSubmitDebateSpeech = proto.submitDebateSpeech;
  const originalRecordDebateSpeech = proto.recordDebateSpeech;
  const originalKickPlayerInternal = proto.kickPlayerInternal;
  const originalQueueDeathReaction = proto.queueDeathReaction;
  const originalCheckAndMaybeEnd = proto.checkAndMaybeEnd;
  const originalEndGame = proto.endGame;
  const originalProjectState = proto.projectState;
  const originalPendingAITask = proto.pendingAITask;
  const originalSubmitRoleActionInternal = proto.submitRoleActionInternal;
  const originalResolveNightRoleAction = proto.resolveNightRoleAction;
  const originalResolveImmediateRoleAction = proto.resolveImmediateRoleAction;
  const originalRunAI = proto.runAI;

  if (typeof originalQueueDeathReaction === "function") {
    proto.queueDeathReaction = function (state: GameState, actorId: string, reason: string, _resumePhase: ResumePhase): void {
      const resume = canonicalReactionResume(state, reason);
      const hadPending = Boolean(state.pendingReaction);
      originalQueueDeathReaction.call(this, state, actorId, reason, resume);
      if (!hadPending && state.pendingReaction) state.pendingReaction.resumePhase = resume;
      if (state.pendingReaction && state.phase !== "night") state.phase = "reaction";
    };
  }

  if (typeof originalEnterNight === "function") {
    proto.enterNight = function (state: GameState, round: number): void {
      if (deferTransitionForReaction(this, state, "night")) return;
      if (resolvePendingTerminal(this, state)) return;
      const result = originalEnterNight.call(this, state, round);
      if (state.phase !== "night") return result;
      const changed = markUnavailableNightActions(this, state);
      if (changed && areNightActionsComplete(state)) return this.finishNight(state);
      if (changed) this.saveBroadcast(state);
      return result;
    };
  }

  if (typeof originalBeginDebate === "function") {
    proto.beginDebate = function (state: GameState): void {
      if (deferTransitionForReaction(this, state, "debate")) return;
      if (resolvePendingTerminal(this, state)) return;
      const result = originalBeginDebate.call(this, state);
      if (state.phase === "debate") reconcileDebate(this, state, true);
      return result;
    };
  }

  if (typeof originalEnterVote === "function") {
    proto.enterVote = function (state: GameState): void {
      if (deferTransitionForReaction(this, state, "vote")) return;
      if (resolvePendingTerminal(this, state)) return;
      return originalEnterVote.call(this, state);
    };
  }

  if (typeof originalAfterNightSubmission === "function") {
    proto.afterNightSubmission = function (state: GameState): void {
      const result = originalAfterNightSubmission.call(this, state);
      if (state.phase !== "night") return result;
      const changed = markUnavailableNightActions(this, state);
      if (areNightActionsComplete(state)) return this.finishNight(state);
      if (changed) this.saveBroadcast(state);
      return result;
    };
  }

  if (typeof originalFinishNight === "function") {
    proto.finishNight = function (state: GameState): void {
      preStageNightControlEffects(this, state);
      suppressDisabledCoreNightSubmissions(this, state);
      return originalFinishNight.call(this, state);
    };
  }

  if (typeof originalRecordDebateSpeech === "function") {
    proto.recordDebateSpeech = function (state: GameState, actor: Player, text: string, locale?: string): void {
      const result = originalRecordDebateSpeech.call(this, state, actor, text, locale);
      if (state.phase === "debate") normalizeDebateCursor(state);
      return result;
    };
  }

  if (typeof originalSubmitDebateSpeech === "function") {
    proto.submitDebateSpeech = function (...args: any[]): void {
      const state = this.requireState() as GameState;
      reconcileDebate(this, state, false);
      if (state.phase !== "debate") throw new Error("正式辯論已完成");
      return originalSubmitDebateSpeech.apply(this, args);
    };
  }

  if (typeof originalKickPlayerInternal === "function") {
    proto.kickPlayerInternal = function (state: GameState, targetId: string, sourceLabel: string): void {
      const wasReactionActor = state.phase === "reaction" && state.pendingReaction?.actorId === targetId;
      const result = originalKickPlayerInternal.call(this, state, targetId, sourceLabel);
      if (state.winner) return result;
      if (wasReactionActor && state.pendingReaction?.actorId === targetId) resumeReactionWithoutAction(this, state);
      reconcileCurrentPhase(this, state);
      return result;
    };
  }

  if (typeof originalCheckAndMaybeEnd === "function") {
    proto.checkAndMaybeEnd = function (state: GameState): void {
      if (hasPendingMandatoryReaction(this, state)) return;
      if (resolvePendingTerminal(this, state)) return;
      return originalCheckAndMaybeEnd.call(this, state);
    };
  }

  if (typeof originalEndGame === "function") {
    proto.endGame = function (state: GameState, winner: any): void {
      if (winner === "neutral" && (!state.winnerPlayerIds || state.winnerPlayerIds.length === 0)) {
        const ids = neutralWinnerIds(state);
        if (ids.length) state.winnerPlayerIds = ids;
      }
      return originalEndGame.call(this, state, winner);
    };
  }

  if (typeof originalProjectState === "function") {
    proto.projectState = function (state: GameState, token: string): any {
      if (state.phase === "debate") normalizeDebateCursor(state);
      const view = originalProjectState.call(this, state, token);
      if (!view?.me) return view;
      const actor = this.playerByToken(state, token) as Player;
      const prompt = roleActionPrompt(actor, state);
      if (!prompt || !coreActionAvailable(state, actor, prompt)) delete view.roleAction;
      else if (view.roleAction) {
        const options = coreActionOptions(state, actor, prompt);
        if (prompt.options) view.roleAction.options = options;
        if (prompt.effect === "suicide_bomb") {
          view.roleAction.minTargets = 0;
          view.roleAction.maxTargets = 2;
        }
        if (prompt.effect === "alchemist_sequence") {
          const stage = Number(state.roleMemory[actor.id]?.alchemistStage ?? 0);
          view.roleAction.minTargets = stage === 1 ? 0 : 1;
          view.roleAction.maxTargets = stage === 1 ? 0 : 1;
        }
      }
      view.me.isFakeDead = isFakeDead(state, actor.id);
      return view;
    };
  }

  if (typeof originalPendingAITask === "function") {
    proto.pendingAITask = function (state: GameState): RuntimeAITask | undefined {
      if (state.phase === "debate") {
        reconcileDebate(this, state, false);
        if (state.phase !== "debate") return this.pendingAITask(state);
      }
      if (state.phase === "night") markUnavailableNightActions(this, state);
      return originalPendingAITask.call(this, state) as RuntimeAITask | undefined;
    };
  }

  if (typeof originalSubmitRoleActionInternal === "function") {
    proto.submitRoleActionInternal = function (state: GameState, actor: Player, effect: string, targetIds: string[], option?: string): void {
      const prompt = roleActionPrompt(actor, state);
      if (!prompt || prompt.effect !== effect || !coreActionAvailable(state, actor, prompt)) throw new Error("目前沒有這個角色技能可用");
      validateCoreActionSelection(this, state, actor, prompt, targetIds, option);
      if (effect === "suicide_bomb") {
        const submission: RoleActionSubmission = { effect: effect as any, targetIds: [...targetIds], ...(option ? { option } : {}), submittedAt: Date.now() };
        this.resolveImmediateRoleAction(state, actor, submission);
        if (prompt.oncePerGame) this.mem(state, actor.id)[`used:${effect}`] = true;
        return;
      }
      return originalSubmitRoleActionInternal.call(this, state, actor, effect, targetIds, option);
    };
  }

  if (typeof originalResolveNightRoleAction === "function") {
    proto.resolveNightRoleAction = function (state: GameState, actor: Player, action: RoleActionSubmission): void {
      if (action.effect === "fake_kill") return resolveFakeKill(this, state, actor, action);
      if (action.effect === "magician_swap") return resolveMagicianSwap(this, state, actor, action);
      if (action.effect === "raven_vote_curse") {
        const target = state.players.find((player) => player.id === action.targetIds[0] && player.alive && !player.isSpectator && !player.kickedAt);
        if (target) {
          this.mem(state, target.id).ravenInvalidVoteRound = state.round;
          this.mem(state, actor.id).ravenVote = target.id;
        }
        return;
      }
      return originalResolveNightRoleAction.call(this, state, actor, action);
    };
  }

  if (typeof originalResolveImmediateRoleAction === "function") {
    proto.resolveImmediateRoleAction = function (state: GameState, actor: Player, action: RoleActionSubmission): void {
      if (action.effect === "suicide_bomb") return resolveSuicideBomb(this, state, actor, action);
      const override = forcedResumeForImmediate(state, actor, action);
      const runtime = state as any;
      const previous = runtime.__coreReactionResumeOverride;
      if (override) runtime.__coreReactionResumeOverride = override;
      try {
        const result = originalResolveImmediateRoleAction.call(this, state, actor, action);
        if (state.phase === "debate" && !hasPendingMandatoryReaction(this, state)) reconcileDebate(this, state, true);
        return result;
      } finally {
        if (previous === undefined) delete runtime.__coreReactionResumeOverride;
        else runtime.__coreReactionResumeOverride = previous;
      }
    };
  }

  if (typeof originalRunAI === "function") {
    proto.runAI = async function (hostToken: string, playerId: string, apiKeys: string[]): Promise<{ ok: true }> {
      const before = this.requireState() as GameState;
      this.assertHost(before, hostToken);
      const task = this.pendingAITask(before) as RuntimeAITask | undefined;
      if (!task || task.playerId !== playerId) throw new Error("此 AI 目前沒有待執行操作");
      const actor = before.players.find((player) => player.id === playerId && player.isAI && player.alive && !player.isSpectator && player.ai);
      if (!actor?.ai || !["role_action", "reaction_action"].includes(task.operation)) return originalRunAI.call(this, hostToken, playerId, apiKeys);
      const rawPrompt = roleActionPrompt(actor, before);
      if (!rawPrompt || !rawPrompt.options?.length || !coreActionAvailable(before, actor, rawPrompt)) return originalRunAI.call(this, hostToken, playerId, apiKeys);
      return runStructuredOptionAI(this, before, actor, task, apiKeys);
    };
  }
}

export function normalizeDebateCursor(state: GameState): boolean {
  if (state.phase !== "debate") return false;
  let changed = false;
  while (state.debateIndex < state.debateOrder.length) {
    const id = state.debateOrder[state.debateIndex];
    const player = state.players.find((candidate) => candidate.id === id);
    const valid = Boolean(player && player.alive && !player.isSpectator && !player.kickedAt && !state.debateCompleted.includes(id!));
    if (valid) break;
    state.debateIndex += 1;
    changed = true;
  }
  return changed;
}

export function coreActionAvailable(state: GameState, actor: Player, prompt = roleActionPrompt(actor, state)): boolean {
  if (!prompt || !actor.alive || actor.isSpectator || actor.kickedAt) return false;
  switch (prompt.effect) {
    case "kill_if_hive_dead":
      return state.players.some((player) => player.role === "hive" && !player.alive && !player.isSpectator);
    case "convert_to_werewolf_if_last": {
      const wolves = livingPlayers(state.players).filter((player) => !player.kickedAt && playerFaction(player) === "werewolf");
      return wolves.length === 1 && wolves[0]?.id === actor.id;
    }
    case "kill_if_no_wolves":
      return !livingPlayers(state.players).some((player) => !player.kickedAt && playerFaction(player) === "werewolf");
    case "cooldown_kill":
      return state.round % 2 === 0;
    case "necromancer_milestone": {
      const dead = state.players.filter((player) => !player.isSpectator && !player.kickedAt && !player.alive).length;
      return state.initialPlayerCount > 0 && dead / state.initialPlayerCount >= 0.25;
    }
    case "alchemist_sequence":
      return Number(state.roleMemory[actor.id]?.alchemistStage ?? 0) < 3;
    default:
      return true;
  }
}

export function coreActionOptions(state: GameState, actor: Player, prompt: RoleActionPrompt): string[] {
  if (!prompt.options) return [];
  const memory = state.roleMemory[actor.id] ?? {};
  return prompt.options.filter((option) => {
    if (prompt.effect === "warlock_choice") {
      if (option === "poison" && memory.warlockPoisonUsed === true) return false;
      if (option === "nullify" && memory.warlockNullifyUsed === true) return false;
    }
    if (prompt.effect === "freeze_or_detonate" && option === "detonate") {
      return Array.isArray(memory.frozenTargets) && memory.frozenTargets.length > 0;
    }
    return true;
  });
}

export function canonicalReactionResume(state: GameState, _reason: string): ResumePhase {
  const forced = (state as any).__coreReactionResumeOverride;
  if (forced === "night" || forced === "debate" || forced === "vote" || forced === "ended") return forced;
  if (state.phase === "reaction" && state.pendingReaction) return state.pendingReaction.resumePhase;
  if (state.phase === "night") return "debate";
  if (state.phase === "vote") return "night";
  if (state.phase === "debate") return "debate";
  return "night";
}

function reconcileCurrentPhase(room: any, state: GameState): void {
  if (state.winner || hasPendingMandatoryReaction(room, state)) return;
  if (state.phase === "debate") return reconcileDebate(room, state, true);
  if (state.phase === "night") {
    markUnavailableNightActions(room, state);
    if (areNightActionsComplete(state)) room.finishNight(state);
    return;
  }
  if (state.phase === "sheriff") return reconcileSheriff(room, state);
}

function reconcileDebate(room: any, state: GameState, transition: boolean): void {
  if (state.phase !== "debate") return;
  const changed = normalizeDebateCursor(state);
  if (state.debateIndex >= state.debateOrder.length && transition && !hasPendingMandatoryReaction(room, state)) {
    room.enterVote(state);
    return;
  }
  if (changed && transition) room.saveBroadcast(state);
}

function reconcileSheriff(room: any, state: GameState): void {
  if (state.phase !== "sheriff") return;
  const eligible = livingPlayers(state.players).filter((player) => !player.kickedAt);
  const eligibleIds = new Set(eligible.map((player) => player.id));
  state.sheriff.candidates = state.sheriff.candidates.filter((id) => eligibleIds.has(id));
  for (const [voterId, targetId] of Object.entries(state.sheriff.votes)) {
    if (!eligibleIds.has(voterId) || !state.sheriff.candidates.includes(targetId)) delete state.sheriff.votes[voterId];
  }
  if (eligible.every((player) => Boolean(state.sheriff.votes[player.id])) || state.sheriff.candidates.length === 0) room.finishSheriffElection(state);
  else room.saveBroadcast(state);
}

function deferTransitionForReaction(room: any, state: GameState, resume: ResumePhase): boolean {
  if (!state.pendingReaction) return false;
  state.pendingReaction.resumePhase = resume;
  state.phase = "reaction";
  room.saveBroadcast(state);
  return true;
}

function hasPendingMandatoryReaction(room: any, state: GameState): boolean {
  if (state.pendingReaction) return true;
  const queue = Array.isArray(room.systemMem(state).deathReactionQueue) ? room.systemMem(state).deathReactionQueue : [];
  return queue.length > 0;
}

function resumeReactionWithoutAction(room: any, state: GameState): void {
  const pending = state.pendingReaction;
  if (!pending) return;
  const resume = pending.resumePhase;
  delete state.pendingReaction;
  if (room.popDeathReaction(state)) {
    state.phase = "reaction";
    room.saveBroadcast(state);
    return;
  }
  if (resolvePendingTerminal(room, state)) return;
  if (resume === "night") room.enterNight(state, state.round + 1);
  else if (resume === "vote") room.enterVote(state);
  else room.beginDebate(state);
}

function markUnavailableNightActions(room: any, state: GameState): boolean {
  if (state.phase !== "night") return false;
  let changed = false;
  for (const actor of livingPlayers(state.players)) {
    if (actor.kickedAt || !actor.role || state.nightActions.roleActions[actor.id]) continue;
    const prompt = roleActionPrompt(actor, state);
    if (!prompt || prompt.timing !== "night" || coreActionAvailable(state, actor, prompt)) continue;
    state.nightActions.roleActions[actor.id] = { effect: prompt.effect, targetIds: [], option: PASS_OPTION, submittedAt: Date.now() };
    room.mem(state, actor.id).coreUnavailableSkip = UNAVAILABLE_PASS;
    changed = true;
  }
  return changed;
}

function preStageNightControlEffects(room: any, state: GameState): void {
  if (state.phase !== "night") return;
  const submissions = Object.entries(state.nightActions.roleActions);
  const eligible = new Set<string>();
  for (const [actorId] of submissions) {
    const actor = state.players.find((player) => player.id === actorId && player.alive && !player.isSpectator && !player.kickedAt);
    if (actor && !isDisabled(state, actor.id)) eligible.add(actorId);
  }
  for (const [actorId, action] of submissions) {
    if (!eligible.has(actorId) || action.option === PASS_OPTION) continue;
    const actor = state.players.find((player) => player.id === actorId)!;
    const target = state.players.find((player) => player.id === action.targetIds[0] && player.alive && !player.isSpectator && !player.kickedAt);
    if (!target) continue;
    if (action.effect === "disable_current_action") room.mem(state, target.id).disabledUntilRound = state.round;
    if (action.effect === "disable_permanently") room.mem(state, target.id).disabledPermanently = true;
    if (action.effect === "hide_inspection_result") room.mem(state, target.id).inspectionHiddenRound = state.round;
    if (action.effect === "warlock_choice" && action.option === "nullify" && room.mem(state, actor.id).warlockNullifyUsed !== true) room.mem(state, target.id).disabledUntilRound = state.round;
    if (action.effect === "alchemist_sequence" && Number(room.mem(state, actor.id).alchemistStage ?? 0) === 0) room.mem(state, target.id).disabledUntilRound = state.round;
  }
}

function suppressDisabledCoreNightSubmissions(room: any, state: GameState): void {
  for (const actor of livingPlayers(state.players)) {
    if (!isDisabled(state, actor.id)) continue;
    delete state.nightActions.seerTargets[actor.id];
    delete state.nightActions.guardTargets[actor.id];
    delete state.nightActions.wolfVotes[actor.id];
    if (state.nightActions.witchActions[actor.id]) state.nightActions.witchActions[actor.id] = { type: "pass" };
  }
}

function isDisabled(state: GameState, playerId: string): boolean {
  const memory = state.roleMemory[playerId] ?? {};
  if (memory.disabledPermanently === true) return true;
  if (typeof memory.disabledUntilRound === "number" && memory.disabledUntilRound >= state.round) return true;
  if (state.roleMemory.__system?.goodSkillsDisabledRound === state.round) {
    const player = state.players.find((candidate) => candidate.id === playerId);
    if (player && playerFaction(player) === "village") return true;
  }
  return false;
}

function validateCoreActionSelection(room: any, state: GameState, actor: Player, prompt: RoleActionPrompt, targetIds: string[], option?: string): void {
  if (new Set(targetIds).size !== targetIds.length) throw new Error("技能目標不能重複");
  const legal = new Set((room.legalTargets(state, actor, prompt.targetMode) as Player[]).map((player) => player.id));
  for (const id of targetIds) if (!legal.has(id)) throw new Error("技能目標無效");
  if (prompt.options) {
    const allowed = coreActionOptions(state, actor, prompt);
    if (!option || !allowed.includes(option)) throw new Error("技能選項無效");
  }
  if (prompt.effect === "suicide_bomb") {
    if (targetIds.length > 2) throw new Error("自殺炸彈客最多指定兩名目標");
    return;
  }
  if (prompt.effect === "warlock_choice") {
    const count = option === "pass" ? 0 : 1;
    if (targetIds.length !== count) throw new Error(`男巫此模式需要 ${count} 個目標`);
    return;
  }
  if (prompt.effect === "freeze_or_detonate") {
    const count = option === "detonate" ? 0 : 1;
    if (targetIds.length !== count) throw new Error(`冰雪女王此模式需要 ${count} 個目標`);
    return;
  }
  if (prompt.effect === "alchemist_sequence") {
    const stage = Number(state.roleMemory[actor.id]?.alchemistStage ?? 0);
    const count = stage === 1 ? 0 : 1;
    if (targetIds.length !== count) throw new Error(`煉金術師目前階段需要 ${count} 個目標`);
    return;
  }
  if (prompt.targetMode === "none" && targetIds.length !== 0) throw new Error("此技能不需要目標");
  if (prompt.targetMode === "optional_alive_other" && targetIds.length > 1) throw new Error("此技能最多一個目標");
  if (prompt.targetMode.startsWith("two_") && targetIds.length !== 2) throw new Error("此技能需要兩個目標");
  if (prompt.targetMode !== "none" && prompt.targetMode !== "optional_alive_other" && !prompt.targetMode.startsWith("two_") && targetIds.length !== 1) throw new Error("此技能需要一個目標");
}

function resolveFakeKill(room: any, state: GameState, actor: Player, action: RoleActionSubmission): void {
  const target = state.players.find((player) => player.id === action.targetIds[0] && player.alive && !player.isSpectator && !player.kickedAt);
  if (!target) return;
  target.alive = false;
  const memory = room.mem(state, target.id) as Record<string, any>;
  memory.fakeDeath = true;
  memory.reviveRound = state.round + 1;
  state.deathReasons[target.id] = `r${state.round}:fake_kill`;
  room.addSystemMessage(state, `${target.name} 進入假死狀態；不觸發真死亡被動，下一輪自動恢復。`);
}

function resolveMagicianSwap(room: any, state: GameState, actor: Player, action: RoleActionSubmission): void {
  const a = state.players.find((player) => player.id === action.targetIds[0] && !player.isSpectator && !player.kickedAt);
  const b = state.players.find((player) => player.id === action.targetIds[1] && !player.isSpectator && !player.kickedAt);
  if (!a || !b) return;
  if (a.alive && b.alive) {
    if (a.role && b.role) [a.role, b.role] = [b.role, a.role];
    return;
  }
  if (!a.alive && !b.alive) return;
  const living = a.alive ? a : b;
  const dead = a.alive ? b : a;
  room.killPlayer(state, living.id, "magician_swap", actor.id, true);
  revivePlayer(room, state, dead);
}

function revivePlayer(room: any, state: GameState, player: Player): void {
  player.alive = true;
  player.isSpectator = false;
  delete state.deathReasons[player.id];
  const memory = room.mem(state, player.id) as Record<string, any>;
  delete memory.fakeDeath;
  delete memory.reviveRound;
  if (player.role === "betrayer" && player.factionOverride === "werewolf") delete player.factionOverride;
  if (state.pendingReaction?.actorId === player.id) delete state.pendingReaction;
  const queue = Array.isArray(room.systemMem(state).deathReactionQueue) ? room.systemMem(state).deathReactionQueue as string[] : [];
  room.systemMem(state).deathReactionQueue = queue.filter((raw) => !raw.startsWith(`${player.id}|`));
}

function resolveSuicideBomb(room: any, state: GameState, actor: Player, action: RoleActionSubmission): void {
  const ids = [...new Set(action.targetIds)].slice(0, 2);
  const targets = ids.map((id) => state.players.find((player) => player.id === id && player.alive && !player.isSpectator && !player.kickedAt && player.id !== actor.id)).filter((player): player is Player => Boolean(player));
  const runtime = state as any;
  const previous = runtime.__coreReactionResumeOverride;
  runtime.__coreReactionResumeOverride = "debate";
  try {
    room.killPlayer(state, actor.id, "suicide_bomber", actor.id, true);
    for (const target of targets) room.killPlayer(state, target.id, "suicide_bomber", actor.id, true);
  } finally {
    if (previous === undefined) delete runtime.__coreReactionResumeOverride;
    else runtime.__coreReactionResumeOverride = previous;
  }
  if (winnerLiving(state).length === 0) room.systemMem(state).corePendingBomberWinnerId = actor.id;
  if (hasPendingMandatoryReaction(room, state)) {
    state.phase = "reaction";
    room.saveBroadcast(state);
    return;
  }
  if (resolvePendingTerminal(room, state)) return;
  room.checkAndMaybeEnd(state);
  if (!state.winner && state.phase === "debate") reconcileDebate(room, state, true);
}

function forcedResumeForImmediate(state: GameState, actor: Player, action: RoleActionSubmission): ResumePhase | undefined {
  if (["self_destruct_kill", "blood_moon", "force_exile"].includes(action.effect)) return "night";
  if (action.effect === "duel") {
    const target = state.players.find((player) => player.id === action.targetIds[0]);
    return target && playerFaction(target) === "werewolf" ? "night" : "debate";
  }
  if (action.effect === "redirect_exile" && state.pendingReaction) return state.pendingReaction.resumePhase;
  if (action.effect === "death_shot" && state.pendingReaction) return state.pendingReaction.resumePhase;
  return undefined;
}

function resolvePendingTerminal(room: any, state: GameState): boolean {
  if (state.winner || hasPendingMandatoryReaction(room, state)) return Boolean(state.winner);
  const bomberId = room.systemMem(state).corePendingBomberWinnerId;
  if (typeof bomberId === "string" && winnerLiving(state).length === 0) {
    delete room.systemMem(state).corePendingBomberWinnerId;
    const bomber = state.players.find((player) => player.id === bomberId);
    return endIndividual(room, state, bomberId, `${bomber?.name ?? "自殺炸彈客"} 引爆後清空場上其他存活者，達成個人特殊勝利`);
  }
  const living = winnerLiving(state);
  if (living.length === 0) return endDraw(room, state, "所有正式玩家均已出局，本局平手");
  const wolves = living.filter((player) => playerFaction(player) === "werewolf");
  const redAxes = living.filter((player) => player.role === "red_axe_madman");
  if (wolves.length === 0 && redAxes.length > 0) {
    if (living.length === 1 && redAxes.length === 1) return endIndividual(room, state, redAxes[0]!.id, `${redAxes[0]!.name}（赤斧狂魔）成為最後存活玩家，達成個人勝利`);
    return false;
  }
  return false;
}

function winnerLiving(state: GameState): Player[] {
  return state.players.filter((player) => !player.isSpectator && !player.kickedAt && (player.alive || isFakeDead(state, player.id)));
}

function isFakeDead(state: GameState, playerId: string): boolean {
  return state.roleMemory[playerId]?.fakeDeath === true;
}

function neutralWinnerIds(state: GameState): string[] {
  const living = winnerLiving(state);
  const cowards = living.filter((player) => player.role === "coward");
  if (living.length === 3 && cowards.length === 1) {
    const others = living.filter((player) => player.id !== cowards[0]!.id).map(playerFaction);
    if (others.includes("werewolf") && others.includes("village")) return [cowards[0]!.id];
  }
  return living.filter((player) => playerFaction(player) === "neutral").map((player) => player.id);
}

function endIndividual(room: any, state: GameState, playerId: string, label: string): boolean {
  state.winner = "neutral";
  state.winnerPlayerIds = [playerId];
  state.winnerLabel = label;
  room.endGame(state, "neutral");
  return true;
}

function endDraw(room: any, state: GameState, label: string): boolean {
  state.phase = "ended";
  state.winner = "draw";
  state.winnerPlayerIds = [];
  state.winnerLabel = label;
  delete state.pendingReaction;
  room.systemMem(state).deathReactionQueue = [];
  void room.ctx?.storage?.deleteAlarm?.();
  room.addSystemMessage(state, `遊戲結束：${label}。`);
  room.saveBroadcast(state);
  return true;
}

async function runStructuredOptionAI(room: any, before: GameState, actor: Player, task: RuntimeAITask, apiKeys: string[]): Promise<{ ok: true }> {
  const prompt = roleActionPrompt(actor, before)!;
  const options = coreActionOptions(before, actor, prompt);
  if (!options.length) throw new Error("此 AI 目前沒有合法技能選項");
  const legalTargets = room.legalTargets(before, actor, prompt.targetMode) as Player[];
  let selectedOption = options[0]!;
  let targetIds: string[] = fallbackTargets(before, actor, prompt, selectedOption, legalTargets);
  if (options.length > 1) {
    const result = await callAIWithKeys(apiKeys, {
      config: actor.ai!,
      system: room.aiSystemPrompt(actor, before),
      prompt: `${room.privateContext(before, actor)}\n\n你現在要執行角色技能 ${prompt.label}。合法 option：${options.join(", ")}。合法目標：${legalTargets.map((player) => `${player.id}=${player.name}`).join(", ") || "無"}。只回傳 JSON：{"option":"合法 option","targetIds":["合法玩家ID"]}。需要 0 個目標的 option 請回傳空陣列。`
    });
    const parsed = parseJSONObject(result.text) as Record<string, unknown>;
    if (typeof parsed.option === "string" && options.includes(parsed.option)) selectedOption = parsed.option;
    const requested = Array.isArray(parsed.targetIds) ? parsed.targetIds.filter((id): id is string => typeof id === "string") : [];
    const legalIds = new Set(legalTargets.map((player) => player.id));
    if (requested.every((id) => legalIds.has(id)) && new Set(requested).size === requested.length) targetIds = requested;
    try { validateCoreActionSelection(room, before, actor, prompt, targetIds, selectedOption); }
    catch { targetIds = fallbackTargets(before, actor, prompt, selectedOption, legalTargets); }
  }
  const state = room.requireState() as GameState;
  const fresh = room.pendingAITask(state) as RuntimeAITask | undefined;
  if (!fresh || fresh.playerId !== actor.id || fresh.operation !== task.operation) throw new Error("AI 操作已過期，請重新同步房間狀態");
  const current = state.players.find((player) => player.id === actor.id && player.alive && !player.isSpectator && !player.kickedAt);
  if (!current) throw new Error("AI 玩家狀態無效");
  room.submitRoleActionInternal(state, current, prompt.effect, targetIds, selectedOption);
  if (state.phase === "night") room.afterNightSubmission(state);
  else room.saveBroadcast(state);
  return { ok: true };
}

function fallbackTargets(state: GameState, actor: Player, prompt: RoleActionPrompt, option: string, candidates: Player[]): string[] {
  if (prompt.effect === "warlock_choice") return option === "pass" ? [] : candidates[0] ? [candidates[0].id] : [];
  if (prompt.effect === "freeze_or_detonate") return option === "detonate" ? [] : candidates[0] ? [candidates[0].id] : [];
  if (prompt.effect === "alchemist_sequence") {
    const stage = Number(state.roleMemory[actor.id]?.alchemistStage ?? 0);
    return stage === 1 ? [] : candidates[0] ? [candidates[0].id] : [];
  }
  if (prompt.effect === "suicide_bomb") return candidates.slice(0, 2).map((player) => player.id);
  if (prompt.targetMode === "none") return [];
  if (prompt.targetMode === "optional_alive_other") return candidates[0] ? [candidates[0].id] : [];
  if (prompt.targetMode.startsWith("two_")) return candidates.slice(0, 2).map((player) => player.id);
  return candidates[0] ? [candidates[0].id] : [];
}
