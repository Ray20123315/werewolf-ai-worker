import { livingPlayers, playerFaction, secureShuffle } from "./game-engine.js";
import { roleDefinition } from "./roles.js";
import type { GameState, Player } from "./types.js";

type RoomPrototype = Record<string, any> & { __equalVoteRulesInstalled?: boolean };

const AUTO_SKIP_TARGET = "__ai_auto_skip__";
const FIXED_TIE_RULE = "random_elimination" as const;

export function validExilePlayers(state: GameState): Player[] {
  return state.players.filter((player) => player.alive && !player.isSpectator && !player.kickedAt);
}

export function sanitizeExileVotes(state: GameState): boolean {
  const players = validExilePlayers(state);
  const validIds = new Set(players.map((player) => player.id));
  const aiIds = new Set(players.filter((player) => player.isAI).map((player) => player.id));
  let changed = false;
  for (const [voterId, targetId] of Object.entries(state.votes)) {
    const validSkip = targetId === AUTO_SKIP_TARGET && aiIds.has(voterId);
    if (!validIds.has(voterId) || (!validSkip && (!validIds.has(targetId) || voterId === targetId))) {
      delete state.votes[voterId];
      changed = true;
    }
  }
  return changed;
}

export function equalVoteCounts(state: GameState): Record<string, number> {
  const validIds = new Set(validExilePlayers(state).map((player) => player.id));
  const counts: Record<string, number> = {};
  for (const [voterId, targetId] of Object.entries(state.votes)) {
    if (!validIds.has(voterId) || !validIds.has(targetId) || voterId === targetId || targetId === AUTO_SKIP_TARGET) continue;
    counts[targetId] = (counts[targetId] ?? 0) + 1;
  }
  return counts;
}

export function equalVoteTopTargets(state: GameState): string[] {
  const entries = Object.entries(equalVoteCounts(state)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!entries.length || entries[0]![1] <= 0) return [];
  const top = entries[0]![1];
  return entries.filter(([, count]) => count === top).map(([id]) => id);
}

export function randomEqualVoteTopTarget(state: GameState): string | undefined {
  const top = equalVoteTopTargets(state);
  if (!top.length) return undefined;
  return top.length === 1 ? top[0] : secureShuffle(top)[0];
}

export function areEqualVotesComplete(state: GameState): boolean {
  const players = validExilePlayers(state);
  const validIds = new Set(players.map((player) => player.id));
  return players.every((voter) => {
    const targetId = state.votes[voter.id];
    if (targetId === AUTO_SKIP_TARGET && voter.isAI) return true;
    return typeof targetId === "string" && targetId !== voter.id && validIds.has(targetId);
  });
}

export function installEqualVoteRules(GameRoomCtor: { prototype: RoomPrototype }): void {
  const proto = GameRoomCtor.prototype;
  if (proto.__equalVoteRulesInstalled) return;
  proto.__equalVoteRulesInstalled = true;

  const originalRequireState = proto.requireState;
  const originalConfigureSettings = proto.configureSettings;
  const originalKickPlayerInternal = proto.kickPlayerInternal;
  const originalProjectState = proto.projectState;

  proto.requireState = function (): GameState {
    const state = originalRequireState.call(this) as GameState;
    if (state?.settings) state.settings.tieRule = FIXED_TIE_RULE;
    return state;
  };

  if (typeof originalConfigureSettings === "function") {
    proto.configureSettings = function (token: string, raw: Record<string, unknown>): void {
      return originalConfigureSettings.call(this, token, { ...raw, tieRule: FIXED_TIE_RULE });
    };
  }

  proto.castVoteById = function (state: GameState, voterId: string, targetId: string): void {
    if (state.phase !== "vote") throw new Error("目前不是放逐投票階段");
    state.settings.tieRule = FIXED_TIE_RULE;
    sanitizeExileVotes(state);
    clearLegacyVoteFlow(this, state);

    const voter = validExilePlayers(state).find((player) => player.id === voterId);
    const target = validExilePlayers(state).find((player) => player.id === targetId);
    if (!voter || !target) throw new Error("投票玩家或目標無效");
    if (voter.id === target.id) throw new Error("不能投給自己");

    state.votes[voter.id] = target.id;
    sanitizeExileVotes(state);
    if (areEqualVotesComplete(state)) this.finishVote(state);
    else this.saveBroadcast(state);
  };

  proto.finishVote = function (state: GameState): void {
    state.settings.tieRule = FIXED_TIE_RULE;
    sanitizeExileVotes(state);
    clearLegacyVoteFlow(this, state);

    for (const player of validExilePlayers(state)) {
      if (this.mem(state, player.id).trappedVoteRound === state.round && state.votes[player.id]) this.killPlayer(state, player.id, "trapper", undefined, true);
      if (player.role === "ferry_spirit" && Object.values(state.votes).includes(player.id)) this.killPlayer(state, player.id, "ferry_vote", undefined, true);
    }

    for (const verifier of validExilePlayers(state).filter((player) => player.role === "verifier")) {
      const wolfVoted = Object.keys(state.votes).some((id) => {
        const voter = state.players.find((player) => player.id === id && player.alive && !player.isSpectator && !player.kickedAt);
        return voter && playerFaction(voter) === "werewolf";
      });
      this.storeRoleResult(state, verifier, verifier, wolfVoted ? "本輪有效投票者中有狼人陣營" : "本輪有效投票者中沒有狼人陣營");
    }

    const topTargets = equalVoteTopTargets(state);
    const eliminatedId = randomEqualVoteTopTarget(state);
    if (topTargets.length > 1 && eliminatedId) {
      this.addSystemMessage(state, `最高票平手：${topTargets.map((id) => this.nameOf(state, id)).join("、")}。從最高票並列者中隨機抽中 ${this.nameOf(state, eliminatedId)} 出局。`);
    }

    if (eliminatedId) {
      const target = state.players.find((player) => player.id === eliminatedId);
      if (topTargets.length === 1 && target?.role === "masochist_cultist") {
        state.winner = "neutral";
        state.winnerPlayerIds = [target.id];
        state.winnerLabel = `${target.name}（抖M教徒）成為唯一最高票者，達成特殊勝利`;
        return this.endGame(state, "neutral");
      }
      if (target?.role === "scapegoater" && this.mem(state, target.id)["used:redirect_exile"] !== true) {
        state.pendingReaction = { actorId: target.id, effect: "redirect_exile", reason: "被放逐", resumePhase: "night" };
        state.phase = "reaction";
        this.saveBroadcast(state);
        return;
      }
      state.lastVoteEliminated = eliminatedId;
      if (target?.role === "blood_wolf") {
        const livingWolves = livingPlayers(state.players).filter((player) => playerFaction(player) === "werewolf" && !player.kickedAt);
        if (livingWolves.length === 1 && livingWolves[0]!.id === target.id && this.mem(state, target.id).bloodLastStandUsed !== true) {
          const memory = this.mem(state, target.id);
          memory.bloodLastStandUsed = true;
          memory.bloodLastStandRound = state.round + 1;
          this.addSystemMessage(state, `${target.name}（血狼）作為最後一狼被放逐，但依角色能力延後到下一個夜晚結束才真正出局。`);
          clearLegacyVoteFlow(this, state);
          this.enterNight(state, state.round + 1);
          return;
        }
      }
      this.killPlayer(state, eliminatedId, "exile");
      if (target?.role === "cursed_spirit") {
        for (const voterId of Object.keys(state.votes)) this.mem(state, voterId).disabledUntilRound = state.round + 1;
      }
      if (target) {
        this.addSystemMessage(state, `${target.name} 經辯論後被放逐出局。`);
        for (const medium of validExilePlayers(state).filter((player) => player.role === "medium")) {
          this.storeRoleResult(state, medium, target, `被放逐者陣營：${this.factionName(playerFaction(target) ?? "neutral")}`);
        }
      }
      if (state.pendingReaction) {
        state.phase = "reaction";
        this.saveBroadcast(state);
        return;
      }
    } else {
      delete state.lastVoteEliminated;
      this.addSystemMessage(state, "本輪沒有有效放逐目標，無人出局。 ");
    }

    clearLegacyVoteFlow(this, state);
    this.checkAndMaybeEnd(state);
    if (state.winner) return;
    this.enterNight(state, state.round + 1);
  };

  if (typeof originalKickPlayerInternal === "function") {
    proto.kickPlayerInternal = function (state: GameState, targetId: string, sourceLabel: string): void {
      const result = originalKickPlayerInternal.call(this, state, targetId, sourceLabel);
      if (state.phase !== "vote") return result;
      sanitizeExileVotes(state);
      clearLegacyVoteFlow(this, state);
      if (areEqualVotesComplete(state)) this.finishVote(state);
      return result;
    };
  }

  if (typeof originalProjectState === "function") {
    proto.projectState = function (state: GameState, token: string): any {
      if (state?.settings) state.settings.tieRule = FIXED_TIE_RULE;
      const view = originalProjectState.call(this, state, token);
      if (view?.settings) view.settings.tieRule = FIXED_TIE_RULE;
      const me = this.playerByToken(state, token) as Player;
      if (me.role === "precog" && state.phase === "vote") {
        const top = equalVoteTopTargets(state);
        view.me.roleResults = { ...(view.me.roleResults ?? {}) };
        if (top.length === 1) {
          const player = state.players.find((item) => item.id === top[0]);
          view.me.roleResults["precog:top"] = player?.role ? `目前唯一最高票 ${player.name}：${roleDefinition(player.role).name}` : "目前最高票尚未唯一確定";
        } else view.me.roleResults["precog:top"] = "目前最高票尚未唯一確定";
      }
      return view;
    };
  }
}

function clearLegacyVoteFlow(room: any, state: GameState): void {
  const system = room.systemMem(state) as Record<string, unknown>;
  delete system.voteRevoteCount;
  delete system.pkVoteCandidates;
}
