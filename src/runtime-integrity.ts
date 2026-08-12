import { callAIWithKeys, parseJSONObject } from "./ai.js";
import { areNightActionsComplete, playerFaction, roleActionPrompt, secureShuffle } from "./game-engine.js";
import { formalLiving } from "./core-state.js";
import { roleDefinition } from "./roles.js";
import type { GameState, Player, Role, RoleActionPrompt, RoleActionSubmission } from "./types.js";

type RoomPrototype = Record<string, any> & { __runtimeIntegrityRulesInstalled?: boolean };
type RuntimeAITask = { playerId: string; operation: string };
type RuntimeState = GameState & { lastVoteSummary?: unknown };

type ReactionResume = "night" | "debate" | "vote" | "ended";

const INACTIVE_EQUAL_VOTE_ROLES: Readonly<Record<string, Role>> = {
  berserker_wolf: "werewolf",
  bomb_wolf: "werewolf",
  raven: "villager",
  discriminator: "villager"
};

export const RUNTIME_INACTIVE_ROLE_IDS = Object.freeze(Object.keys(INACTIVE_EQUAL_VOTE_ROLES));

const NIGHT_CONDITIONAL_EFFECTS = new Set([
  "kill_if_hive_dead",
  "convert_to_werewolf_if_last",
  "kill_if_no_wolves",
  "cooldown_kill"
]);

const NIGHT_OPTION_OPERATIONS = new Set(["night_action", "role_action"]);

export function installRuntimeIntegrityRules(GameRoomCtor: { prototype: RoomPrototype }): void {
  const proto = GameRoomCtor.prototype;
  if (proto.__runtimeIntegrityRulesInstalled) return;
  proto.__runtimeIntegrityRulesInstalled = true;

  const originalRequireState = proto.requireState;
  const originalProjectState = proto.projectState;
  const originalQueueDeathReaction = proto.queueDeathReaction;
  const originalCheckAndMaybeEnd = proto.checkAndMaybeEnd;
  const originalEndGame = proto.endGame;
  const originalBeginDebate = proto.beginDebate;
  const originalEnterNight = proto.enterNight;
  const originalEnterVote = proto.enterVote;
  const originalSubmitDebateSpeech = proto.submitDebateSpeech;
  const originalSubmitRoleActionInternal = proto.submitRoleActionInternal;
  const originalAfterNightSubmission = proto.afterNightSubmission;
  const originalFinishNight = proto.finishNight;
  const originalKickPlayerInternal = proto.kickPlayerInternal;
  const originalPendingAITask = proto.pendingAITask;
  const originalRunAI = proto.runAI;

  if (typeof originalRequireState === "function") {
    proto.requireState = function (): GameState {
      const state = originalRequireState.call(this) as GameState;
      migrateRuntimeIntegrityState(state);
      return state;
    };
  }

  if (typeof originalProjectState === "function") {
    proto.projectState = function (state: GameState, token: string): any {
      migrateRuntimeIntegrityState(state);
      normalizeDebateCursor(state);
      const view = originalProjectState.call(this, state, token);
      if (!view?.me) return view;
      const me = this.playerByToken(state, token) as Player;
      const removed = new Set<string>([...(view.removedRoleIds ?? []), ...RUNTIME_INACTIVE_ROLE_IDS]);
      view.removedRoleIds = [...removed];

      if (view.roleAction && !runtimeAbilityAvailable(state, me, String(view.roleAction.effect))) delete view.roleAction;
      if (canUseMagicianNow(state, me)) view.roleAction = magicianPrompt();
      if (me.role === "suicide_bomber" && view.roleAction?.effect === "suicide_bomb") {
        view.roleAction.targetMode = "optional_alive_other";
        view.roleAction.minTargets = 0;
        view.roleAction.maxTargets = 2;
      }
      view.currentSpeakerId = currentValidDebaterId(state);
      return view;
    };
  }

  if (typeof originalQueueDeathReaction === "function") {
    proto.queueDeathReaction = function (state: GameState, actorId: string, reason: string, resumePhase: ReactionResume): void {
      const forced = this.__runtimeReactionResumePhase as ReactionResume | undefined;
      return originalQueueDeathReaction.call(this, state, actorId, reason, forced ?? resumePhase);
    };
  }

  if (typeof originalCheckAndMaybeEnd === "function") {
    proto.checkAndMaybeEnd = function (state: GameState): void {
      if (state.winner || state.phase === "ended") return;
      if (ensureImmediateTerminal(this, state, originalEndGame)) return;
      if (hasReactionWork(this, state)) return;
      if (redAxeMustContinue(state)) return;
      const result = originalCheckAndMaybeEnd.call(this, state);
      normalizeNeutralWinnerIds(state);
      return result;
    };
  }

  if (typeof originalEndGame === "function") {
    proto.endGame = function (state: GameState, winner: any): void {
      if (state.phase === "ended" || state.winner) return;
      if (ensureImmediateTerminal(this, state, originalEndGame)) return;
      if (hasReactionWork(this, state)) {
        if (state.pendingReaction) state.phase = "reaction";
        safeSaveBroadcast(this, state);
        return;
      }
      if (redAxeMustContinue(state)) {
        if (state.phase === "night" && typeof this.beginDebate === "function") this.beginDebate(state);
        else safeSaveBroadcast(this, state);
        return;
      }
      const result = originalEndGame.call(this, state, winner);
      normalizeNeutralWinnerIds(state);
      return result;
    };
  }

  if (typeof originalBeginDebate === "function") {
    proto.beginDebate = function (state: GameState): void {
      if (ensureImmediateTerminal(this, state, originalEndGame)) return;
      if (holdForReaction(this, state)) return;
      const result = originalBeginDebate.call(this, state);
      if (state.phase === "debate") reconcileDebate(this, state);
      return result;
    };
  }

  if (typeof originalEnterNight === "function") {
    proto.enterNight = function (state: GameState, round: number): void {
      if (ensureImmediateTerminal(this, state, originalEndGame)) return;
      if (holdForReaction(this, state)) return;
      const result = originalEnterNight.call(this, state, round);
      if (state.phase === "night") {
        markUnavailableNightPasses(this, state);
        if (areNightActionsComplete(state)) this.finishNight(state);
      }
      return result;
    };
  }

  if (typeof originalEnterVote === "function") {
    proto.enterVote = function (state: GameState): void {
      if (ensureImmediateTerminal(this, state, originalEndGame)) return;
      if (holdForReaction(this, state)) return;
      return originalEnterVote.call(this, state);
    };
  }

  if (typeof originalSubmitDebateSpeech === "function") {
    proto.submitDebateSpeech = function (...args: any[]): void {
      const state = this.requireState() as GameState;
      if (state.phase === "debate") reconcileDebate(this, state, false);
      if (state.phase !== "debate") return;
      const result = originalSubmitDebateSpeech.apply(this, args);
      const after = this.requireState() as GameState;
      if (after.phase === "debate") reconcileDebate(this, after);
      return result;
    };
  }

  if (typeof originalSubmitRoleActionInternal === "function") {
    proto.submitRoleActionInternal = function (state: GameState, actor: Player, effect: string, targetIds: string[], option?: string): void {
      migrateRuntimeIntegrityState(state);
      if (!runtimeAbilityAvailable(state, actor, effect)) throw new Error("此技能目前尚未滿足使用條件");

      if (effect === "magician_swap" && actor.role === "magician") {
        return resolveMagicianAction(this, state, actor, targetIds, originalEndGame);
      }
      if (effect === "suicide_bomb" && actor.role === "suicide_bomber") {
        return resolveSuicideBomber(this, state, actor, targetIds, originalEndGame);
      }

      const previousResume = this.__runtimeReactionResumePhase as ReactionResume | undefined;
      this.__runtimeReactionResumePhase = resumeAfterEffect(state, effect);
      try {
        const result = originalSubmitRoleActionInternal.call(this, state, actor, effect, targetIds, option);
        if (state.pendingReaction) {
          state.phase = "reaction";
          safeSaveBroadcast(this, state);
          return result;
        }
        if (state.phase === "debate") reconcileDebate(this, state);
        ensureImmediateTerminal(this, state, originalEndGame);
        return result;
      } finally {
        if (previousResume) this.__runtimeReactionResumePhase = previousResume;
        else delete this.__runtimeReactionResumePhase;
      }
    };
  }

  if (typeof originalAfterNightSubmission === "function") {
    proto.afterNightSubmission = function (state: GameState): void {
      markUnavailableNightPasses(this, state);
      return originalAfterNightSubmission.call(this, state);
    };
  }

  if (typeof originalFinishNight === "function") {
    proto.finishNight = function (state: GameState): void {
      markUnavailableNightPasses(this, state);
      preResolveNightDisables(this, state);
      const result = originalFinishNight.call(this, state);
      if (!state.winner && state.phase !== "ended" && state.pendingReaction) {
        state.phase = "reaction";
        safeSaveBroadcast(this, state);
      }
      if (!state.winner && state.phase !== "ended") ensureImmediateTerminal(this, state, originalEndGame);
      return result;
    };
  }

  if (typeof originalKickPlayerInternal === "function") {
    proto.kickPlayerInternal = function (state: GameState, targetId: string, sourceLabel: string): void {
      const result = originalKickPlayerInternal.call(this, state, targetId, sourceLabel);
      if (state.winner || state.phase === "ended") return result;
      reconcileSheriffRoster(state);
      if (state.pendingReaction) {
        state.phase = "reaction";
        safeSaveBroadcast(this, state);
        return result;
      }
      if (state.phase === "debate") reconcileDebate(this, state);
      if (state.phase === "night") {
        markUnavailableNightPasses(this, state);
        if (areNightActionsComplete(state)) this.finishNight(state);
      }
      return result;
    };
  }

  if (typeof originalPendingAITask === "function") {
    proto.pendingAITask = function (state: GameState): RuntimeAITask | undefined {
      migrateRuntimeIntegrityState(state);
      if (state.phase === "night") markUnavailableNightPasses(this, state);
      if (state.phase === "debate") reconcileDebate(this, state, false);
      return originalPendingAITask.call(this, state) as RuntimeAITask | undefined;
    };
  }

  if (typeof originalRunAI === "function") {
    proto.runAI = async function (hostToken: string, playerId: string, apiKeys: string[]): Promise<{ ok: true }> {
      const before = this.requireState() as GameState;
      const task = this.pendingAITask(before) as RuntimeAITask | undefined;
      const actor = before.players.find((player) => player.id === playerId && player.alive && player.isAI && !player.isSpectator && player.ai);
      const prompt = actor ? roleActionPrompt(actor, before) : undefined;
      if (!task || task.playerId !== playerId || !actor?.ai || before.phase !== "night" || !NIGHT_OPTION_OPERATIONS.has(task.operation) || !prompt?.options || prompt.options.length < 2) {
        return originalRunAI.call(this, hostToken, playerId, apiKeys);
      }
      if (!runtimeAbilityAvailable(before, actor, prompt.effect)) {
        markUnavailableNightPasses(this, before);
        this.touchAndSave(before);
        this.broadcast(before);
        return { ok: true };
      }
      this.assertHost(before, hostToken);
      const decision = await decideAIOptionAction(this, before, actor, prompt, apiKeys);
      const current = this.requireState() as GameState;
      this.assertFreshAITask(current, hostToken, playerId, task.operation);
      const currentActor = current.players.find((player) => player.id === playerId && player.alive && player.isAI) as Player | undefined;
      const currentPrompt = currentActor ? roleActionPrompt(currentActor, current) : undefined;
      if (!currentActor || !currentPrompt || currentPrompt.effect !== prompt.effect || !currentPrompt.options?.includes(decision.option)) throw new Error("AI 角色技能決策已過期");
      const legal = new Set((this.legalTargets(current, currentActor, currentPrompt.targetMode) as Player[]).map((player) => player.id));
      const targetIds = decision.targetIds.filter((id) => legal.has(id));
      if (!validTargetCount(currentPrompt.targetMode, targetIds)) throw new Error("AI 回傳的技能目標數量無效");
      this.submitRoleActionInternal(current, currentActor, currentPrompt.effect, targetIds, decision.option);
      if (current.phase === "night") this.afterNightSubmission(current);
      else safeSaveBroadcast(this, current);
      return { ok: true };
    };
  }
}

export function migrateRuntimeIntegrityState(state: GameState): void {
  if (!state || !Array.isArray(state.players)) return;
  if (state.roleSetup) {
    for (const roleId of RUNTIME_INACTIVE_ROLE_IDS) delete (state.roleSetup as Record<string, number | undefined>)[roleId];
  }
  for (const player of state.players) {
    const replacement = player.role ? INACTIVE_EQUAL_VOTE_ROLES[player.role] : undefined;
    if (replacement) {
      player.role = replacement;
      delete player.factionOverride;
    }
  }
  normalizeDebateCursor(state);
}

export function runtimeAbilityAvailable(state: GameState, actor: Player, effect: string): boolean {
  if (!NIGHT_CONDITIONAL_EFFECTS.has(effect)) return true;
  if (!actor.alive || actor.isSpectator || actor.kickedAt) return false;
  if (effect === "kill_if_hive_dead") return state.players.some((player) => player.role === "hive" && !player.alive) || state.roleMemory[actor.id]?.hiveDead === true;
  if (effect === "convert_to_werewolf_if_last") {
    const wolves = formalLiving(state).filter((player) => playerFaction(player) === "werewolf");
    return wolves.length === 1 && wolves[0]!.id === actor.id;
  }
  if (effect === "kill_if_no_wolves") return formalLiving(state).every((player) => playerFaction(player) !== "werewolf");
  if (effect === "cooldown_kill") return state.round % 2 === 0;
  return true;
}

export function normalizeDebateCursor(state: GameState): boolean {
  if (!state || state.phase !== "debate" || !Array.isArray(state.debateOrder)) return false;
  let changed = false;
  while (state.debateIndex < state.debateOrder.length) {
    const id = state.debateOrder[state.debateIndex];
    const player = state.players.find((item) => item.id === id);
    if (player?.alive && !player.isSpectator && !player.kickedAt && player.role !== "captain") break;
    if (id && !state.debateCompleted.includes(id)) state.debateCompleted.push(id);
    state.debateIndex += 1;
    changed = true;
  }
  return changed;
}

function currentValidDebaterId(state: GameState): string | undefined {
  normalizeDebateCursor(state);
  return state.phase === "debate" ? state.debateOrder[state.debateIndex] : undefined;
}

function reconcileDebate(room: any, state: GameState, transition = true): void {
  if (state.phase !== "debate" || state.pendingReaction) return;
  const changed = normalizeDebateCursor(state);
  if (transition && state.debateIndex >= state.debateOrder.length && typeof room.enterVote === "function") {
    room.enterVote(state);
    return;
  }
  if (changed) safeSaveBroadcast(room, state);
}

function reconcileSheriffRoster(state: GameState): void {
  if (!state.sheriff) return;
  const valid = new Set(formalLiving(state).map((player) => player.id));
  state.sheriff.candidates = state.sheriff.candidates.filter((id) => valid.has(id));
  for (const [voterId, targetId] of Object.entries(state.sheriff.votes)) {
    if (!valid.has(voterId) || !state.sheriff.candidates.includes(targetId)) delete state.sheriff.votes[voterId];
  }
  state.sheriff.successors = state.sheriff.successors.filter((id) => valid.has(id));
  if (state.sheriff.sheriffId && !valid.has(state.sheriff.sheriffId)) delete state.sheriff.sheriffId;
}

function resumeAfterEffect(state: GameState, effect: string): ReactionResume {
  if (["self_destruct_kill", "blood_moon", "duel", "force_exile"].includes(effect)) return "night";
  if (["sniper_two_kills", "day_assassinate", "suicide_bomb"].includes(effect)) return "debate";
  if (state.phase === "vote") return "night";
  if (state.phase === "night") return "debate";
  return state.phase === "debate" ? "debate" : "night";
}

function hasReactionWork(room: any, state: GameState): boolean {
  if (state.pendingReaction) return true;
  const system = roomSystemMem(room, state);
  return Array.isArray(system.deathReactionQueue) && system.deathReactionQueue.length > 0;
}

function holdForReaction(room: any, state: GameState): boolean {
  if (!hasReactionWork(room, state)) return false;
  if (state.pendingReaction) state.phase = "reaction";
  safeSaveBroadcast(room, state);
  return true;
}

function ensureImmediateTerminal(room: any, state: GameState, originalEndGame: Function): boolean {
  if (state.phase === "ended" || state.winner) return true;
  const alive = formalLiving(state);
  if (!alive.length) {
    finishDraw(room, state, "全員出局，本局平手");
    return true;
  }
  const wolves = alive.filter((player) => playerFaction(player) === "werewolf");
  const redAxes = alive.filter((player) => player.role === "red_axe_madman");
  if (!wolves.length && redAxes.length && alive.every((player) => player.role === "red_axe_madman")) {
    state.winnerPlayerIds = redAxes.map((player) => player.id);
    state.winnerLabel = `${redAxes.map((player) => player.name).join("、")}（赤斧狂魔）成為最後存活陣營，達成特殊勝利`;
    originalEndGame.call(room, state, "neutral");
    normalizeNeutralWinnerIds(state);
    return true;
  }
  return false;
}

function redAxeMustContinue(state: GameState): boolean {
  const alive = formalLiving(state);
  if (alive.length <= 1) return false;
  const wolves = alive.some((player) => playerFaction(player) === "werewolf");
  return !wolves && alive.some((player) => player.role === "red_axe_madman");
}

function finishDraw(room: any, state: GameState, label: string): void {
  state.phase = "ended";
  delete state.winner;
  state.winnerPlayerIds = [];
  state.winnerLabel = label;
  delete state.pendingReaction;
  const system = roomSystemMem(room, state);
  system.deathReactionQueue = [];
  if (typeof room.addSystemMessage === "function") room.addSystemMessage(state, `遊戲結束：${label}。`);
  void room.ctx?.storage?.deleteAlarm?.();
  safeSaveBroadcast(room, state);
}

function normalizeNeutralWinnerIds(state: GameState): void {
  if (state.winner !== "neutral" || !Array.isArray(state.winnerPlayerIds)) return;
  const allNeutral = state.players.filter((player) => !player.isSpectator && !player.kickedAt && playerFaction(player) === "neutral").map((player) => player.id).sort();
  const current = [...state.winnerPlayerIds].sort();
  if (allNeutral.length !== current.length || allNeutral.some((id, index) => id !== current[index])) return;
  const aliveNeutral = formalLiving(state).filter((player) => playerFaction(player) === "neutral");
  if (aliveNeutral.length === 1) state.winnerPlayerIds = [aliveNeutral[0]!.id];
  if (formalLiving(state).length === 3) {
    const coward = aliveNeutral.find((player) => player.role === "coward");
    if (coward) state.winnerPlayerIds = [coward.id];
  }
}

function markUnavailableNightPasses(room: any, state: GameState): void {
  if (state.phase !== "night") return;
  for (const actor of formalLiving(state)) {
    if (!actor.role || state.nightActions.roleActions[actor.id]) continue;
    const action = roleDefinition(actor.role).action;
    if (!action || action.timing !== "night" || !NIGHT_CONDITIONAL_EFFECTS.has(action.effect)) continue;
    if (runtimeAbilityAvailable(state, actor, action.effect)) continue;
    state.nightActions.roleActions[actor.id] = { effect: action.effect, targetIds: [], option: "__pass__", submittedAt: Date.now() } as RoleActionSubmission;
  }
}

function preResolveNightDisables(room: any, state: GameState): void {
  if (state.phase !== "night") return;
  const disabledTargets = new Set<string>();
  const removeActions = new Set<string>();
  const atStartDisabled = new Set(formalLiving(state).filter((player) => isDisabled(room, state, player.id)).map((player) => player.id));

  for (const [actorId, action] of Object.entries(state.nightActions.roleActions)) {
    if (atStartDisabled.has(actorId)) continue;
    const actor = state.players.find((player) => player.id === actorId && player.alive && !player.isSpectator && !player.kickedAt);
    if (!actor) continue;
    const targetId = action.targetIds[0];
    if (!targetId) continue;
    if (action.effect === "disable_current_action") disabledTargets.add(targetId);
    if (action.effect === "warlock_choice" && action.option === "nullify") {
      const memory = roomMem(room, state, actor.id);
      if (memory.warlockNullifyUsed !== true) {
        disabledTargets.add(targetId);
        memory.warlockNullifyUsed = true;
      }
    }
    if (action.effect === "alchemist_sequence") {
      const memory = roomMem(room, state, actor.id);
      if (Number(memory.alchemistStage ?? 0) === 0) {
        disabledTargets.add(targetId);
        memory.alchemistStage = 1;
        removeActions.add(actorId);
      }
    }
  }

  for (const targetId of disabledTargets) roomMem(room, state, targetId).disabledUntilRound = state.round;
  for (const actorId of removeActions) delete state.nightActions.roleActions[actorId];
  for (const playerId of disabledTargets) {
    delete state.nightActions.guardTargets[playerId];
    if (state.nightActions.witchActions[playerId]) state.nightActions.witchActions[playerId] = { type: "pass" };
  }
}

function isDisabled(room: any, state: GameState, playerId: string): boolean {
  const memory = roomMem(room, state, playerId);
  return memory.disabledPermanently === true || (typeof memory.disabledUntilRound === "number" && memory.disabledUntilRound >= state.round);
}

function canUseMagicianNow(state: GameState, actor: Player): boolean {
  return actor.role === "magician" && actor.alive && !actor.isSpectator && !actor.kickedAt && ["night", "debate", "vote"].includes(state.phase) && state.roleMemory[actor.id]?.["used:magician_swap"] !== true;
}

function magicianPrompt(): Record<string, unknown> {
  return {
    role: "magician",
    timing: "night",
    effect: "magician_swap",
    targetMode: "two_any",
    oncePerGame: true,
    label: "魔術師",
    description: "選兩人：一死一活交換生死；白天兩人都活交換目前票；其餘情況交換職業與陣營勝利歸屬。"
  };
}

function resolveMagicianAction(room: any, state: GameState, actor: Player, targetIds: string[], originalEndGame: Function): void {
  if (!canUseMagicianNow(state, actor)) throw new Error("魔術師技能目前不可用");
  const unique = [...new Set(targetIds)];
  if (unique.length !== 2 || unique.includes(actor.id)) throw new Error("魔術師必須選擇兩名不同且不是自己的玩家");
  const targets = unique.map((id) => state.players.find((player) => player.id === id && !player.isSpectator && !player.kickedAt));
  if (targets.some((player) => !player)) throw new Error("魔術師目標無效");
  const [a, b] = targets as [Player, Player];
  roomMem(room, state, actor.id)["used:magician_swap"] = true;
  if (state.phase === "night") state.nightActions.roleActions[actor.id] = { effect: "magician_swap", targetIds: unique, option: "__resolved__", submittedAt: Date.now() } as RoleActionSubmission;

  if (a.alive !== b.alive) {
    const living = a.alive ? a : b;
    const dead = a.alive ? b : a;
    room.__runtimeReactionResumePhase = state.phase === "night" ? "debate" : state.phase === "vote" ? "night" : "debate";
    room.killPlayer(state, living.id, "magician_swap", actor.id, true);
    revivePlayer(state, dead);
  } else if (a.alive && b.alive && (state.phase === "debate" || state.phase === "vote")) {
    const aVote = state.votes[a.id];
    const bVote = state.votes[b.id];
    if (bVote) state.votes[a.id] = bVote; else delete state.votes[a.id];
    if (aVote) state.votes[b.id] = aVote; else delete state.votes[b.id];
  } else {
    const aRole = a.role;
    const bRole = b.role;
    const aFaction = a.factionOverride;
    const bFaction = b.factionOverride;
    if (bRole) a.role = bRole; else delete a.role;
    if (aRole) b.role = aRole; else delete b.role;
    if (bFaction) a.factionOverride = bFaction; else delete a.factionOverride;
    if (aFaction) b.factionOverride = aFaction; else delete b.factionOverride;
  }

  if (state.pendingReaction) state.phase = "reaction";
  else if (state.phase === "debate") reconcileDebate(room, state);
  ensureImmediateTerminal(room, state, originalEndGame);
}

function revivePlayer(state: GameState, player: Player): void {
  player.alive = true;
  delete state.deathReasons[player.id];
  const memory = state.roleMemory[player.id];
  if (memory) {
    delete memory.reviveRound;
    delete memory.bloodLastStandRound;
  }
}

function resolveSuicideBomber(room: any, state: GameState, actor: Player, targetIds: string[], originalEndGame: Function): void {
  if (state.phase !== "debate" || !actor.alive || actor.isSpectator || actor.kickedAt || state.roleMemory[actor.id]?.["used:suicide_bomb"] === true) throw new Error("自殺炸彈客目前不可自爆");
  const unique = [...new Set(targetIds)];
  if (unique.length > 2 || unique.includes(actor.id)) throw new Error("自殺炸彈客最多指定兩名其他玩家");
  const legal = new Set(formalLiving(state).filter((player) => player.id !== actor.id).map((player) => player.id));
  if (unique.some((id) => !legal.has(id))) throw new Error("自殺炸彈客目標無效");
  roomMem(room, state, actor.id)["used:suicide_bomb"] = true;
  room.__runtimeReactionResumePhase = "debate";
  room.killPlayer(state, actor.id, "suicide_bomber", actor.id, true);
  for (const id of unique) room.killPlayer(state, id, "suicide_bomber", actor.id, true);

  if (formalLiving(state).length === 0) {
    delete state.pendingReaction;
    roomSystemMem(room, state).deathReactionQueue = [];
    state.winnerPlayerIds = [actor.id];
    state.winnerLabel = `${actor.name}（自殺炸彈客）自爆後場上無人存活，達成特殊勝利`;
    originalEndGame.call(room, state, "neutral");
    return;
  }
  if (state.pendingReaction) {
    state.phase = "reaction";
    safeSaveBroadcast(room, state);
    return;
  }
  reconcileDebate(room, state);
  room.checkAndMaybeEnd(state);
}

async function decideAIOptionAction(room: any, state: GameState, actor: Player, prompt: RoleActionPrompt, apiKeys: string[]): Promise<{ option: string; targetIds: string[] }> {
  const candidates = room.legalTargets(state, actor, prompt.targetMode) as Player[];
  const options = availableAIOptions(room, state, actor, prompt, candidates);
  if (!options.length) return { option: "pass", targetIds: [] };
  if (options.length === 1) return fallbackOptionDecision(prompt, options[0]!, candidates);

  const result = await callAIWithKeys(apiKeys, {
    config: actor.ai!,
    system: room.aiSystemPrompt(actor, state),
    prompt: `${room.privateContext(state, actor)}\n\n你要使用技能 ${prompt.label}。可用 option：${options.join("、")}。合法目標：${candidates.map((player) => `${player.name}(${player.id})`).join("、") || "無"}。請依局勢選擇，不要固定選第一個。只回 JSON：{"option":"其中一個 option","targetIds":["playerId"]}。targetIds 必須符合技能目標數量。`
  });
  const parsed = parseJSONObject(result.text) as Record<string, unknown>;
  const option = typeof parsed.option === "string" && options.includes(parsed.option) ? parsed.option : undefined;
  const ids = Array.isArray(parsed.targetIds) ? parsed.targetIds.filter((id): id is string => typeof id === "string") : [];
  const legal = new Set(candidates.map((player) => player.id));
  if (option && ids.every((id) => legal.has(id)) && validTargetCount(prompt.targetMode, ids, option)) return { option, targetIds: ids };
  return fallbackOptionDecision(prompt, secureShuffle(options)[0]!, candidates);
}

function availableAIOptions(room: any, state: GameState, actor: Player, prompt: RoleActionPrompt, candidates: Player[]): string[] {
  let options = [...(prompt.options ?? [])];
  const memory = roomMem(room, state, actor.id);
  if (prompt.effect === "warlock_choice") {
    if (memory.warlockPoisonUsed === true) options = options.filter((option) => option !== "poison");
    if (memory.warlockNullifyUsed === true) options = options.filter((option) => option !== "nullify");
  }
  if (prompt.effect === "freeze_or_detonate") {
    const frozen = Array.isArray(memory.frozenTargets) ? memory.frozenTargets : [];
    if (!frozen.length) options = options.filter((option) => option !== "detonate");
    if (!candidates.length) options = options.filter((option) => option !== "freeze");
  }
  return options;
}

function fallbackOptionDecision(prompt: RoleActionPrompt, option: string, candidates: Player[]): { option: string; targetIds: string[] } {
  if (option === "pass" || option === "detonate" || prompt.targetMode === "none") return { option, targetIds: [] };
  const shuffled = secureShuffle(candidates);
  if (String(prompt.targetMode).startsWith("two_")) return { option, targetIds: shuffled.slice(0, 2).map((player) => player.id) };
  if (prompt.targetMode === "optional_alive_other") return { option, targetIds: shuffled[0] ? [shuffled[0].id] : [] };
  return { option, targetIds: shuffled[0] ? [shuffled[0].id] : [] };
}

function validTargetCount(mode: string, ids: string[], option?: string): boolean {
  if (new Set(ids).size !== ids.length) return false;
  if (mode === "none") return ids.length === 0;
  if (mode.startsWith("two_")) return ids.length === 2;
  if (mode === "optional_alive_other") return option === "detonate" || option === "pass" ? ids.length <= 1 : ids.length <= 1;
  return ids.length === 1;
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

function safeSaveBroadcast(room: any, state: GameState): void {
  if (typeof room?.saveBroadcast === "function") room.saveBroadcast(state);
  else {
    if (typeof room?.touchAndSave === "function") room.touchAndSave(state);
    if (typeof room?.broadcast === "function") room.broadcast(state);
  }
}
