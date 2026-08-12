import { livingPlayers, playerFaction, secureShuffle } from "./game-engine.js";
import { roleDefinition } from "./roles.js";
import type { GameState, Player } from "./types.js";

type RoomPrototype = Record<string, any> & { __equalVoteRulesInstalled?: boolean };

export const AUTO_SKIP_TARGET = "__ai_auto_skip__";
export const ABSTAIN_TARGET = "__abstain__";
const FIXED_TIE_RULE = "random_elimination" as const;

type VoteStatus = "valid" | "abstain" | "invalid";
export interface VoteSnapshotEntry {
  voterId: string;
  targetId?: string;
  status: VoteStatus;
  reason?: string;
  automatic?: boolean;
}
export interface VoteSnapshot {
  round: number;
  entries: VoteSnapshotEntry[];
  counts: Record<string, number>;
  topTargetIds: string[];
}

export function validExilePlayers(state: GameState): Player[] {
  return state.players.filter((player) => player.alive && !player.isSpectator && !player.kickedAt);
}

export function sanitizeExileVotes(state: GameState): boolean {
  const players = validExilePlayers(state);
  const validIds = new Set(players.map((player) => player.id));
  let changed = false;
  for (const [voterId, targetId] of Object.entries(state.votes)) {
    if (!validIds.has(voterId)) {
      delete state.votes[voterId];
      changed = true;
      continue;
    }
    if (targetId === ABSTAIN_TARGET || targetId === AUTO_SKIP_TARGET) continue;
    if (!validIds.has(targetId) || voterId === targetId) {
      rememberInvalidatedVote(state, voterId, targetId, !validIds.has(targetId) ? "目標已不再是有效玩家" : "不能投給自己");
      delete state.votes[voterId];
      changed = true;
    }
  }
  return changed;
}

export function createVoteSnapshot(state: GameState): VoteSnapshot {
  const players = validExilePlayers(state);
  const validIds = new Set(players.map((player) => player.id));
  const entries: VoteSnapshotEntry[] = [];
  const counts: Record<string, number> = {};

  const history = Array.isArray((state as any).invalidatedVoteHistory)
    ? (state as any).invalidatedVoteHistory.filter((item: any) => item && typeof item.voterId === "string")
    : [];
  for (const item of history) entries.push({ voterId: item.voterId, targetId: item.targetId, status: "invalid", reason: item.reason ?? "先前投票已失效" });

  for (const voter of players) {
    const targetId = state.votes[voter.id];
    if (targetId === ABSTAIN_TARGET || targetId === AUTO_SKIP_TARGET || targetId === undefined) {
      entries.push({ voterId: voter.id, status: "abstain", automatic: targetId === undefined || targetId === AUTO_SKIP_TARGET });
      continue;
    }
    const target = state.players.find((player) => player.id === targetId);
    if (!target || !validIds.has(targetId) || targetId === voter.id) {
      entries.push({ voterId: voter.id, targetId, status: "invalid", reason: !target || !validIds.has(targetId) ? "目標無效" : "不能投給自己" });
      continue;
    }

    const memory = state.roleMemory[voter.id] ?? {};
    const ravenInvalid = memory.ravenInvalidVoteRound === state.round;
    const bombInvalid = memory.bombInvalidVoteRound === state.round;
    const berserkerShield = memory.berserkerVoteShieldRound === state.round;
    if ((ravenInvalid || bombInvalid) && !berserkerShield) {
      const reason = ravenInvalid && bombInvalid ? "受到烏鴉與炸彈效果，本輪普通放逐票無效" : ravenInvalid ? "受到烏鴉詛咒，本輪普通放逐票無效" : "投票時持有炸彈，本輪普通放逐票無效";
      entries.push({ voterId: voter.id, targetId, status: "invalid", reason });
      continue;
    }

    const passives = new Set(voter.role ? roleDefinition(voter.role).passives ?? [] : []);
    if (passives.has("vote_weight_zero")) {
      entries.push({ voterId: voter.id, targetId, status: "invalid", reason: "此角色的普通放逐票為無效票" });
      continue;
    }
    if (passives.has("vote_only_counts_against_non_village") && playerFaction(target) === "village") {
      entries.push({ voterId: voter.id, targetId, status: "invalid", reason: "此角色投給好人陣營時票無效" });
      continue;
    }

    entries.push({ voterId: voter.id, targetId, status: "valid" });
    counts[targetId] = (counts[targetId] ?? 0) + 1;
  }

  const ordered = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = ordered[0]?.[1] ?? 0;
  const topTargetIds = top > 0 ? ordered.filter(([, count]) => count === top).map(([id]) => id) : [];
  return { round: state.round, entries, counts, topTargetIds };
}

export function equalVoteCounts(state: GameState): Record<string, number> {
  return createVoteSnapshot(state).counts;
}

export function equalVoteTopTargets(state: GameState): string[] {
  return createVoteSnapshot(state).topTargetIds;
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
    if (targetId === ABSTAIN_TARGET || targetId === AUTO_SKIP_TARGET) return true;
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
    if (!voter) throw new Error("投票玩家無效");
    const voterMemory = this.mem(state, voter.id) as Record<string, any>;
    delete voterMemory.berserkerVoteShieldRound;

    if (targetId === ABSTAIN_TARGET || targetId === AUTO_SKIP_TARGET) {
      state.votes[voter.id] = targetId;
    } else {
      const target = validExilePlayers(state).find((player) => player.id === targetId);
      if (!target) throw new Error("投票目標無效");
      if (voter.id === target.id) throw new Error("不能投給自己");

      const externallyInvalid = voterMemory.ravenInvalidVoteRound === state.round || voterMemory.bombHolder === voter.id;
      const bonus = Number(voterMemory.voteBonus ?? 0);
      if (voter.role === "berserker_wolf" && externallyInvalid && bonus > 0) {
        voterMemory.voteBonus = bonus - 1;
        voterMemory.berserkerVoteShieldRound = state.round;
      }

      if (voterMemory.bombHolder === voter.id) {
        voterMemory.bombInvalidVoteRound = state.round;
        delete voterMemory.bombHolder;
        this.mem(state, target.id).bombHolder = target.id;
      }
      state.votes[voter.id] = target.id;
    }

    if (areEqualVotesComplete(state)) this.finishVote(state);
    else this.saveBroadcast(state);
  };

  proto.finishVote = function (state: GameState): void {
    state.settings.tieRule = FIXED_TIE_RULE;
    clearLegacyVoteFlow(this, state);

    const snapshot = createVoteSnapshot(state);
    (state as any).lastVoteSummary = snapshot;
    delete (state as any).invalidatedVoteHistory;
    announceVoteSnapshot(this, state, snapshot);

    const actuallyVoted = new Set(snapshot.entries.filter((entry) => entry.status !== "abstain").map((entry) => entry.voterId));
    const validEntries = snapshot.entries.filter((entry): entry is VoteSnapshotEntry & { targetId: string } => entry.status === "valid" && typeof entry.targetId === "string");
    const validTargetIds = validEntries.map((entry) => entry.targetId);

    for (const player of validExilePlayers(state)) {
      if (this.mem(state, player.id).trappedVoteRound === state.round && actuallyVoted.has(player.id)) this.killPlayer(state, player.id, "trapper", undefined, true);
      if (player.role === "ferry_spirit" && validTargetIds.includes(player.id)) this.killPlayer(state, player.id, "ferry_vote", undefined, true);
    }

    for (const verifier of validExilePlayers(state).filter((player) => player.role === "verifier")) {
      const wolfVoted = validEntries.some((entry) => {
        const voter = state.players.find((player) => player.id === entry.voterId);
        return voter && playerFaction(voter) === "werewolf";
      });
      this.storeRoleResult(state, verifier, verifier, wolfVoted ? "本輪有效投票者中有狼人陣營" : "本輪有效投票者中沒有狼人陣營");
    }

    const topTargets = snapshot.topTargetIds;
    const eliminatedId = topTargets.length === 0 ? undefined : topTargets.length === 1 ? topTargets[0] : secureShuffle(topTargets)[0];
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
        for (const entry of validEntries.filter((entry) => entry.targetId === target.id)) this.mem(state, entry.voterId).disabledUntilRound = state.round + 1;
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
      const memory = this.mem(state, targetId) as Record<string, any>;
      delete memory.bombHolder;
      if (areEqualVotesComplete(state)) this.finishVote(state);
      return result;
    };
  }

  if (typeof originalProjectState === "function") {
    proto.projectState = function (state: GameState, token: string): any {
      if (state?.settings) state.settings.tieRule = FIXED_TIE_RULE;
      const view = originalProjectState.call(this, state, token);
      if (view?.settings) view.settings.tieRule = FIXED_TIE_RULE;
      view.lastVoteSummary = (state as any).lastVoteSummary;
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

function rememberInvalidatedVote(state: GameState, voterId: string, targetId: string, reason: string): void {
  const history = Array.isArray((state as any).invalidatedVoteHistory) ? (state as any).invalidatedVoteHistory : [];
  history.push({ voterId, targetId, reason });
  (state as any).invalidatedVoteHistory = history.slice(-50);
}

function announceVoteSnapshot(room: any, state: GameState, snapshot: VoteSnapshot): void {
  const countText = Object.entries(snapshot.counts)
    .sort((a, b) => b[1] - a[1] || room.nameOf(state, a[0]).localeCompare(room.nameOf(state, b[0])))
    .map(([id, count]) => `${room.nameOf(state, id)} ${count} 票`)
    .join("、") || "無有效票";
  const abstains = snapshot.entries.filter((entry) => entry.status === "abstain");
  const invalid = snapshot.entries.filter((entry) => entry.status === "invalid");
  const abstainText = abstains.length ? `${abstains.length}（${abstains.map((entry) => room.nameOf(state, entry.voterId)).join("、")}）` : "0";
  const invalidText = invalid.length
    ? `${invalid.length}（${invalid.map((entry) => `${room.nameOf(state, entry.voterId)}${entry.targetId ? `→${room.nameOf(state, entry.targetId)}` : ""}：${entry.reason ?? "無效"}`).join("；")}）`
    : "0";
  room.addSystemMessage(state, `投票結算｜票數：${countText}｜棄票：${abstainText}｜無效票：${invalidText}。`);
}

function clearLegacyVoteFlow(room: any, state: GameState): void {
  const system = room.systemMem(state) as Record<string, unknown>;
  delete system.voteRevoteCount;
  delete system.pkVoteCandidates;
}
