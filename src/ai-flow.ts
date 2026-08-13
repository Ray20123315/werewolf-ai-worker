import { callAIWithKeys, parseJSONObject } from "./ai.js";
import { assertCurrentAITask, captureAITaskContext } from "./ai-task-freshness.js";
import type { AITaskContext } from "./ai-task-freshness.js";
import {
  activePlayers,
  areNightActionsComplete,
  canGuardTarget,
  canWitchSelfSave,
  livingPlayers,
  playerFaction,
  roleActionPrompt
} from "./game-engine.js";
import { areEqualVotesComplete } from "./equal-vote.js";
import type { GameState, Player, RoleActionPrompt, WitchAction } from "./types.js";

type RoomPrototype = Record<string, any> & { __aiFlowRulesInstalled?: boolean };
type NightRequirement =
  | { kind: "wolf_kill" }
  | { kind: "seer" }
  | { kind: "guard" }
  | { kind: "witch" }
  | { kind: "role_action"; prompt: RoleActionPrompt };

type RuntimeAITask = { playerId: string; operation: string };

const AUTO_SKIP_TARGET = "__ai_auto_skip__";
const AUTO_SKIP_OPTION = "__ai_auto_skip__";

export function installAIFlowRules(GameRoomCtor: { prototype: RoomPrototype }): void {
  const proto = GameRoomCtor.prototype;
  if (proto.__aiFlowRulesInstalled) return;
  if (typeof proto.pendingAITask !== "function" || typeof proto.runAI !== "function") return;
  proto.__aiFlowRulesInstalled = true;

  const originalEnterNight = proto.enterNight;
  const originalAfterNightSubmission = proto.afterNightSubmission;
  const originalFinishNight = proto.finishNight;
  const originalEnterVote = proto.enterVote;
  const originalCastVoteById = proto.castVoteById;
  const originalFinishVote = proto.finishVote;
  const originalSubmitRoleActionInternal = proto.submitRoleActionInternal;
  const originalPendingAITask = proto.pendingAITask;
  const originalRunAI = proto.runAI;

  proto.enterNight = function (state: GameState, round: number): void {
    const result = originalEnterNight.call(this, state, round);
    if (state.phase !== "night") return result;
    if (!autoSkipNonActionableNightAIs(this, state)) return result;
    if (areNightActionsComplete(state)) return this.finishNight(state);
    this.saveBroadcast(state);
    return result;
  };

  proto.afterNightSubmission = function (state: GameState): void {
    autoSkipNonActionableNightAIs(this, state);
    return originalAfterNightSubmission.call(this, state);
  };

  proto.finishNight = function (state: GameState): void {
    stripNightAutoSkips(state);
    const result = originalFinishNight.call(this, state);
    settleNonActionableAIReaction(this, state);
    return result;
  };

  proto.enterVote = function (state: GameState): void {
    const result = originalEnterVote.call(this, state);
    if (state.phase !== "vote") return result;
    if (!autoSkipNoTargetAIVotes(state)) return result;
    if (areEqualVotesComplete(state)) return this.finishVote(state);
    this.saveBroadcast(state);
    return result;
  };

  proto.castVoteById = function (state: GameState, voterId: string, targetId: string): void {
    const result = originalCastVoteById.call(this, state, voterId, targetId);
    if (state.phase !== "vote") return result;
    if (!autoSkipNoTargetAIVotes(state)) return result;
    if (areEqualVotesComplete(state)) return this.finishVote(state);
    this.saveBroadcast(state);
    return result;
  };

  proto.finishVote = function (state: GameState): void {
    stripVoteAutoSkips(state);
    const result = originalFinishVote.call(this, state);
    settleNonActionableAIReaction(this, state);
    return result;
  };

  proto.submitRoleActionInternal = function (...args: any[]): any {
    const result = originalSubmitRoleActionInternal.apply(this, args);
    const state = args[0] as GameState;
    settleNonActionableAIReaction(this, state);
    return result;
  };

  proto.pendingAITask = function (state: GameState): RuntimeAITask | undefined {
    if (state.phase === "sheriff") {
      const voter = livingPlayers(state.players).find((player) => player.isAI && player.ai && !state.sheriff.votes[player.id]);
      if (voter && state.sheriff.candidates.length > 0) return { playerId: voter.id, operation: "sheriff_vote" };
    }

    if (state.phase === "reaction" && state.pendingReaction) {
      const actor = state.players.find((player) => player.id === state.pendingReaction?.actorId && player.isAI && player.ai && !player.isSpectator);
      if (actor) {
        const prompt = roleActionPrompt(actor, state);
        if (prompt && hasEnoughTargets(this, state, actor, prompt)) return { playerId: actor.id, operation: "reaction_action" };
      }
    }

    if (state.phase === "night") {
      const required = nextActionableNightAI(this, state);
      if (required) return required;
    }

    return originalPendingAITask.call(this, state) as RuntimeAITask | undefined;
  };

  proto.runAI = async function (hostToken: string, playerId: string, apiKeys: string[]): Promise<{ ok: true }> {
    const before = this.requireState() as GameState;
    this.assertHost(before, hostToken);
    const task = this.pendingAITask(before) as RuntimeAITask | undefined;
    if (!task || task.playerId !== playerId) throw new Error("此 AI 目前沒有待執行操作");
    const taskContext = captureAITaskContext(before, task);
    const actor = before.players.find((player) => player.id === playerId && player.isAI && !player.isSpectator);
    if (!actor?.ai) throw new Error("AI 玩家狀態無效");

    if (task.operation === "sheriff_vote") {
      const candidates = sheriffVoteCandidates(before);
      if (!candidates.length) {
        this.finishSheriffElection(before);
        return { ok: true };
      }
      const targetId = await this.decideAITarget(before, actor, apiKeys, candidates);
      const state = this.requireState() as GameState;
      assertCurrentTask(this, state, taskContext);
      const current = state.players.find((player) => player.id === playerId)!;
      this.castSheriffVote(current.token, targetId);
      return { ok: true };
    }

    if (task.operation === "reaction_action") {
      const prompt = roleActionPrompt(actor, before);
      if (!prompt) {
        settleNonActionableAIReaction(this, before);
        return { ok: true };
      }
      const candidates = legalTargetsForPrompt(this, before, actor, prompt);
      if (!hasEnoughCandidateCount(prompt.targetMode, candidates.length)) {
        settleNonActionableAIReaction(this, before);
        return { ok: true };
      }
      const targetIds = await chooseTargetIds(this, before, actor, apiKeys, prompt, candidates);
      const state = this.requireState() as GameState;
      assertCurrentTask(this, state, taskContext);
      const current = state.players.find((player) => player.id === playerId)!;
      this.submitRoleActionInternal(state, current, prompt.effect, targetIds, prompt.options?.[0]);
      return { ok: true };
    }

    if (stateIsCoreNightTask(before, actor, task.operation)) {
      return runCoreNightAI(this, before, actor, hostToken, taskContext, apiKeys);
    }

    return originalRunAI.call(this, hostToken, playerId, apiKeys);
  };
}

function stateIsCoreNightTask(state: GameState, actor: Player, operation: string): boolean {
  return state.phase === "night" && (operation === "night_action" || operation === "role_action") && ["seer", "guard", "witch"].includes(actor.role ?? "");
}

async function runCoreNightAI(room: any, before: GameState, actor: Player, hostToken: string, taskContext: AITaskContext, apiKeys: string[]): Promise<{ ok: true }> {
  if (actor.role === "seer") {
    const candidates = livingPlayers(before.players).filter((player) => player.id !== actor.id);
    if (!candidates.length) return skipCurrentNightRequirement(room, before, actor);
    const targetId = await room.decideAITarget(before, actor, apiKeys, candidates);
    const state = room.requireState() as GameState;
    assertCurrentTask(room, state, taskContext);
    state.nightActions.seerTargets[actor.id] = targetId;
    room.afterNightSubmission(state);
    return { ok: true };
  }

  if (actor.role === "guard") {
    const candidates = livingPlayers(before.players).filter((player) => canGuardTarget(before.guardLastTargets[actor.id], player.id));
    if (!candidates.length) return skipCurrentNightRequirement(room, before, actor);
    const targetId = await room.decideAITarget(before, actor, apiKeys, candidates);
    const state = room.requireState() as GameState;
    assertCurrentTask(room, state, taskContext);
    state.nightActions.guardTargets[actor.id] = targetId;
    room.afterNightSubmission(state);
    return { ok: true };
  }

  if (actor.role === "witch") {
    const options = witchOptions(room, before, actor);
    if (options.length <= 1) return skipCurrentNightRequirement(room, before, actor);
    const poisonTargets = livingPlayers(before.players).filter((player) => player.id !== actor.id);
    const result = await callAIWithKeys(apiKeys, {
      config: actor.ai!,
      system: room.aiSystemPrompt(actor, before),
      prompt: `${room.privateContext(before, actor)}\n\n你是女巫。本夜合法選擇：${options.join(", ")}。${poisonTargets.length ? `若選 poison，合法目標：${poisonTargets.map((player) => `${player.id}=${player.name}`).join(", ")}。` : ""}只回傳 JSON：{"action":"heal|poison|pass","targetId":"毒藥目標ID或空字串"}。`
    });
    const parsed = parseJSONObject(result.text) as Record<string, unknown>;
    const requested = typeof parsed.action === "string" && options.includes(parsed.action) ? parsed.action : "pass";
    let action: WitchAction = { type: "pass" };
    if (requested === "heal") action = { type: "heal" };
    if (requested === "poison") {
      const requestedId = typeof parsed.targetId === "string" ? parsed.targetId : "";
      const target = poisonTargets.find((player) => player.id === requestedId) ?? poisonTargets[0];
      if (target) action = { type: "poison", targetId: target.id };
    }
    const state = room.requireState() as GameState;
    assertCurrentTask(room, state, taskContext);
    const current = state.players.find((player) => player.id === actor.id)!;
    room.validateWitchAction(state, current, action);
    state.nightActions.witchActions[current.id] = action;
    room.afterNightSubmission(state);
    return { ok: true };
  }

  return room.runAI(hostToken, actor.id, apiKeys);
}

function skipCurrentNightRequirement(room: any, state: GameState, actor: Player): { ok: true } {
  const requirement = firstNightRequirement(room, state, actor);
  if (requirement) markNightRequirementSkipped(state, actor, requirement);
  room.afterNightSubmission(state);
  return { ok: true };
}

function nextActionableNightAI(room: any, state: GameState): RuntimeAITask | undefined {
  for (const actor of livingPlayers(state.players)) {
    if (!actor.isAI || !actor.ai) continue;
    const requirement = firstNightRequirement(room, state, actor);
    if (!requirement || !nightRequirementActionable(room, state, actor, requirement)) continue;
    return { playerId: actor.id, operation: requirement.kind === "wolf_kill" ? "night_action" : "role_action" };
  }
  return undefined;
}

function autoSkipNonActionableNightAIs(room: any, state: GameState): boolean {
  if (state.phase !== "night") return false;
  let changed = false;
  for (const actor of livingPlayers(state.players)) {
    if (!actor.isAI || !actor.ai) continue;
    for (let guard = 0; guard < 4; guard += 1) {
      const requirement = firstNightRequirement(room, state, actor);
      if (!requirement || nightRequirementActionable(room, state, actor, requirement)) break;
      markNightRequirementSkipped(state, actor, requirement);
      changed = true;
    }
  }
  return changed;
}

function firstNightRequirement(room: any, state: GameState, actor: Player): NightRequirement | undefined {
  if (state.phase !== "night" || !actor.alive || actor.isSpectator || !actor.role) return undefined;
  if (playerFaction(actor) === "werewolf" && room.participatesWolfVote(state, actor) && !state.nightActions.wolfVotes[actor.id]) return { kind: "wolf_kill" };
  if (actor.role === "seer" && !state.nightActions.seerTargets[actor.id]) return { kind: "seer" };
  if (actor.role === "guard" && !state.nightActions.guardTargets[actor.id]) return { kind: "guard" };
  if (actor.role === "witch" && !state.nightActions.witchActions[actor.id]) return { kind: "witch" };
  const prompt = roleActionPrompt(actor, state);
  if (prompt?.timing === "night" && !state.nightActions.roleActions[actor.id]) return { kind: "role_action", prompt };
  return undefined;
}

function nightRequirementActionable(room: any, state: GameState, actor: Player, requirement: NightRequirement): boolean {
  if (requirement.kind === "wolf_kill") return livingPlayers(state.players).some((player) => player.id !== actor.id && playerFaction(player) !== "werewolf");
  if (requirement.kind === "seer") return livingPlayers(state.players).some((player) => player.id !== actor.id);
  if (requirement.kind === "guard") return livingPlayers(state.players).some((player) => canGuardTarget(state.guardLastTargets[actor.id], player.id));
  if (requirement.kind === "witch") return witchOptions(room, state, actor).length > 1;
  const candidates = legalTargetsForPrompt(room, state, actor, requirement.prompt);
  return hasEnoughCandidateCount(requirement.prompt.targetMode, candidates.length);
}

function markNightRequirementSkipped(state: GameState, actor: Player, requirement: NightRequirement): void {
  if (requirement.kind === "wolf_kill") state.nightActions.wolfVotes[actor.id] = AUTO_SKIP_TARGET;
  else if (requirement.kind === "seer") state.nightActions.seerTargets[actor.id] = AUTO_SKIP_TARGET;
  else if (requirement.kind === "guard") state.nightActions.guardTargets[actor.id] = AUTO_SKIP_TARGET;
  else if (requirement.kind === "witch") state.nightActions.witchActions[actor.id] = { type: "pass" };
  else state.nightActions.roleActions[actor.id] = { effect: requirement.prompt.effect, targetIds: [], option: AUTO_SKIP_OPTION, submittedAt: Date.now() };
}

function stripNightAutoSkips(state: GameState): void {
  for (const [actorId, targetId] of Object.entries(state.nightActions.wolfVotes)) if (targetId === AUTO_SKIP_TARGET) delete state.nightActions.wolfVotes[actorId];
  for (const [actorId, targetId] of Object.entries(state.nightActions.seerTargets)) if (targetId === AUTO_SKIP_TARGET) delete state.nightActions.seerTargets[actorId];
  for (const [actorId, targetId] of Object.entries(state.nightActions.guardTargets)) if (targetId === AUTO_SKIP_TARGET) delete state.nightActions.guardTargets[actorId];
  for (const [actorId, action] of Object.entries(state.nightActions.roleActions)) if (action.option === AUTO_SKIP_OPTION) delete state.nightActions.roleActions[actorId];
}

function witchOptions(room: any, state: GameState, actor: Player): string[] {
  const options = ["pass"];
  const memory = state.roleMemory[actor.id] ?? {};
  const wolfTargetId = currentWolfTarget(state);
  if (memory.witchHealUsed !== true && wolfTargetId) {
    const canSelfSave = wolfTargetId !== actor.id || canWitchSelfSave(activePlayers(state.players).length, state.round);
    if (canSelfSave) options.push("heal");
  }
  if (memory.witchPoisonUsed !== true && livingPlayers(state.players).some((player) => player.id !== actor.id)) options.push("poison");
  return options;
}

function currentWolfTarget(state: GameState): string | undefined {
  const counts = new Map<string, number>();
  for (const targetId of Object.values(state.nightActions.wolfVotes)) {
    if (targetId === AUTO_SKIP_TARGET) continue;
    counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  return top && state.players.some((player) => player.id === top && player.alive && !player.isSpectator) ? top : undefined;
}

function legalTargetsForPrompt(room: any, state: GameState, actor: Player, prompt: RoleActionPrompt): Player[] {
  return room.legalTargets(state, actor, prompt.targetMode) as Player[];
}

function hasEnoughTargets(room: any, state: GameState, actor: Player, prompt: RoleActionPrompt): boolean {
  return hasEnoughCandidateCount(prompt.targetMode, legalTargetsForPrompt(room, state, actor, prompt).length);
}

function hasEnoughCandidateCount(mode: string, count: number): boolean {
  if (mode === "none" || mode === "optional_alive_other") return true;
  if (mode.startsWith("two_")) return count >= 2;
  return count >= 1;
}

async function chooseTargetIds(room: any, state: GameState, actor: Player, apiKeys: string[], prompt: RoleActionPrompt, candidates: Player[]): Promise<string[]> {
  if (prompt.targetMode === "none" || (prompt.targetMode === "optional_alive_other" && candidates.length === 0)) return [];
  const first = await room.decideAITarget(state, actor, apiKeys, candidates);
  if (!prompt.targetMode.startsWith("two_")) return [first];
  const secondCandidates = candidates.filter((player) => player.id !== first);
  if (!secondCandidates.length) return [first];
  const second = await room.decideAITarget(state, actor, apiKeys, secondCandidates);
  return [first, second];
}

function sheriffVoteCandidates(state: GameState): Player[] {
  return livingPlayers(state.players).filter((player) => state.sheriff.candidates.includes(player.id));
}

function assertCurrentTask(room: any, state: GameState, context: AITaskContext): void {
  assertCurrentAITask(room, state, context);
}

function autoSkipNoTargetAIVotes(state: GameState): boolean {
  if (state.phase !== "vote") return false;
  let changed = false;
  for (const voter of livingPlayers(state.players)) {
    if (!voter.isAI || !voter.ai || state.votes[voter.id]) continue;
    const candidates = livingPlayers(state.players).filter((player) => player.id !== voter.id && !player.kickedAt);
    if (candidates.length) continue;
    state.votes[voter.id] = AUTO_SKIP_TARGET;
    changed = true;
  }
  return changed;
}

function stripVoteAutoSkips(state: GameState): void {
  for (const [voterId, targetId] of Object.entries(state.votes)) if (targetId === AUTO_SKIP_TARGET) delete state.votes[voterId];
}

function settleNonActionableAIReaction(room: any, state: GameState): void {
  if (state.phase !== "reaction" || !state.pendingReaction) return;
  const actor = state.players.find((player) => player.id === state.pendingReaction?.actorId && player.isAI && player.ai && !player.isSpectator);
  if (!actor) return;
  const prompt = roleActionPrompt(actor, state);
  if (prompt && hasEnoughTargets(room, state, actor, prompt)) return;
  resumeReactionWithoutAction(room, state);
}

function resumeReactionWithoutAction(room: any, state: GameState): void {
  const pending = state.pendingReaction;
  if (!pending) return;
  const effect = pending.effect;
  const resume = pending.resumePhase;
  delete state.pendingReaction;
  room.checkAndMaybeEnd(state);
  if (state.winner) return;
  if (room.popDeathReaction(state)) {
    settleNonActionableAIReaction(room, state);
    if (state.phase === "reaction") room.saveBroadcast(state);
    return;
  }
  if (effect === "redirect_exile") {
    if (resume === "debate") room.beginDebate(state);
    else room.enterNight(state, state.round + 1);
    return;
  }
  if (resume === "night") room.enterNight(state, state.round + 1);
  else if (resume === "vote") room.enterVote(state);
  else room.beginDebate(state);
}
