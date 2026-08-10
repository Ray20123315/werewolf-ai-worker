import type { GameState, NightActions, Player, Role, RoleSetup, Team, WitchAction } from "./types";

const SPECIAL_ROLES: readonly Role[] = ["seer", "witch", "guard"];

export function defaultRoleSetup(playerCount: number): RoleSetup {
  const count = Math.max(1, Math.trunc(playerCount));
  const werewolf = Math.max(1, Math.floor(count / 4));
  const seer = count >= 4 ? 1 : 0;
  const witch = count >= 6 ? 1 : 0;
  const guard = count >= 8 ? 1 : 0;
  const reserved = werewolf + seer + witch + guard;
  return {
    werewolf,
    villager: Math.max(0, count - reserved),
    seer,
    witch,
    guard
  };
}

export function growRoleSetup(setup: RoleSetup): RoleSetup {
  return { ...setup, villager: setup.villager + 1 };
}

export function roleSetupTotal(setup: RoleSetup): number {
  return setup.werewolf + setup.villager + setup.seer + setup.witch + setup.guard;
}

export function validateRoleSetup(setup: RoleSetup, playerCount: number): string | undefined {
  for (const [role, raw] of Object.entries(setup)) {
    if (!Number.isInteger(raw) || raw < 0) return `${role} 數量必須是 0 以上整數`;
  }
  if (!Number.isInteger(playerCount) || playerCount < 3) return "至少需要 3 名玩家才能開始";
  if (setup.werewolf < 1) return "至少需要 1 名狼人";
  for (const role of SPECIAL_ROLES) {
    if (setup[role] > 1) return `${role} 目前最多只能設定 1 名`;
  }
  if (roleSetupTotal(setup) !== playerCount) return `角色總數必須等於玩家數（目前 ${roleSetupTotal(setup)} / ${playerCount}）`;
  const villageSide = playerCount - setup.werewolf;
  if (setup.werewolf >= villageSide) return "開局時狼人數必須少於非狼人玩家數";
  return undefined;
}

export function roleDeckFromSetup(setup: RoleSetup, playerCount: number): Role[] {
  const error = validateRoleSetup(setup, playerCount);
  if (error) throw new Error(error);
  return [
    ...Array<Role>(setup.werewolf).fill("werewolf"),
    ...Array<Role>(setup.villager).fill("villager"),
    ...Array<Role>(setup.seer).fill("seer"),
    ...Array<Role>(setup.witch).fill("witch"),
    ...Array<Role>(setup.guard).fill("guard")
  ];
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
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0]! >= limit);
  return buffer[0]! % maxExclusive;
}

export function assignRoles(players: Player[], setup: RoleSetup): Player[] {
  const roles = secureShuffle(roleDeckFromSetup(setup, players.length));
  return players.map((player, index) => ({ ...player, role: roles[index]! }));
}

export function teamForRole(role: Role): Team {
  return role === "werewolf" ? "werewolf" : "village";
}

export function checkWinner(players: Player[]): Team | undefined {
  const alive = players.filter((p) => p.alive);
  const wolves = alive.filter((p) => p.role === "werewolf").length;
  const village = alive.length - wolves;
  if (wolves === 0) return "village";
  if (wolves >= village) return "werewolf";
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
  return { wolfVotes: {}, seerTargets: {}, guardTargets: {}, witchActions: {} };
}

export function livingPlayers(players: Player[]): Player[] {
  return players.filter((p) => p.alive);
}

export function createDebateOrder(players: Player[]): string[] {
  return secureShuffle(livingPlayers(players).map((p) => p.id));
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

export function areNightActionsComplete(state: GameState): boolean {
  for (const player of livingPlayers(state.players)) {
    if (!player.role) continue;
    if (player.role === "werewolf" && !state.nightActions.wolfVotes[player.id]) return false;
    if (player.role === "seer" && !state.nightActions.seerTargets[player.id]) return false;
    if (player.role === "guard" && !state.nightActions.guardTargets[player.id]) return false;
    if (player.role === "witch" && !state.nightActions.witchActions[player.id]) return false;
  }
  return true;
}

export function isAIVotingUnlocked(players: Player[], votes: Record<string, string>): boolean {
  const livingHumans = livingPlayers(players).filter((p) => !p.isAI);
  if (livingHumans.length === 0) return true;
  return livingHumans.some((p) => Boolean(votes[p.id]));
}

export function areVotesComplete(state: GameState): boolean {
  return livingPlayers(state.players).every((p) => Boolean(state.votes[p.id]));
}
