import { areNightActionsComplete, livingPlayers, playerFaction, secureShuffle, validateRoleSetup } from "./game-engine.js";
import { roleDefinition } from "./roles.js";
import type { GameState, Player, RoleSetup } from "./types.js";

type RoomPrototype = Record<string, any> & { __addonIdentitiesInstalled?: boolean };
type RuntimeAITask = { playerId: string; operation: string };
const MASOCHIST = "masochist_cultist" as const;
const SADIST = "sadist_leader" as const;
const LOVER = "lover" as const;
type AddonIdentity = typeof LOVER | typeof MASOCHIST | typeof SADIST;
type AddonPlayer = Player & { addonRoles?: AddonIdentity[]; loverId?: string };

const CONFIGURED_ADDONS = [MASOCHIST, SADIST] as const;
const SADIST_AI_OPERATION = "addon_sadist_probe";

export function installAddonIdentityRules(GameRoomCtor: { prototype: RoomPrototype }): void {
  const proto = GameRoomCtor.prototype;
  if (proto.__addonIdentitiesInstalled) return;
  proto.__addonIdentitiesInstalled = true;
  describeConfiguredAddons();

  const originalRequireState = proto.requireState;
  const originalStartGame = proto.startGame;
  const originalResetGame = proto.resetGame;
  const originalProjectState = proto.projectState;
  const originalHandleClientMessage = proto.handleClientMessage;
  const originalPendingAITask = proto.pendingAITask;
  const originalRunAI = proto.runAI;
  const originalFinishNight = proto.finishNight;
  const originalKillPlayer = proto.killPlayer;
  const originalResolveNightRoleAction = proto.resolveNightRoleAction;
  const originalEndGame = proto.endGame;
  const originalCheckAndMaybeEnd = proto.checkAndMaybeEnd;

  proto.requireState = function (): GameState {
    const state = originalRequireState.call(this) as GameState;
    migrateLegacyAddonState(this, state);
    return state;
  };

  proto.startGame = function (token: string): void {
    const state = this.requireState() as GameState;
    this.assertHost(state, token);
    this.assertLobby(state);
    if (state.settings.autoRoleSetup) return originalStartGame.call(this, token);

    const configuredSetup = { ...state.roleSetup } as RoleSetup;
    const masochistCount = addonCount(configuredSetup, MASOCHIST);
    const sadistCount = addonCount(configuredSetup, SADIST);
    validateAddonSetup(state, masochistCount, sadistCount);

    const baseSetup = baseRoleSetup(configuredSetup);
    const participants = formalPlayers(state);
    const baseError = validateRoleSetup(baseSetup, participants.length);
    if (baseError) throw new Error(baseError.replace("角色總數", "本體角色總數"));

    assignConfiguredAddons(state, masochistCount, sadistCount);
    state.roleSetup = baseSetup;
    try {
      originalStartGame.call(this, token);
    } catch (error) {
      state.roleSetup = configuredSetup;
      for (const player of state.players as AddonPlayer[]) player.addonRoles = addonList(player).filter((addon) => addon === LOVER);
      throw error;
    }

    const started = this.requireState() as GameState;
    started.roleSetup = configuredSetup;
    this.touchAndSave(started);
    this.broadcast(started);
  };

  if (typeof originalResetGame === "function") {
    proto.resetGame = function (token: string): void {
      const result = originalResetGame.call(this, token);
      const state = this.requireState() as GameState;
      for (const player of state.players as AddonPlayer[]) {
        delete player.addonRoles;
        delete player.loverId;
      }
      this.touchAndSave(state);
      this.broadcast(state);
      return result;
    };
  }

  proto.resolveNightRoleAction = function (state: GameState, actor: Player, action: any): void {
    const result = originalResolveNightRoleAction.call(this, state, actor, action);
    if (action?.effect === "link_lovers") syncLoverAddons(state);
    migrateLegacyAddonState(this, state);
    return result;
  };

  proto.projectState = function (state: GameState, token: string): any {
    migrateLegacyAddonState(this, state);
    const view = originalProjectState.call(this, state, token);
    const me = this.playerByToken(state, token) as AddonPlayer;
    const ownAddons = addonList(me);
    if (ownAddons.length) view.me.addonRoles = [...ownAddons];

    for (const publicPlayer of view.players ?? []) {
      const player = state.players.find((item) => item.id === publicPlayer.id) as AddonPlayer | undefined;
      if (!player) continue;
      const visible: AddonIdentity[] = [];
      if (state.phase === "ended") visible.push(...addonList(player));
      else if (hasAddon(player, MASOCHIST) && isMasochistPublic(this, state, player.id)) visible.push(MASOCHIST);
      if (visible.length) publicPlayer.addonRoles = [...new Set(visible)];
    }

    if (state.phase === "lobby" && !state.settings.autoRoleSetup) {
      const baseError = validateRoleSetup(baseRoleSetup(state.roleSetup), formalPlayers(state).length);
      if (baseError) {
        view.roleSetupError = baseError.replace("角色總數", "本體角色總數");
        view.canStart = false;
      } else if (String(view.roleSetupError ?? "").includes("角色總數")) {
        delete view.roleSetupError;
        view.canStart = true;
      }
      const masochists = addonCount(state.roleSetup, MASOCHIST);
      const sadists = addonCount(state.roleSetup, SADIST);
      try { validateAddonSetup(state, masochists, sadists); }
      catch (error) {
        view.roleSetupError = error instanceof Error ? error.message : String(error);
        view.canStart = false;
      }
    }

    const addonActions = availableAddonActions(this, state, me);
    if (addonActions.length) view.addonActions = addonActions;
    return view;
  };

  proto.handleClientMessage = async function (token: string, command: any): Promise<void> {
    if (command?.type === "addon_action") {
      const state = this.requireState() as GameState;
      const actor = this.playerByToken(state, token) as AddonPlayer;
      if (actor.isAI) throw new Error("AI 附加身份由房主 BYOK 自動執行");
      if (command.addon !== SADIST || command.effect !== "probe_masochist") throw new Error("附加身份操作無效");
      submitSadistProbe(this, state, actor, String(command.targetId ?? ""));
      return;
    }
    return originalHandleClientMessage.call(this, token, command);
  };

  proto.pendingAITask = function (state: GameState): RuntimeAITask | undefined {
    migrateLegacyAddonState(this, state);
    const baseTask = originalPendingAITask.call(this, state) as RuntimeAITask | undefined;
    if (baseTask) return baseTask;
    if (state.phase !== "night") return undefined;
    const actor = nextPendingSadist(state);
    if (actor?.isAI && actor.ai) return { playerId: actor.id, operation: SADIST_AI_OPERATION };
    return undefined;
  };

  proto.runAI = async function (hostToken: string, playerId: string, apiKeys: string[]): Promise<{ ok: true }> {
    const state = this.requireState() as GameState;
    const task = this.pendingAITask(state) as RuntimeAITask | undefined;
    if (!task || task.playerId !== playerId || task.operation !== SADIST_AI_OPERATION) {
      return originalRunAI.call(this, hostToken, playerId, apiKeys);
    }
    this.assertHost(state, hostToken);
    const actor = state.players.find((player) => player.id === playerId) as AddonPlayer | undefined;
    if (!actor?.alive || actor.isSpectator || !hasAddon(actor, SADIST)) throw new Error("AI 附加身份狀態無效");
    const candidates = sadistProbeCandidates(this, state, actor);
    if (!candidates.length) {
      this.mem(state, actor.id).sadistProbeRound = state.round;
      afterAddonNightSubmission(this, state);
      return { ok: true };
    }
    const target = secureShuffle(candidates)[0]!;
    submitSadistProbe(this, state, actor, target.id);
    return { ok: true };
  };

  proto.finishNight = function (state: GameState): void {
    migrateLegacyAddonState(this, state);
    if (nextPendingSadist(state)) {
      this.saveBroadcast(state);
      return;
    }
    const result = originalFinishNight.call(this, state);
    const system = this.systemMem(state) as Record<string, unknown>;
    if (!state.winner && state.phase === "night" && system.addonBlockedFactionWinner === true) {
      delete system.addonBlockedFactionWinner;
      this.beginDebate(state);
    }
    return result;
  };

  proto.killPlayer = function (state: GameState, targetId: string, reason: string, killerId?: string, bypassProtection = false): boolean {
    migrateLegacyAddonState(this, state);
    const target = state.players.find((player) => player.id === targetId && player.alive && !player.isSpectator) as AddonPlayer | undefined;
    if (!target) return false;

    if (hasAddon(target, SADIST) && shouldSadistRedirect(this, state, target, reason, bypassProtection)) {
      const bodyguardId = this.mem(state, target.id).sadistBodyguardId;
      const bodyguard = typeof bodyguardId === "string"
        ? state.players.find((player) => player.id === bodyguardId && player.alive && !player.isSpectator && hasAddon(player as AddonPlayer, MASOCHIST)) as AddonPlayer | undefined
        : undefined;
      if (bodyguard) {
        delete this.mem(state, target.id).sadistBodyguardId;
        this.addSystemMessage(state, `${bodyguard.name}（抖M）替 ${target.name}（抖S）承受死亡。`);
        return originalKillPlayer.call(this, state, bodyguard.id, "sadist_bodyguard", target.id, true);
      }
    }

    const killed = originalKillPlayer.call(this, state, targetId, reason, killerId, bypassProtection) as boolean;
    if (killed && reason === "exile" && hasAddon(target, MASOCHIST)) {
      delete state.pendingReaction;
      const system = this.systemMem(state) as Record<string, unknown>;
      system.deathReactionQueue = [];
      state.winnerPlayerIds = [target.id];
      state.winnerLabel = `${target.name}（抖M）被一般放逐處決，達成個人特殊勝利`;
      this.endGame(state, "neutral");
    }
    return killed;
  };

  proto.endGame = function (state: GameState, winner: any): void {
    migrateLegacyAddonState(this, state);
    if (state.winner) return;
    if (state.winnerPlayerIds?.length || state.winnerLabel) return originalEndGame.call(this, state, winner);

    const loverPair = soleLivingLoverPair(state);
    if (loverPair) {
      state.winnerPlayerIds = loverPair.map((player) => player.id);
      state.winnerLabel = `${loverPair[0]!.name}、${loverPair[1]!.name}（情侶）成為最後存活者，情侶共同獲勝`;
      return originalEndGame.call(this, state, "neutral");
    }

    if (mixedLivingLoversBlockFactionWin(state)) {
      const system = this.systemMem(state) as Record<string, unknown>;
      system.addonBlockedFactionWinner = true;
      return;
    }
    return originalEndGame.call(this, state, winner);
  };

  proto.checkAndMaybeEnd = function (state: GameState): void {
    if (state.winner) return;
    const result = originalCheckAndMaybeEnd.call(this, state);
    if (!state.winner) delete (this.systemMem(state) as Record<string, unknown>).addonBlockedFactionWinner;
    return result;
  };
}

export function baseRoleSetup(setup: RoleSetup): RoleSetup {
  const out = { ...setup } as RoleSetup;
  delete out[MASOCHIST];
  delete out[SADIST];
  return out;
}

export function baseRoleSetupTotal(setup: RoleSetup): number {
  return Object.values(baseRoleSetup(setup)).reduce((sum, value) => sum + (typeof value === "number" ? value : 0), 0);
}

function addonCount(setup: RoleSetup, addon: typeof CONFIGURED_ADDONS[number]): number {
  const value = setup[addon];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

function formalPlayers(state: GameState): AddonPlayer[] {
  return state.players.filter((player) => !player.isSpectator && !player.kickedAt) as AddonPlayer[];
}

function validateAddonSetup(state: GameState, masochists: number, sadists: number): void {
  const total = formalPlayers(state).length;
  if (masochists > total || sadists > total) throw new Error("附加身份數量不能超過正式玩家數");
  if (masochists + sadists > total) throw new Error("抖M與抖S必須附加在不同玩家身上，合計不能超過正式玩家數");
  if (sadists > 0 && masochists === 0) throw new Error("啟用抖S時至少需要 1 名抖M");
}

function assignConfiguredAddons(state: GameState, masochistCount: number, sadistCount: number): void {
  const players = formalPlayers(state);
  for (const player of players) player.addonRoles = addonList(player).filter((addon) => addon === LOVER);

  const shuffled = secureShuffle(players);
  const masochists = shuffled.slice(0, masochistCount);
  for (const player of masochists) addAddon(player, MASOCHIST);

  const sadistPool = secureShuffle(players.filter((player) => !hasAddon(player, MASOCHIST)));
  for (const player of sadistPool.slice(0, sadistCount)) addAddon(player, SADIST);
}

function migrateLegacyAddonState(room: any, state: GameState): void {
  for (const player of state.players as AddonPlayer[]) {
    if (player.role === MASOCHIST || player.role === SADIST) {
      addAddon(player, player.role);
      player.role = "villager";
    }
  }
  syncLoverAddons(state);
}

function syncLoverAddons(state: GameState): void {
  for (const player of state.players as AddonPlayer[]) {
    const loverId = state.roleMemory[player.id]?.lover;
    if (typeof loverId !== "string") continue;
    const lover = state.players.find((item) => item.id === loverId) as AddonPlayer | undefined;
    if (!lover || state.roleMemory[lover.id]?.lover !== player.id) continue;
    player.loverId = lover.id;
    lover.loverId = player.id;
    addAddon(player, LOVER);
    addAddon(lover, LOVER);
  }
}

function addonList(player: AddonPlayer): AddonIdentity[] {
  if (!Array.isArray(player.addonRoles)) return [];
  return player.addonRoles.filter((value): value is AddonIdentity => value === LOVER || value === MASOCHIST || value === SADIST);
}

function hasAddon(player: AddonPlayer, addon: AddonIdentity): boolean {
  return addonList(player).includes(addon);
}

function addAddon(player: AddonPlayer, addon: AddonIdentity): void {
  const current = addonList(player);
  if (!current.includes(addon)) current.push(addon);
  player.addonRoles = current;
}

function availableAddonActions(room: any, state: GameState, actor: AddonPlayer): any[] {
  if (state.phase !== "night" || !actor.alive || actor.isSpectator || !hasAddon(actor, SADIST)) return [];
  if (!sadistNeedsProbe(room, state, actor)) return [];
  const candidates = sadistProbeCandidates(room, state, actor);
  if (!candidates.length) return [];
  return [{
    addon: SADIST,
    effect: "probe_masochist",
    label: "抖S",
    description: "附加身份：每晚可查驗一名尚未查過的存活玩家是否為抖M；查中後該抖M成為你的死亡肉盾。",
    candidateIds: candidates.map((player) => player.id)
  }];
}

function nextPendingSadist(state: GameState): AddonPlayer | undefined {
  return livingPlayers(state.players).find((player) => sadistNeedsProbeWithoutRoom(state, player as AddonPlayer)) as AddonPlayer | undefined;
}

function sadistNeedsProbe(room: any, state: GameState, actor: AddonPlayer): boolean {
  return sadistNeedsProbeWithoutRoom(state, actor) && sadistProbeCandidates(room, state, actor).length > 0;
}

function sadistNeedsProbeWithoutRoom(state: GameState, actor: AddonPlayer): boolean {
  if (state.phase !== "night" || !actor.alive || actor.isSpectator || !hasAddon(actor, SADIST)) return false;
  const memory = state.roleMemory[actor.id] ?? {};
  const boundId = memory.sadistBodyguardId;
  if (typeof boundId === "string") {
    const bound = state.players.find((player) => player.id === boundId && player.alive && !player.isSpectator) as AddonPlayer | undefined;
    if (bound && hasAddon(bound, MASOCHIST)) return false;
    delete memory.sadistBodyguardId;
  }
  if (memory.sadistProbeRound === state.round) return false;
  return livingPlayers(state.players).some((player) => player.id !== actor.id && hasAddon(player as AddonPlayer, MASOCHIST));
}

function sadistProbeCandidates(room: any, state: GameState, actor: AddonPlayer): AddonPlayer[] {
  const probed = new Set(room.asStringArray(room.mem(state, actor.id).sadistProbedIds) as string[]);
  return livingPlayers(state.players).filter((player) => player.id !== actor.id && !probed.has(player.id) && !player.kickedAt) as AddonPlayer[];
}

function submitSadistProbe(room: any, state: GameState, actor: AddonPlayer, targetId: string): void {
  if (state.phase !== "night" || !actor.alive || actor.isSpectator || !hasAddon(actor, SADIST)) throw new Error("目前不能使用抖S附加身份");
  if (!sadistNeedsProbe(room, state, actor)) throw new Error("本晚沒有需要執行的抖S查驗");
  const candidates = sadistProbeCandidates(room, state, actor);
  const target = candidates.find((player) => player.id === targetId);
  if (!target) throw new Error("抖S查驗目標無效或已查驗過");

  const memory = room.mem(state, actor.id) as Record<string, unknown>;
  const probed = room.asStringArray(memory.sadistProbedIds) as string[];
  if (!probed.includes(target.id)) probed.push(target.id);
  memory.sadistProbedIds = probed;
  memory.sadistProbeRound = state.round;

  state.roleResults[actor.id] ??= {};
  if (hasAddon(target, MASOCHIST)) {
    memory.sadistBodyguardId = target.id;
    room.mem(state, target.id).masochistRevealRound = state.round;
    state.roleResults[actor.id]![`sadist:${state.round}`] = `${target.name} 是抖M；已建立肉盾保護。`;
  } else {
    state.roleResults[actor.id]![`sadist:${state.round}`] = `${target.name} 不是抖M。`;
  }
  afterAddonNightSubmission(room, state);
}

function afterAddonNightSubmission(room: any, state: GameState): void {
  if (areNightActionsComplete(state) && !nextPendingSadist(state)) room.finishNight(state);
  else room.saveBroadcast(state);
}

function isMasochistPublic(room: any, state: GameState, playerId: string): boolean {
  const revealRound = room.mem(state, playerId).masochistRevealRound;
  return typeof revealRound === "number" && state.phase !== "night" && state.round >= revealRound;
}

function shouldSadistRedirect(room: any, state: GameState, target: AddonPlayer, reason: string, bypassProtection: boolean): boolean {
  if (reason === "lover" || reason === "sadist_bodyguard" || reason.includes("exile")) return false;
  const bodyguardId = room.mem(state, target.id).sadistBodyguardId;
  if (typeof bodyguardId !== "string") return false;
  const bodyguard = state.players.find((player) => player.id === bodyguardId && player.alive && !player.isSpectator) as AddonPlayer | undefined;
  if (!bodyguard || !hasAddon(bodyguard, MASOCHIST)) return false;
  return !baseProtectionWouldAbsorb(room, state, target, reason, bypassProtection);
}

function baseProtectionWouldAbsorb(room: any, state: GameState, target: AddonPlayer, reason: string, bypassProtection: boolean): boolean {
  if (bypassProtection) return false;
  const memory = room.mem(state, target.id) as Record<string, unknown>;
  if (reason === "wolf" && target.role === "wraith") return true;
  if (reason.includes("poison") && target.role === "medicine_wolf") return true;
  if (reason.includes("poison") && target.role === "ghost_hunter" && memory.poisonShieldUsed !== true) return true;
  if (state.phase === "night" && target.role === "vampire_wolf" && memory.vampireShield === 1) return true;
  if (reason === "wolf" && target.role === "physicist" && memory.physicsShieldUsed !== true) return true;
  if (memory.deathShield === 1) return true;
  if (state.phase === "night" && memory.nightBlessing === true) return true;
  if (state.phase !== "night" && memory.dayBlessing === true) return true;
  if (reason === "wolf" && memory.nightProtectedRound === state.round) return true;
  if (reason === "wolf" && typeof room.isPermanentlyGuarded === "function" && room.isPermanentlyGuarded(state, target.id)) return true;
  return false;
}

function reciprocalLoverPairs(state: GameState): [AddonPlayer, AddonPlayer][] {
  const seen = new Set<string>();
  const pairs: [AddonPlayer, AddonPlayer][] = [];
  for (const player of state.players as AddonPlayer[]) {
    if (!player.alive || player.isSpectator || !hasAddon(player, LOVER) || typeof player.loverId !== "string" || seen.has(player.id)) continue;
    const lover = state.players.find((item) => item.id === player.loverId && item.alive && !item.isSpectator) as AddonPlayer | undefined;
    if (!lover || lover.loverId !== player.id || !hasAddon(lover, LOVER)) continue;
    seen.add(player.id);
    seen.add(lover.id);
    pairs.push([player, lover]);
  }
  return pairs;
}

function soleLivingLoverPair(state: GameState): [AddonPlayer, AddonPlayer] | undefined {
  const alive = livingPlayers(state.players).filter((player) => !player.kickedAt) as AddonPlayer[];
  if (alive.length !== 2) return undefined;
  return reciprocalLoverPairs(state).find(([a, b]) => alive.every((player) => player.id === a.id || player.id === b.id));
}

function mixedLivingLoversBlockFactionWin(state: GameState): boolean {
  return reciprocalLoverPairs(state).some(([a, b]) => {
    const left = playerFaction(a);
    const right = playerFaction(b);
    return Boolean(left && right && left !== right);
  });
}

function describeConfiguredAddons(): void {
  const masochist = roleDefinition(MASOCHIST);
  masochist.summary = "附加身份：保留本體角色與陣營；一般放逐票仍為 1 票。若自己被一般放逐處決，立即達成個人特殊勝利。";
  masochist.passives = ["addon_identity", "wins_if_exiled"];
  delete masochist.action;
  const sadist = roleDefinition(SADIST);
  sadist.summary = "附加身份：保留本體角色與陣營。每晚查驗一名玩家是否為抖M；查中後該抖M成為死亡肉盾，但放逐與情侶殉情不轉移。";
  sadist.passives = ["addon_identity", "finds_masochist_bodyguard"];
  delete sadist.action;
}
