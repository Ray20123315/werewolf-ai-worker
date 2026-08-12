import { activePlayers, checkWinner, playerFaction } from "./game-engine.js";
import { ROLE_LIST, roleDefinition } from "./roles.js";
import type { GameState, RoleSetup } from "./types.js";

type RoomPrototype = Record<string, any> & { __coreStateRulesInstalled?: boolean };
export type RuntimeSettings = GameState["settings"] & {
  winCondition?: "slaughter_edge" | "slaughter_all";
  foolEnabled?: boolean;
  loverGroupSize?: number;
  dayDurationSeconds?: number;
  nightDurationSeconds?: number;
};
type RuntimeState = GameState & { coreDefaultRolePoolV1?: boolean; lastVoteSummary?: unknown };

export const CORE_REMOVED_ROLE_IDS = ["confirmed_villager", "mimic_wolf", "diviner"] as const;
export const DEFAULT_PHASE_SECONDS = 120;
export const FOOL_CHANCE = 0.25;
const REMOVED_ROLE_SET = new Set<string>(CORE_REMOVED_ROLE_IDS);

export function activeCoreRoleDefinitions() {
  return ROLE_LIST.filter((role) => !REMOVED_ROLE_SET.has(role.id));
}

export function defaultAllRoleSetup(): RoleSetup {
  const setup: Record<string, number> = {};
  for (const role of activeCoreRoleDefinitions()) setup[role.id] = 1;
  return setup as RoleSetup;
}

export function exactDuplicateCoreSkills(): Array<{ roles: string[]; signature: string }> {
  const groups = new Map<string, string[]>();
  for (const role of activeCoreRoleDefinitions()) {
    if (!role.action) continue;
    const signature = JSON.stringify({
      faction: role.faction,
      timing: role.action.timing,
      effect: role.action.effect,
      targetMode: role.action.targetMode,
      oncePerGame: Boolean(role.action.oncePerGame),
      fromRound: role.action.fromRound ?? 0,
      options: [...(role.action.options ?? [])],
      passives: [...(role.passives ?? [])].sort()
    });
    const roles = groups.get(signature) ?? [];
    roles.push(role.id);
    groups.set(signature, roles);
  }
  return [...groups.entries()].filter(([, roles]) => roles.length > 1).map(([signature, roles]) => ({ roles, signature }));
}

export function coreWinner(state: GameState): ReturnType<typeof checkWinner> {
  const alive = formalLiving(state);
  if (!alive.length) return undefined;
  const wolves = alive.filter((player) => playerFaction(player) === "werewolf").length;
  const redAxes = alive.filter((player) => player.role === "red_axe_madman");
  // Red Axe is explicitly a post-wolf endgame role. Base checkWinner() would
  // otherwise award Village/Spirit immediately when wolves reach zero.
  if (wolves === 0 && redAxes.length) {
    return alive.every((player) => player.role === "red_axe_madman") ? "neutral" : undefined;
  }
  const base = checkWinner(state.players);
  if (base && base !== "werewolf") return base;
  if (!wolves) return base;
  const settings = state.settings as RuntimeSettings;
  if (settings.winCondition === "slaughter_all") {
    return alive.every((player) => playerFaction(player) === "werewolf") ? "werewolf" : undefined;
  }
  const spirits = alive.filter((player) => playerFaction(player) === "spirit").length;
  const village = alive.filter((player) => playerFaction(player) === "village").length;
  return spirits === 0 && village <= 1 ? "werewolf" : undefined;
}

export function installCoreStateRules(GameRoomCtor: { prototype: RoomPrototype }): void {
  const proto = GameRoomCtor.prototype;
  if (proto.__coreStateRulesInstalled) return;
  proto.__coreStateRulesInstalled = true;

  const originalRequireState = proto.requireState;
  const originalInitialize = proto.initialize;
  const originalJoinHuman = proto.joinHuman;
  const originalAddAI = proto.addAI;
  const originalConfigureRoles = proto.configureRoles;
  const originalConfigureSettings = proto.configureSettings;
  const originalStartGame = proto.startGame;
  const originalResetGame = proto.resetGame;
  const originalProjectState = proto.projectState;

  proto.requireState = function (): GameState {
    const state = originalRequireState.call(this) as GameState;
    migrateCoreState(state);
    return state;
  };

  if (typeof originalInitialize === "function") {
    proto.initialize = async function (...args: any[]): Promise<any> {
      const result = await originalInitialize.apply(this, args);
      const state = this.requireState() as RuntimeState;
      state.roleSetup = defaultAllRoleSetup();
      state.coreDefaultRolePoolV1 = true;
      this.touchAndSave(state);
      return result;
    };
  }

  if (typeof originalJoinHuman === "function") {
    proto.joinHuman = async function (...args: any[]): Promise<any> {
      const before = this.requireState() as RuntimeState;
      const preserve = before.phase === "lobby" && before.coreDefaultRolePoolV1 === true;
      const result = await originalJoinHuman.apply(this, args);
      if (preserve) restoreDefaultRolePool(this);
      return result;
    };
  }

  if (typeof originalAddAI === "function") {
    proto.addAI = async function (...args: any[]): Promise<any> {
      const before = this.requireState() as RuntimeState;
      const preserve = before.phase === "lobby" && before.coreDefaultRolePoolV1 === true;
      const result = await originalAddAI.apply(this, args);
      if (preserve) restoreDefaultRolePool(this);
      return result;
    };
  }

  if (typeof originalConfigureRoles === "function") {
    proto.configureRoles = function (token: string, raw: RoleSetup): void {
      const result = originalConfigureRoles.call(this, token, stripRemovedRoles(raw));
      const state = this.requireState() as RuntimeState;
      state.coreDefaultRolePoolV1 = false;
      this.touchAndSave(state);
      this.broadcast(state);
      return result;
    };
  }

  if (typeof originalConfigureSettings === "function") {
    proto.configureSettings = function (token: string, raw: Record<string, unknown>): void {
      const result = originalConfigureSettings.call(this, token, raw);
      const state = this.requireState() as RuntimeState;
      const settings = state.settings as RuntimeSettings;
      if (raw.winCondition === "slaughter_edge" || raw.winCondition === "slaughter_all") settings.winCondition = raw.winCondition;
      if (typeof raw.foolEnabled === "boolean") settings.foolEnabled = raw.foolEnabled;
      if (raw.loverGroupSize !== undefined) settings.loverGroupSize = clampInteger(raw.loverGroupSize, 2, 50, settings.loverGroupSize ?? 2);
      if (raw.dayDurationSeconds !== undefined) settings.dayDurationSeconds = clampInteger(raw.dayDurationSeconds, 15, 3600, settings.dayDurationSeconds ?? DEFAULT_PHASE_SECONDS);
      if (raw.nightDurationSeconds !== undefined) settings.nightDurationSeconds = clampInteger(raw.nightDurationSeconds, 15, 3600, settings.nightDurationSeconds ?? DEFAULT_PHASE_SECONDS);
      if (raw.autoRoleSetup === true) state.coreDefaultRolePoolV1 = false;
      applyWinnerMetadata(state);
      this.touchAndSave(state);
      this.broadcast(state);
      return result;
    };
  }

  if (typeof originalStartGame === "function") {
    proto.startGame = function (token: string): void {
      const before = this.requireState() as RuntimeState;
      before.roleSetup = stripRemovedRoles(before.roleSetup);
      const result = originalStartGame.call(this, token);
      const state = this.requireState() as RuntimeState;
      assignFools(this, state);
      state.coreDefaultRolePoolV1 = false;
      this.touchAndSave(state);
      this.broadcast(state);
      return result;
    };
  }

  if (typeof originalResetGame === "function") {
    proto.resetGame = function (token: string): void {
      const result = originalResetGame.call(this, token);
      const state = this.requireState() as RuntimeState;
      state.roleSetup = defaultAllRoleSetup();
      state.coreDefaultRolePoolV1 = true;
      this.touchAndSave(state);
      this.broadcast(state);
      return result;
    };
  }

  if (typeof originalProjectState === "function") {
    proto.projectState = function (state: GameState, token: string): any {
      const view = originalProjectState.call(this, state, token);
      if (!state?.settings || !view?.me) return view;
      const me = this.playerByToken(state, token);
      const settings = state.settings as RuntimeSettings;
      view.settings.winCondition = settings.winCondition;
      view.settings.foolEnabled = settings.foolEnabled;
      view.settings.loverGroupSize = settings.loverGroupSize;
      view.settings.dayDurationSeconds = settings.dayDurationSeconds;
      view.settings.nightDurationSeconds = settings.nightDurationSeconds;
      view.removedRoleIds = [...CORE_REMOVED_ROLE_IDS];
      view.lastVoteSummary = (state as RuntimeState).lastVoteSummary;
      view.pendingReaction = state.pendingReaction;
      view.me.isFool = this.mem(state, me.id).isFool === true;
      if (me.role) {
        const definition = roleDefinition(me.role);
        view.me.roleSummary = definition.summary;
        view.me.roleSkill = definition.action ? {
          timing: definition.action.timing,
          effect: definition.action.effect,
          targetMode: definition.action.targetMode,
          oncePerGame: Boolean(definition.action.oncePerGame),
          fromRound: definition.action.fromRound,
          options: definition.action.options ? [...definition.action.options] : []
        } : null;
        view.me.rolePassives = [...(definition.passives ?? [])];
      }
      view.me.canHunterLastWords = state.phase === "reaction" && state.pendingReaction?.actorId === me.id && me.role === "hunter" && this.mem(state, me.id).hunterLastWordsSent !== true;
      return view;
    };
  }
}

export function migrateCoreState(state: GameState): void {
  if (!state || !state.settings || !Array.isArray(state.players)) return;
  state.roleSetup ??= {};
  const settings = state.settings as RuntimeSettings;
  if (settings.winCondition !== "slaughter_edge" && settings.winCondition !== "slaughter_all") settings.winCondition = "slaughter_edge";
  settings.foolEnabled ??= false;
  settings.loverGroupSize = clampInteger(settings.loverGroupSize, 2, 50, 2);
  settings.dayDurationSeconds = clampInteger(settings.dayDurationSeconds, 15, 3600, DEFAULT_PHASE_SECONDS);
  settings.nightDurationSeconds = clampInteger(settings.nightDurationSeconds, 15, 3600, DEFAULT_PHASE_SECONDS);
  state.roleSetup = stripRemovedRoles(state.roleSetup);
  for (const player of state.players) if (String(player.role) === "confirmed_villager") player.role = "villager";
  applyWinnerMetadata(state);
}

export function stripRemovedRoles(setup: RoleSetup): RoleSetup {
  const next = { ...setup } as Record<string, number>;
  for (const roleId of CORE_REMOVED_ROLE_IDS) delete next[roleId];
  return next as RoleSetup;
}

export function formalPlayers(state: GameState) {
  return activePlayers(state.players).filter((player) => !player.kickedAt);
}

export function formalLiving(state: GameState) {
  return formalPlayers(state).filter((player) => player.alive);
}

export function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function applyWinnerMetadata(state: GameState): void {
  const players = state.players as any;
  players.__winConditionMode = (state.settings as RuntimeSettings).winCondition === "slaughter_all" ? "slaughter_all" : "slaughter_edge";
  if (players.__winConditionMode === "slaughter_edge") {
    players.__initialCivilianEdge = false;
    players.__initialGodEdge = false;
  }
}

function restoreDefaultRolePool(room: any): void {
  const state = room.requireState() as RuntimeState;
  if (state.phase !== "lobby") return;
  state.roleSetup = defaultAllRoleSetup();
  state.coreDefaultRolePoolV1 = true;
  room.touchAndSave(state);
  room.broadcast(state);
}

function assignFools(room: any, state: GameState): void {
  const enabled = (state.settings as RuntimeSettings).foolEnabled === true;
  for (const player of formalPlayers(state)) {
    const memory = room.mem(state, player.id) as Record<string, unknown>;
    if (enabled) memory.isFool = randomQuarter();
    else delete memory.isFool;
    delete memory.hunterLastWordsSent;
  }
}

function randomQuarter(): boolean {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0]! < 0x40000000;
}
