import { areEqualVotesComplete } from "./equal-vote.js";
import { normalizeDebateCursor } from "./core-integrity.js";
import type { GameState, Player, RoleActionSubmission } from "./types.js";

type RoomPrototype = Record<string, any> & { __coreMagicianRulesInstalled?: boolean };

const MAGICIAN_SUMMARY = "每局一次選兩名其他玩家：一死一活交換生死；兩人都活且在白天時交換目前投票；其他情況交換職業與勝利陣營歸屬。";

export function installCoreMagicianRules(GameRoomCtor: { prototype: RoomPrototype }): void {
  const proto = GameRoomCtor.prototype;
  if (proto.__coreMagicianRulesInstalled) return;
  proto.__coreMagicianRulesInstalled = true;

  const originalProjectState = proto.projectState;
  const originalSubmitRoleActionInternal = proto.submitRoleActionInternal;
  const originalResolveNightRoleAction = proto.resolveNightRoleAction;

  if (typeof originalProjectState === "function") {
    proto.projectState = function (state: GameState, token: string): any {
      const view = originalProjectState.call(this, state, token);
      if (!view?.me) return view;
      const actor = this.playerByToken(state, token) as Player;
      const prompt = magicianPrompt(state, actor);
      if (prompt && (state.phase === "debate" || state.phase === "vote")) view.roleAction = prompt;
      return view;
    };
  }

  if (typeof originalSubmitRoleActionInternal === "function") {
    proto.submitRoleActionInternal = function (state: GameState, actor: Player, effect: string, targetIds: string[], option?: string): void {
      if (effect !== "magician_swap" || actor.role !== "magician" || state.phase === "night") {
        return originalSubmitRoleActionInternal.call(this, state, actor, effect, targetIds, option);
      }
      const prompt = magicianPrompt(state, actor);
      if (!prompt) throw new Error("魔術師技能目前不可用");
      validateMagicianTargets(state, actor, targetIds);
      const action: RoleActionSubmission = { effect: "magician_swap", targetIds: [...targetIds], submittedAt: Date.now() };
      resolveMagicianBySource(this, state, actor, action);
      this.mem(state, actor.id)["used:magician_swap"] = true;
      reconcileAfterImmediateMagician(this, state);
    };
  }

  if (typeof originalResolveNightRoleAction === "function") {
    proto.resolveNightRoleAction = function (state: GameState, actor: Player, action: RoleActionSubmission): void {
      if (action.effect !== "magician_swap" || actor.role !== "magician") return originalResolveNightRoleAction.call(this, state, actor, action);
      validateMagicianTargets(state, actor, action.targetIds);
      resolveMagicianBySource(this, state, actor, action);
    };
  }
}

export function magicianPrompt(state: GameState, actor: Player): Record<string, unknown> | undefined {
  if (actor.role !== "magician" || !actor.alive || actor.isSpectator || actor.kickedAt) return undefined;
  if (!["night", "debate", "vote"].includes(state.phase)) return undefined;
  if (state.roleMemory[actor.id]?.["used:magician_swap"] === true) return undefined;
  if (state.roleMemory[actor.id]?.disabledPermanently === true) return undefined;
  const disabledUntil = state.roleMemory[actor.id]?.disabledUntilRound;
  if (typeof disabledUntil === "number" && disabledUntil >= state.round) return undefined;
  return {
    role: "magician",
    timing: state.phase === "night" ? "night" : state.phase === "vote" ? "vote" : "day",
    effect: "magician_swap",
    targetMode: "two_any",
    oncePerGame: true,
    label: "魔術師",
    description: MAGICIAN_SUMMARY
  };
}

export function resolveMagicianBySource(room: any, state: GameState, actor: Player, action: RoleActionSubmission): void {
  const [aId, bId] = action.targetIds;
  const a = state.players.find((player) => player.id === aId && !player.isSpectator && !player.kickedAt);
  const b = state.players.find((player) => player.id === bId && !player.isSpectator && !player.kickedAt);
  if (!a || !b) throw new Error("魔術師目標無效");

  const aTrueDead = isTrueDead(state, a);
  const bTrueDead = isTrueDead(state, b);
  const aAliveLike = !aTrueDead;
  const bAliveLike = !bTrueDead;

  if (aTrueDead !== bTrueDead) {
    const dead = aTrueDead ? a : b;
    const living = aTrueDead ? b : a;
    convertAliveLikeToTrueDeath(room, state, living, actor.id);
    reviveMagicianTarget(room, state, dead);
    return;
  }

  if (aAliveLike && bAliveLike && (state.phase === "debate" || state.phase === "vote")) {
    swapCurrentVotes(state, a.id, b.id);
    return;
  }

  swapRoleAndVictoryAllegiance(a, b);
}

function validateMagicianTargets(state: GameState, actor: Player, targetIds: string[]): void {
  const unique = [...new Set(targetIds)];
  if (unique.length !== 2 || unique.includes(actor.id)) throw new Error("魔術師必須選擇兩名不同且不是自己的玩家");
  const valid = new Set(state.players.filter((player) => !player.isSpectator && !player.kickedAt).map((player) => player.id));
  if (unique.some((id) => !valid.has(id))) throw new Error("魔術師目標無效");
}

function isTrueDead(state: GameState, player: Player): boolean {
  return !player.alive && state.roleMemory[player.id]?.fakeDeath !== true;
}

function convertAliveLikeToTrueDeath(room: any, state: GameState, player: Player, magicianId: string): void {
  const memory = room.mem(state, player.id) as Record<string, any>;
  if (!player.alive && memory.fakeDeath === true) {
    player.alive = true;
    delete memory.fakeDeath;
    delete memory.reviveRound;
    delete state.deathReasons[player.id];
  }
  room.killPlayer(state, player.id, "magician_swap", magicianId, true);
}

function reviveMagicianTarget(room: any, state: GameState, player: Player): void {
  player.alive = true;
  player.isSpectator = false;
  delete state.deathReasons[player.id];
  const memory = room.mem(state, player.id) as Record<string, any>;
  delete memory.fakeDeath;
  delete memory.reviveRound;
  if (player.role === "betrayer" && player.factionOverride === "werewolf") delete player.factionOverride;
  if (state.pendingReaction?.actorId === player.id) delete state.pendingReaction;
  const system = room.systemMem(state) as Record<string, any>;
  const queue = Array.isArray(system.deathReactionQueue) ? system.deathReactionQueue as string[] : [];
  system.deathReactionQueue = queue.filter((raw) => !raw.startsWith(`${player.id}|`));
}

function swapCurrentVotes(state: GameState, aId: string, bId: string): void {
  const aVote = state.votes[aId];
  const bVote = state.votes[bId];
  if (bVote) state.votes[aId] = bVote; else delete state.votes[aId];
  if (aVote) state.votes[bId] = aVote; else delete state.votes[bId];
}

function swapRoleAndVictoryAllegiance(a: Player, b: Player): void {
  const aRole = a.role;
  const bRole = b.role;
  const aFaction = a.factionOverride;
  const bFaction = b.factionOverride;
  if (bRole) a.role = bRole; else delete a.role;
  if (aRole) b.role = aRole; else delete b.role;
  if (bFaction) a.factionOverride = bFaction; else delete a.factionOverride;
  if (aFaction) b.factionOverride = aFaction; else delete b.factionOverride;
}

function reconcileAfterImmediateMagician(room: any, state: GameState): void {
  if (state.pendingReaction) {
    state.phase = "reaction";
    room.saveBroadcast(state);
    return;
  }
  if (state.phase === "debate") {
    normalizeDebateCursor(state);
    if (state.debateIndex >= state.debateOrder.length) {
      room.enterVote(state);
      return;
    }
  }
  if (state.phase === "vote" && areEqualVotesComplete(state)) {
    room.finishVote(state);
    return;
  }
  room.saveBroadcast(state);
}
