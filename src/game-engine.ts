import { ROLE_LIST, roleDefinition } from "./roles.js";
import type {
  Faction,
  GameState,
  NightActions,
  Player,
  Role,
  RoleActionPrompt,
  RoleSetup,
  Team,
  WitchAction
} from "./types";

export function defaultRoleSetup(_playerCount: number): RoleSetup {
  const setup: RoleSetup = {};
  for (const def of ROLE_LIST) setup[def.id] = 1;
  return setup;
}

export function growRoleSetup(setup: RoleSetup): RoleSetup {
  return { ...setup };
}

export function roleSetupTotal(setup: RoleSetup): number {
  return Object.values(setup).reduce((sum, value) => sum + (typeof value === "number" ? value : 0), 0);
}

export function factionCountInSetup(setup: RoleSetup, faction: Faction): number {
  let total = 0;
  for (const def of ROLE_LIST) total += def.faction === faction ? (setup[def.id] ?? 0) : 0;
  return total;
}

export function validateRoleSetup(setup: RoleSetup, playerCount: number): string | undefined {
  for (const [role, raw] of Object.entries(setup)) {
    if (!roleDefinition(role as Role)) return `未知角色：${role}`;
    if (!Number.isInteger(raw) || (raw ?? -1) < 0) return `${role} 數量必須是 0 以上整數`;
  }
  if (!Number.isInteger(playerCount) || playerCount < 3) return "至少需要 3 名正式玩家才能開始";
  const total = roleSetupTotal(setup);
  if (total < playerCount) return `角色總數至少要等於正式玩家數（目前 ${total} / ${playerCount}）`;
  const wolves = factionCountInSetup(setup, "werewolf");
  if (wolves < 1) return "至少需要 1 名狼人陣營角色";
  const nonWolves = total - wolves;
  const maxWolves = Math.floor((playerCount - 1) / 2);
  const minNonWolves = playerCount - maxWolves;
  if (nonWolves < minNonWolves) return `非狼人陣營角色不足，至少需要 ${minNonWolves} 名才能維持開局狼人少於其他玩家`;
  return undefined;
}

export function roleDeckFromSetup(setup: RoleSetup, playerCount: number): Role[] {
  const error = validateRoleSetup(setup, playerCount);
  if (error) throw new Error(error);

  const wolfPool: Role[] = [];
  const nonWolfPool: Role[] = [];
  for (const def of ROLE_LIST) {
    const count = setup[def.id] ?? 0;
    const target = def.faction === "werewolf" ? wolfPool : nonWolfPool;
    for (let i = 0; i < count; i += 1) target.push(def.id);
  }

  const shuffledWolves = secureShuffle(wolfPool);
  const guaranteedWolf = shuffledWolves.shift();
  if (!guaranteedWolf) throw new Error("至少需要 1 名狼人陣營角色");

  const deck: Role[] = [guaranteedWolf];
  let wolfCount = 1;
  const maxWolves = Math.floor((playerCount - 1) / 2);
  const candidates = secureShuffle([...shuffledWolves, ...nonWolfPool]);
  for (const role of candidates) {
    if (deck.length >= playerCount) break;
    const isWolf = roleDefinition(role).faction === "werewolf";
    if (isWolf && wolfCount >= maxWolves) continue;
    deck.push(role);
    if (isWolf) wolfCount += 1;
  }

  if (deck.length !== playerCount) throw new Error(`無法從目前角色池安全選出 ${playerCount} 個角色`);
  return secureShuffle(deck);
}

export function secureShuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = secureRandomInt(i + 1);
    const current = out[i];
    out[i] = out[j]!;
    out[j] = current!;
  }
  return out;
}

function secureRandomInt(maxExclusive: number): number {
  if (maxExclusive <= 0) throw new Error("maxExclusive must be positive");
  const maxUint = 0x1_0000_0000;
  const limit = maxUint - (maxUint % maxExclusive);
  const buffer = new Uint32Array(1);
  do crypto.getRandomValues(buffer); while (buffer[0]! >= limit);
  return buffer[0]! % maxExclusive;
}

export function activePlayers(players: Player[]): Player[] {
  return players.filter((p) => !p.isSpectator);
}

export function assignRoles(players: Player[], setup: RoleSetup): Player[] {
  const participants = activePlayers(players);
  const roles = secureShuffle(roleDeckFromSetup(setup, participants.length));
  let index = 0;
  return players.map((player) => {
    const next: Player = { ...player };
    if (player.isSpectator) delete next.role;
    else next.role = roles[index++]!;
    return next;
  });
}

export function teamForRole(role: Role): Team {
  return roleDefinition(role).faction;
}

export function playerFaction(player: Player): Faction | undefined {
  return player.factionOverride ?? (player.role ? teamForRole(player.role) : undefined);
}

export function checkWinner(players: Player[]): Team | undefined {
  const alive = activePlayers(players).filter((p) => p.alive);
  if (alive.length === 0) return undefined;

  const cowards = alive.filter((p) => p.role === "coward");
  if (alive.length === 3 && cowards.length === 1) {
    const others = alive.filter((p) => p.role !== "coward").map(playerFaction);
    if (others.includes("werewolf") && others.includes("village")) return "neutral";
  }

  const blood = alive.filter((p) => playerFaction(p) === "blood").length;
  if (blood > 0 && blood === alive.length) return "blood";

  if (alive.length === 1 && playerFaction(alive[0]!) === "neutral") return "neutral";

  const wolves = alive.filter((p) => playerFaction(p) === "werewolf").length;
  const spirits = alive.filter((p) => playerFaction(p) === "spirit").length;
  const nonWolves = alive.length - wolves;
  if (wolves === 0) return spirits > 0 ? "spirit" : "village";
  if (wolves >= nonWolves) return "werewolf";
  return undefined;
}

export function pluralityTarget(votes: Record<string, string>): string | undefined {
  const counts = new Map<string, number>();
  for (const target of Object.values(votes)) counts.set(target, (counts.get(target) ?? 0) + 1);
  if (counts.size === 0) return undefined;
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (ordered.length > 1 && ordered[0]![1] === ordered[1]![1]) return undefined;
  return ordered[0]![0];
}

export interface NightResolution {
  wolfTarget: string | undefined;
  poisonedTarget: string | undefined;
  deaths: string[];
  healed: boolean;
  protectedByGuard: boolean;
}

export function resolveNight(
  state: Pick<GameState, "players" | "nightActions" | "witchHealAvailable" | "witchPoisonAvailable">
): NightResolution {
  const wolfTarget = pluralityTarget(state.nightActions.wolfVotes);
  const guardTarget = pluralityTarget(state.nightActions.guardTargets);
  const witchAction = firstWitchAction(state.nightActions.witchActions);
  const healed = Boolean(wolfTarget && witchAction?.type === "heal" && state.witchHealAvailable);
  const protectedByGuard = Boolean(wolfTarget && guardTarget === wolfTarget);
  const poisonedTarget = witchAction?.type === "poison" && state.witchPoisonAvailable ? witchAction.targetId : undefined;
  const deaths = new Set<string>();
  if (wolfTarget && !healed && !protectedByGuard) deaths.add(wolfTarget);
  if (poisonedTarget) deaths.add(poisonedTarget);
  return { wolfTarget, poisonedTarget, deaths: [...deaths], healed, protectedByGuard };
}

function firstWitchAction(actions: Record<string, WitchAction>): WitchAction | undefined {
  return Object.values(actions)[0];
}

export function freshNightActions(): NightActions {
  return { wolfVotes: {}, seerTargets: {}, guardTargets: {}, witchActions: {}, roleActions: {} };
}

export function livingPlayers(players: Player[]): Player[] {
  return activePlayers(players).filter((p) => p.alive);
}

export function createDebateOrder(players: Player[]): string[] {
  return secureShuffle(livingPlayers(players).filter((p) => p.role !== "captain").map((p) => p.id));
}

export function currentDebaterId(order: readonly string[], index: number): string | undefined {
  return index >= 0 && index < order.length ? order[index] : undefined;
}

export function isDebateComplete(order: readonly string[], index: number): boolean {
  return order.length === 0 || index >= order.length;
}

export function canGuardTarget(previousTargetId: string | undefined, targetId: string): boolean {
  return previousTargetId !== targetId;
}

export function canWitchSelfSave(playerCount: number, round: number): boolean {
  return playerCount <= 10 && round === 1;
}

export function roleActionPrompt(player: Player, state: GameState): RoleActionPrompt | undefined {
  if (!player.role || player.isSpectator) return undefined;
  if (!player.alive && !(state.phase === "reaction" && state.pendingReaction?.actorId === player.id)) return undefined;
  if (["werewolf", "seer", "guard", "witch"].includes(player.role)) return undefined;
  const def = roleDefinition(player.role);
  const action = def.action;
  if (!action) return undefined;
  if (player.role === "lurking_wolf" && state.roleMemory[player.id]?.awake !== true) {
    const otherWolfDead = state.players.some((p) => p.id !== player.id && playerFaction(p) === "werewolf" && !p.alive);
    if (!otherWolfDead) return undefined;
  }
  const timingMatches =
    (action.timing === "night" && state.phase === "night") ||
    (action.timing === "day" && state.phase === "debate") ||
    (action.timing === "vote" && state.phase === "vote") ||
    (action.timing === "reaction" && state.phase === "reaction" && state.pendingReaction?.actorId === player.id) ||
    (action.timing === "sheriff" && state.phase === "sheriff") ||
    (action.timing === "setup" && (state.phase === "lobby" || state.phase === "sheriff"));
  if (!timingMatches) return undefined;
  if (action.fromRound && state.round < action.fromRound) return undefined;
  if (action.oncePerGame && state.roleMemory[player.id]?.[`used:${action.effect}`] === true) return undefined;
  if (state.roleMemory[player.id]?.disabledPermanently === true) return undefined;
  const disabledUntil = state.roleMemory[player.id]?.disabledUntilRound;
  if (typeof disabledUntil === "number" && disabledUntil >= state.round) return undefined;
  return {
    role: player.role,
    timing: action.timing,
    effect: action.effect,
    targetMode: action.targetMode,
    ...(action.options ? { options: action.options } : {}),
    ...(action.oncePerGame ? { oncePerGame: true } : {}),
    label: def.name,
    description: def.summary
  };
}

export function needsNightAction(state: GameState, player: Player): boolean {
  if (state.phase !== "night" || !player.alive || player.isSpectator || !player.role) return false;
  const faction = playerFaction(player);
  const skipsWolfVote = player.role === "sun_wolf" || player.role === "sniper_eight_wolf" || (player.role === "lurking_wolf" && state.roleMemory[player.id]?.awake !== true) || (player.role === "young_wolf" && state.round <= 3);
  if (faction === "werewolf" && !skipsWolfVote) {
    if (!state.nightActions.wolfVotes[player.id]) return true;
    const special = roleActionPrompt(player, state);
    if (special?.timing === "night" && !state.nightActions.roleActions[player.id]) return true;
    return false;
  }
  if (faction === "werewolf" && skipsWolfVote) {
    const special = roleActionPrompt(player, state);
    return special?.timing === "night" && !state.nightActions.roleActions[player.id];
  }
  if (player.role === "seer") return !state.nightActions.seerTargets[player.id];
  if (player.role === "guard") return !state.nightActions.guardTargets[player.id];
  if (player.role === "witch") return !state.nightActions.witchActions[player.id];
  const prompt = roleActionPrompt(player, state);
  return prompt?.timing === "night" && !state.nightActions.roleActions[player.id];
}

export function areNightActionsComplete(state: GameState): boolean {
  return livingPlayers(state.players).every((player) => !needsNightAction(state, player));
}

export function isAIVotingUnlocked(players: Player[], votes: Record<string, string>): boolean {
  const livingHumans = livingPlayers(players).filter((p) => !p.isAI);
  if (livingHumans.length === 0) return true;
  return livingHumans.some((p) => Boolean(votes[p.id]));
}

export function effectiveVoteWeight(player: Player, target: Player | undefined, state: GameState): number {
  if (!player.role) return 1;
  const passives = new Set(roleDefinition(player.role).passives ?? []);
  if (passives.has("vote_weight_zero")) return 0;
  if (passives.has("vote_only_counts_against_non_village") && target && playerFaction(target) === "village") return 0;
  const bonus = state.roleMemory[player.id]?.voteBonus;
  const sheriffBonus = state.sheriff.sheriffId === player.id ? 1 : 0;
  return 1 + sheriffBonus + (typeof bonus === "number" ? Math.max(0, bonus) : 0);
}

export function weightedVoteCounts(state: GameState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [voterId, targetId] of Object.entries(state.votes)) {
    const voter = state.players.find((p) => p.id === voterId && p.alive && !p.isSpectator);
    const target = state.players.find((p) => p.id === targetId && p.alive && !p.isSpectator);
    if (!voter || !target) continue;
    counts[targetId] = (counts[targetId] ?? 0) + effectiveVoteWeight(voter, target, state);
  }
  for (const player of livingPlayers(state.players)) {
    const raven = state.roleMemory[player.id]?.ravenVote;
    if (typeof raven === "string" && Object.keys(state.votes).length > 0) counts[raven] = (counts[raven] ?? 0) + 1;
    const bomb = state.roleMemory[player.id]?.bombHolder;
    if (typeof bomb === "string" && bomb === player.id) counts[player.id] = (counts[player.id] ?? 0) + 1;
  }
  return counts;
}

export function topWeightedVoteTargets(state: GameState): string[] {
  const entries = Object.entries(weightedVoteCounts(state)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (entries.length === 0 || entries[0]![1] <= 0) return [];
  const top = entries[0]![1];
  return entries.filter(([, count]) => count === top).map(([id]) => id);
}

export function randomTopVoteTarget(state: GameState): string | undefined {
  const topTargets = topWeightedVoteTargets(state);
  if (topTargets.length === 0) return undefined;
  if (topTargets.length === 1) return topTargets[0];
  return secureShuffle(topTargets)[0];
}

export function weightedPluralityTarget(state: GameState): string | undefined {
  const top = topWeightedVoteTargets(state);
  return top.length === 1 ? top[0] : undefined;
}

export function areVotesComplete(state: GameState): boolean {
  return livingPlayers(state.players).every((p) => Boolean(state.votes[p.id]));
}