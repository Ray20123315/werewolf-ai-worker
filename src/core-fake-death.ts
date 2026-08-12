import { areNightActionsComplete, playerFaction, roleActionPrompt } from "./game-engine.js";
import { roleDefinition } from "./roles.js";
import type { GameState, Player, RoleActionPrompt, RoleActionSubmission } from "./types.js";

type RoomPrototype = Record<string, any> & { __coreFakeDeathRulesInstalled?: boolean };
type RuntimeAITask = { playerId: string; operation: string };

const PASS_OPTION = "__pass__";

export function isFakeDead(state: GameState, playerId: string): boolean {
  return state.roleMemory[playerId]?.fakeDeath === true;
}

export function countsAsAliveForDeathGate(state: GameState, player: Player): boolean {
  return !player.isSpectator && !player.kickedAt && (player.alive || isFakeDead(state, player.id));
}

export function isRealDeadForDeathGate(state: GameState, player: Player): boolean {
  return !player.isSpectator && !player.kickedAt && !player.alive && !isFakeDead(state, player.id);
}

export function fakeDeathActionAvailable(
  state: GameState,
  actor: Player,
  prompt = roleActionPrompt(actor, state)
): boolean {
  if (!prompt) return false;
  switch (prompt.effect) {
    case "kill_if_hive_dead":
      return state.players.some((player) => player.role === "hive" && isRealDeadForDeathGate(state, player));
    case "convert_to_werewolf_if_last": {
      const wolves = state.players.filter((player) => countsAsAliveForDeathGate(state, player) && playerFaction(player) === "werewolf");
      return wolves.length === 1 && wolves[0]?.id === actor.id;
    }
    case "kill_if_no_wolves":
      return !state.players.some((player) => countsAsAliveForDeathGate(state, player) && playerFaction(player) === "werewolf");
    case "necromancer_milestone": {
      const dead = state.players.filter((player) => isRealDeadForDeathGate(state, player)).length;
      return state.initialPlayerCount > 0 && dead / state.initialPlayerCount >= 0.25;
    }
    case "awaken_if_wolf_dead":
      return state.players.some((player) =>
        player.id !== actor.id &&
        playerFaction(player) === "werewolf" &&
        isRealDeadForDeathGate(state, player)
      );
    default:
      return true;
  }
}

export function installCoreFakeDeathRules(GameRoomCtor: { prototype: RoomPrototype }): void {
  const proto = GameRoomCtor.prototype;
  if (proto.__coreFakeDeathRulesInstalled) return;
  proto.__coreFakeDeathRulesInstalled = true;

  const originalEnterNight = proto.enterNight;
  const originalAfterNightSubmission = proto.afterNightSubmission;
  const originalPendingAITask = proto.pendingAITask;
  const originalProjectState = proto.projectState;
  const originalSubmitRoleActionInternal = proto.submitRoleActionInternal;
  const originalResolveNightRoleAction = proto.resolveNightRoleAction;
  const originalLegalTargets = proto.legalTargets;

  if (typeof originalEnterNight === "function") {
    proto.enterNight = function (state: GameState, round: number): void {
      const result = originalEnterNight.call(this, state, round);
      reconcileFakeDeathNightGate(this, state);
      return result;
    };
  }

  if (typeof originalAfterNightSubmission === "function") {
    proto.afterNightSubmission = function (state: GameState): void {
      const result = originalAfterNightSubmission.call(this, state);
      reconcileFakeDeathNightGate(this, state);
      return result;
    };
  }

  if (typeof originalPendingAITask === "function") {
    proto.pendingAITask = function (state: GameState): RuntimeAITask | undefined {
      markUnavailableFakeDeathActions(this, state);
      return originalPendingAITask.call(this, state) as RuntimeAITask | undefined;
    };
  }

  if (typeof originalProjectState === "function") {
    proto.projectState = function (state: GameState, token: string): any {
      const view = originalProjectState.call(this, state, token);
      if (!view?.me) return view;
      const actor = this.playerByToken(state, token) as Player;
      const prompt = roleActionPrompt(actor, state);
      if (prompt && !fakeDeathActionAvailable(state, actor, prompt)) delete view.roleAction;
      return view;
    };
  }

  if (typeof originalSubmitRoleActionInternal === "function") {
    proto.submitRoleActionInternal = function (
      state: GameState,
      actor: Player,
      effect: string,
      targetIds: string[],
      option?: string
    ): void {
      const prompt = roleActionPrompt(actor, state);
      if (prompt?.effect === effect && !fakeDeathActionAvailable(state, actor, prompt)) {
        throw new Error("此技能需要真正死亡條件；假死不計入");
      }
      return originalSubmitRoleActionInternal.call(this, state, actor, effect, targetIds, option);
    };
  }

  if (typeof originalResolveNightRoleAction === "function") {
    proto.resolveNightRoleAction = function (state: GameState, actor: Player, action: RoleActionSubmission): void {
      if (isDeathGatedEffect(action.effect)) {
        const prompt = roleActionPrompt(actor, state);
        if (prompt && !fakeDeathActionAvailable(state, actor, prompt)) return;
      }
      if (action.effect === "necromancer_milestone") {
        return resolveNecromancerWithRealDeaths(this, state, actor, action);
      }
      return originalResolveNightRoleAction.call(this, state, actor, action);
    };
  }

  if (typeof originalLegalTargets === "function") {
    proto.legalTargets = function (state: GameState, actor: Player, mode: string): Player[] {
      const targets = originalLegalTargets.call(this, state, actor, mode) as Player[];
      if (mode !== "one_dead") return targets;
      return targets.filter((player) => isRealDeadForDeathGate(state, player));
    };
  }
}

function isDeathGatedEffect(effect: string): boolean {
  return [
    "kill_if_hive_dead",
    "convert_to_werewolf_if_last",
    "kill_if_no_wolves",
    "necromancer_milestone",
    "awaken_if_wolf_dead"
  ].includes(effect);
}

function markUnavailableFakeDeathActions(room: any, state: GameState): boolean {
  if (state.phase !== "night") return false;
  let changed = false;
  for (const actor of state.players) {
    if (!actor.alive || actor.isSpectator || actor.kickedAt || state.nightActions.roleActions[actor.id]) continue;
    const prompt = roleActionPrompt(actor, state);
    if (!prompt || prompt.timing !== "night" || fakeDeathActionAvailable(state, actor, prompt)) continue;
    state.nightActions.roleActions[actor.id] = {
      effect: prompt.effect,
      targetIds: [],
      option: PASS_OPTION,
      submittedAt: Date.now()
    };
    changed = true;
  }
  return changed;
}

function reconcileFakeDeathNightGate(room: any, state: GameState): void {
  if (state.phase !== "night") return;
  const changed = markUnavailableFakeDeathActions(room, state);
  if (!changed) return;
  if (areNightActionsComplete(state)) {
    room.finishNight(state);
    return;
  }
  room.saveBroadcast(state);
}

function resolveNecromancerWithRealDeaths(
  room: any,
  state: GameState,
  actor: Player,
  action: RoleActionSubmission
): void {
  const dead = state.players.filter((player) => isRealDeadForDeathGate(state, player)).length;
  const ratio = state.initialPlayerCount > 0 ? dead / state.initialPlayerCount : 0;
  const memory = room.mem(state, actor.id) as Record<string, any>;
  const targetId = action.targetIds[0];
  const target = targetId
    ? state.players.find((player) => player.id === targetId && countsAsAliveForDeathGate(state, player))
    : undefined;

  if (ratio >= 0.5 && memory.deathShield !== 1) memory.deathShield = 1;
  if (ratio >= 0.75 && target) {
    room.killPlayer(state, target.id, "necromancer", actor.id, true);
    return;
  }
  if (ratio >= 0.25 && target) {
    room.storeRoleResult(state, actor, target, target.role ? roleDefinition(target.role).name : "未知");
  }
}
