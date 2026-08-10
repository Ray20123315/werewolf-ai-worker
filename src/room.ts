import { DurableObject } from "cloudflare:workers";
import { callAIWithKeys, parseJSONObject } from "./ai";
import { createPasswordVerifier, normalizePlayerName, verifyPassword } from "./auth";
import {
  activePlayers,
  areNightActionsComplete,
  areVotesComplete,
  assignRoles,
  canGuardTarget,
  canWitchSelfSave,
  checkWinner,
  createDebateOrder,
  currentDebaterId,
  defaultRoleSetup,
  freshNightActions,
  growRoleSetup,
  isAIVotingUnlocked,
  isDebateComplete,
  livingPlayers,
  needsNightAction,
  playerFaction,
  roleActionPrompt,
  roleSetupTotal,
  secureShuffle,
  teamForRole,
  topWeightedVoteTargets,
  validateRoleSetup,
  weightedPluralityTarget
} from "./game-engine";
import { ROLE_LIST, roleDefinition } from "./roles";
import type {
  AIConfig,
  AppLocale,
  ChatMessage,
  ClientMessage,
  Faction,
  GameSettings,
  GameState,
  NightClientAction,
  PendingAITask,
  Player,
  PrivateView,
  PublicPlayer,
  Role,
  RoleActionEffect,
  RoleActionSubmission,
  RoleMemoryValue,
  RoleSetup,
  ServerMessage,
  WitchAction
} from "./types";

type SocketAttachment = { playerId: string; token: string };
type InitResult = { roomId: string; playerId: string; token: string };
type JoinResult = { playerId: string; token: string; spectator: boolean };
type AIJSON = { message?: unknown; targetId?: unknown; targetIds?: unknown; action?: unknown; option?: unknown };

const DEFAULT_SETTINGS: GameSettings = { sheriffEnabled: false, deathInfo: "names", tieRule: "no_elimination", autoRoleSetup: false };

export class GameRoom extends DurableObject<Env> {
  private stateCache: GameState | undefined;
  private authFailures = new Map<string, { count: number; blockedUntil: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS room_state (key TEXT PRIMARY KEY, json TEXT NOT NULL)`);
    });
  }

  async initialize(roomId: string, hostName: string, hostPassword: string, roomPassword?: string): Promise<InitResult> {
    if (this.loadState()) throw new Error("ROOM_ALREADY_EXISTS");
    const host = await this.newHumanPlayer(hostName, hostPassword, false);
    const now = Date.now();
    const state: GameState = {
      roomId,
      ...(roomPassword?.trim() ? { roomPassword: await createPasswordVerifier(roomPassword, "房間密碼") } : {}),
      hostPlayerId: host.id,
      phase: "lobby",
      round: 0,
      players: [host],
      roleSetup: defaultRoleSetup(1),
      settings: { ...DEFAULT_SETTINGS },
      sheriff: { enabled: false, electionRound: 0, candidates: [], votes: {}, successors: [] },
      messages: [],
      votes: {},
      nightActions: freshNightActions(),
      roleMemory: {},
      seerResults: {},
      roleResults: {},
      witchHealAvailable: true,
      witchPoisonAvailable: true,
      guardLastTargets: {},
      debateOrder: [],
      debateIndex: 0,
      debateCompleted: [],
      lastNightDeaths: [],
      deathReasons: {},
      initialPlayerCount: 1,
      createdAt: now,
      updatedAt: now
    };
    this.addSystemMessage(state, `房間 ${roomId} 已建立。人物密碼可用於重新登入；房內固定採辯論式流程。`);
    this.saveState(state);
    return { roomId, playerId: host.id, token: host.token };
  }

  async roomInfo(): Promise<{ roomId: string; exists: true; requiresRoomPassword: boolean; phase: string; players: number }> {
    const state = this.requireState();
    return {
      roomId: state.roomId,
      exists: true,
      requiresRoomPassword: Boolean(state.roomPassword),
      phase: state.phase,
      players: state.players.filter((p) => !p.kickedAt).length
    };
  }

  async joinHuman(name: string, password: string, roomPassword?: string): Promise<JoinResult> {
    const state = this.requireState();
    await this.assertRoomPassword(state, roomPassword);
    const normalized = normalizePlayerName(name);
    if (state.players.some((p) => !p.kickedAt && p.nameKey === normalized.key)) throw new Error("這個玩家名稱已被使用，請登入原有人物或改用其他名稱");
    const spectator = state.phase !== "lobby";
    const player = await this.newHumanPlayer(normalized.display, password, spectator);
    state.players.push(player);
    if (!spectator) state.roleSetup = state.settings.autoRoleSetup
      ? defaultRoleSetup(activePlayers(state.players).filter((p) => !p.kickedAt).length)
      : growRoleSetup(state.roleSetup);
    this.addSystemMessage(state, spectator ? `${player.name} 以觀戰者身份重新加入；下一局可成為正式玩家。` : `${player.name} 加入房間。`);
    this.touchAndSave(state);
    this.broadcast(state);
    return { playerId: player.id, token: player.token, spectator };
  }

  async loginHuman(name: string, password: string, roomPassword?: string): Promise<JoinResult> {
    const state = this.requireState();
    await this.assertRoomPassword(state, roomPassword);
    const normalized = normalizePlayerName(name);
    this.assertLoginAllowed(normalized.key);
    const player = state.players.find((p) => !p.isAI && !p.kickedAt && p.nameKey === normalized.key);
    if (!player?.password || !(await verifyPassword(password, player.password))) {
      this.recordLoginFailure(normalized.key);
      throw new Error("玩家名稱或人物密碼錯誤");
    }
    this.authFailures.delete(normalized.key);
    player.token = randomToken();
    this.closePlayerSockets(player.id, 4001, "Session rotated");
    this.touchAndSave(state);
    return { playerId: player.id, token: player.token, spectator: player.isSpectator };
  }

  async addAI(hostToken: string, name: string, ai: AIConfig): Promise<{ playerId: string }> {
    const state = this.requireState();
    this.assertHost(state, hostToken);
    this.assertLobby(state);
    const normalized = normalizePlayerName(name);
    if (state.players.some((p) => !p.kickedAt && p.nameKey === normalized.key)) throw new Error("玩家名稱已被使用");
    this.validateAIConfig(ai);
    const player = this.newAIPlayer(normalized.display, ai);
    state.players.push(player);
    state.roleSetup = state.settings.autoRoleSetup
      ? defaultRoleSetup(activePlayers(state.players).filter((p) => !p.kickedAt).length)
      : growRoleSetup(state.roleSetup);
    this.addSystemMessage(state, `AI 玩家 ${player.name} 加入房間（${ai.provider} / ${ai.model}）。API Key 不會寫入房間狀態。`);
    this.touchAndSave(state);
    this.broadcast(state);
    return { playerId: player.id };
  }

  async runAI(hostToken: string, playerId: string, apiKeys: string[]): Promise<{ ok: true }> {
    const before = this.requireState();
    this.assertHost(before, hostToken);
    const task = this.pendingAITask(before);
    if (!task || task.playerId !== playerId) throw new Error("此 AI 目前沒有待執行操作");
    const actor = before.players.find((p) => p.id === playerId && p.isAI && p.alive && !p.isSpectator);
    if (!actor?.role || !actor.ai) throw new Error("AI 玩家狀態無效");

    if (task.operation === "debate_speech") {
      const decision = await this.decideAIDebateTurn(before, actor, apiKeys);
      const state = this.requireState();
      this.assertFreshAITask(state, hostToken, playerId, "debate_speech");
      const current = state.players.find((p) => p.id === playerId)!;
      const dayAction = this.normalizeAIDayAction(state, current, decision.action);
      this.recordDebateSpeech(state, current, decision.message);
      if (dayAction) this.submitRoleActionInternal(state, current, dayAction.effect, dayAction.targetIds, dayAction.option);
      if (state.phase === "debate") {
        if (isDebateComplete(state.debateOrder, state.debateIndex)) this.enterVote(state);
        else this.saveBroadcast(state);
      }
      return { ok: true };
    }

    if (task.operation === "vote") {
      const targetId = await this.decideAIVote(before, actor, apiKeys);
      const state = this.requireState();
      this.assertFreshAITask(state, hostToken, playerId, "vote");
      this.castVoteById(state, playerId, targetId);
      return { ok: true };
    }

    const state = this.requireState();
    this.assertFreshAITask(state, hostToken, playerId, task.operation);
    const current = state.players.find((p) => p.id === playerId)!;
    if (this.participatesWolfVote(state, current) && !state.nightActions.wolfVotes[current.id]) {
      const targetId = await this.decideAITarget(before, actor, apiKeys, this.legalWolfTargets(before, actor));
      this.applyNightAction(state, current, { kind: "werewolf", targetId });
    } else {
      const prompt = roleActionPrompt(current, state);
      if (!prompt) throw new Error("AI 沒有可執行的角色技能");
      const targets = this.legalTargets(state, current, prompt.targetMode);
      const targetIds: string[] = [];
      if (targets.length) {
        const first = await this.decideAITarget(before, actor, apiKeys, targets);
        targetIds.push(first);
        if (String(prompt.targetMode).startsWith("two_")) {
          const second = targets.find((p) => p.id !== first);
          if (second) targetIds.push(second.id);
        }
      }
      this.submitRoleActionInternal(state, current, prompt.effect, targetIds, prompt.options?.[0]);
    }
    this.afterNightSubmission(state);
    return { ok: true };
  }

  async getStateByToken(token: string): Promise<PrivateView> {
    return this.projectState(this.requireState(), token);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const url = new URL(request.url);
    const token = url.searchParams.get("token") ?? "";
    const state = this.requireState();
    const player = state.players.find((p) => !p.kickedAt && secureEqual(p.token, token));
    if (!player) return new Response("Unauthorized", { status: 401 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: player.id, token: player.token } satisfies SocketAttachment);
    server.send(JSON.stringify({ type: "state", state: this.projectState(state, player.token) } satisfies ServerMessage));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return ws.close(1008, "Missing identity");
    try {
      const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
      await this.handleClientMessage(attachment.token, JSON.parse(raw) as ClientMessage);
    } catch (error) {
      ws.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "未知錯誤" } satisfies ServerMessage));
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> { ws.close(code, reason); }
  async webSocketError(ws: WebSocket): Promise<void> { ws.close(1011, "WebSocket error"); }

  private async handleClientMessage(token: string, command: ClientMessage): Promise<void> {
    switch (command.type) {
      case "start": return this.startGame(token);
      case "reset": return this.resetGame(token);
      case "set_password": return this.setPlayerPassword(token, command.password);
      case "chat": return this.sendChat(token, command.content, command.locale);
      case "configure_roles": return this.configureRoles(token, command.roles);
      case "configure_settings": return this.configureSettings(token, command.settings);
      case "kick": return this.kickPlayer(token, command.targetId);
      case "sheriff_candidate": return this.setSheriffCandidate(token, command.running);
      case "sheriff_vote": return this.castSheriffVote(token, command.targetId);
      case "debate_speech": return this.submitDebateSpeech(token, command.content, command.locale);
      case "vote": return this.castVote(token, command.targetId);
      case "night_action": return this.submitNightAction(token, command.action);
      case "role_action": return this.submitRoleAction(token, command.effect, command.targetIds ?? [], command.option);
      default: return assertNever(command);
    }
  }

  private async setPlayerPassword(token: string, password: string): Promise<void> {
    const state = this.requireState();
    const player = this.playerByToken(state, token);
    if (player.isAI) throw new Error("AI 玩家不使用人物密碼");
    if (player.password) throw new Error("人物密碼已設定；目前不提供免驗證改密碼");
    player.password = await createPasswordVerifier(password);
    this.addSystemMessage(state, `${player.name} 已完成舊房間人物密碼升級。`);
    this.saveBroadcast(state);
  }

  private startGame(token: string): void {
    const state = this.requireState();
    this.assertHost(state, token);
    this.assertLobby(state);
    const participants = activePlayers(state.players).filter((p) => !p.kickedAt);
    if (state.settings.autoRoleSetup) state.roleSetup = defaultRoleSetup(participants.length);
    const error = validateRoleSetup(state.roleSetup, participants.length);
    if (error) throw new Error(error);
    state.players = assignRoles(state.players, state.roleSetup);
    state.initialPlayerCount = participants.length;
    state.round = 0;
    state.votes = {};
    state.nightActions = freshNightActions();
    state.roleMemory = {};
    state.seerResults = {};
    state.roleResults = {};
    state.deathReasons = {};
    state.witchHealAvailable = true;
    state.witchPoisonAvailable = true;
    state.guardLastTargets = {};
    state.debateOrder = [];
    state.debateIndex = 0;
    state.debateCompleted = [];
    state.lastNightDeaths = [];
    delete state.lastVoteEliminated;
    delete state.winner;
    delete state.winnerPlayerIds;
    delete state.winnerLabel;
    delete state.pendingReaction;
    this.initializeRoleMemories(state);
    this.addSystemMessage(state, "身份已由伺服器安全洗牌分配。遊戲只採辯論式，不含暴民/PvP 追殺機制。");
    if (state.settings.sheriffEnabled) this.beginSheriffElection(state);
    else this.enterNight(state, 1);
  }

  private resetGame(token: string): void {
    const state = this.requireState();
    this.assertHost(state, token);
    if (state.phase !== "ended" && state.phase !== "lobby") throw new Error("只有大廳或遊戲結束後可以重開下一局");
    for (const player of state.players) {
      if (player.kickedAt) continue;
      player.isSpectator = false;
      player.alive = true;
      delete player.role;
      delete player.factionOverride;
    }
    state.phase = "lobby";
    state.round = 0;
    state.roleSetup = defaultRoleSetup(activePlayers(state.players).filter((p) => !p.kickedAt).length);
    state.settings = { ...state.settings };
    state.sheriff = { enabled: state.settings.sheriffEnabled, electionRound: 0, candidates: [], votes: {}, successors: [] };
    state.votes = {};
    state.nightActions = freshNightActions();
    state.roleMemory = {};
    state.seerResults = {};
    state.roleResults = {};
    state.deathReasons = {};
    state.debateOrder = [];
    state.debateIndex = 0;
    state.debateCompleted = [];
    state.lastNightDeaths = [];
    delete state.winner;
    delete state.winnerPlayerIds;
    delete state.winnerLabel;
    delete state.pendingReaction;
    this.addSystemMessage(state, "已回到大廳；上一局觀戰者已轉為下一局正式玩家。請重新設定角色配置。 ");
    this.saveBroadcast(state);
  }

  private configureRoles(token: string, raw: RoleSetup): void {
    const state = this.requireState();
    this.assertHost(state, token);
    this.assertLobby(state);
    if (state.settings.autoRoleSetup) throw new Error("自動配置角色已啟用；請先取消勾選再手動調整角色");
    const roles = this.normalizeRoleSetup(raw);
    const error = validateRoleSetup(roles, activePlayers(state.players).filter((p) => !p.kickedAt).length);
    if (error && !error.startsWith("角色總數")) throw new Error(error);
    state.roleSetup = roles;
    this.saveBroadcast(state);
  }

  private configureSettings(token: string, raw: Partial<GameSettings>): void {
    const state = this.requireState();
    this.assertHost(state, token);
    this.assertLobby(state);
    if (typeof raw.sheriffEnabled === "boolean") state.settings.sheriffEnabled = raw.sheriffEnabled;
    if (raw.deathInfo && ["hidden", "names", "full"].includes(raw.deathInfo)) state.settings.deathInfo = raw.deathInfo;
    if (raw.tieRule && ["no_elimination", "revote", "pk_revote"].includes(raw.tieRule)) state.settings.tieRule = raw.tieRule;
    if (typeof raw.autoRoleSetup === "boolean") {
      state.settings.autoRoleSetup = raw.autoRoleSetup;
      if (raw.autoRoleSetup) state.roleSetup = defaultRoleSetup(activePlayers(state.players).filter((p) => !p.kickedAt).length);
    }
    this.saveBroadcast(state);
  }

  private kickPlayer(token: string, targetId: string): void {
    const state = this.requireState();
    this.assertHost(state, token);
    const target = state.players.find((p) => p.id === targetId && !p.kickedAt);
    if (!target) throw new Error("找不到要踢出的玩家");
    if (target.id === state.hostPlayerId) throw new Error("房主不能踢出自己");
    const oldName = target.name;
    this.closePlayerSockets(target.id, 4003, "Kicked by host");
    target.token = randomToken();
    target.kickedAt = Date.now();
    target.nameKey = `__kicked__:${target.id}`;
    target.name = `${oldName}（已踢出）`;
    if (state.phase === "lobby") {
      state.players = state.players.filter((p) => p.id !== target.id);
      state.roleSetup = state.settings.autoRoleSetup
        ? defaultRoleSetup(activePlayers(state.players).filter((p) => !p.kickedAt).length)
        : this.resizeRoleSetupAfterLeave(state.roleSetup);
    } else {
      target.alive = false;
      target.isSpectator = true;
    }
    this.addSystemMessage(state, `${oldName} 已被房主踢出；這不是永久封鎖，可重新建立人物加入。`);
    this.checkAndMaybeEnd(state);
    this.saveBroadcast(state);
  }

  private sendChat(token: string, content: string, locale?: AppLocale): void {
    const state = this.requireState();
    const actor = this.playerByToken(state, token);
    if (state.phase === "night") throw new Error("夜晚為秘密行動階段，公開聊天室暫停");
    if (actor.isSpectator && state.phase !== "lobby" && state.phase !== "ended") throw new Error("觀戰者在進行中的對局不能向存活玩家發言");
    state.messages.push(this.chatMessage(state, actor, this.normalizeChat(content), this.normalizeMessageLocale(locale)));
    this.trimMessages(state);
    this.saveBroadcast(state);
  }

  private beginSheriffElection(state: GameState): void {
    state.phase = "sheriff";
    state.sheriff = {
      enabled: true,
      electionRound: 1,
      candidates: livingPlayers(state.players).map((p) => p.id),
      votes: {},
      successors: []
    };
    this.addSystemMessage(state, "進入警長選舉。預設所有正式玩家都是候選人；玩家可退出候選，所有人投票後結算。平票會重選一次，再平票則本局無警長。 ");
    this.saveBroadcast(state);
  }

  private setSheriffCandidate(token: string, running: boolean): void {
    const state = this.requireState();
    if (state.phase !== "sheriff") throw new Error("目前不是警長選舉階段");
    const actor = this.playerByToken(state, token);
    if (actor.isSpectator || !actor.alive) throw new Error("觀戰者不能參選警長");
    state.sheriff.candidates = state.sheriff.candidates.filter((id) => id !== actor.id);
    if (running) state.sheriff.candidates.push(actor.id);
    delete state.sheriff.votes[actor.id];
    this.saveBroadcast(state);
  }

  private castSheriffVote(token: string, targetId: string): void {
    const state = this.requireState();
    if (state.phase !== "sheriff") throw new Error("目前不是警長選舉階段");
    const voter = this.playerByToken(state, token);
    if (voter.isSpectator || !voter.alive) throw new Error("觀戰者不能投警長票");
    if (!state.sheriff.candidates.includes(targetId)) throw new Error("該玩家不是警長候選人");
    state.sheriff.votes[voter.id] = targetId;
    if (livingPlayers(state.players).every((p) => Boolean(state.sheriff.votes[p.id]))) this.finishSheriffElection(state);
    else this.saveBroadcast(state);
  }

  private finishSheriffElection(state: GameState): void {
    const counts: Record<string, number> = {};
    for (const target of Object.values(state.sheriff.votes)) counts[target] = (counts[target] ?? 0) + 1;
    const ordered = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const top = ordered[0];
    const tied = top ? ordered.filter(([, count]) => count === top[1]).map(([id]) => id) : [];
    if (tied.length === 1) {
      state.sheriff.sheriffId = tied[0]!;
      state.sheriff.successors = ordered.slice(1).map(([id]) => id);
      this.addSystemMessage(state, `${this.nameOf(state, tied[0]!)} 當選警長。`);
      this.enterNight(state, 1);
      return;
    }
    if (state.sheriff.electionRound < 2 && tied.length > 1) {
      state.sheriff.electionRound = 2;
      state.sheriff.candidates = tied;
      state.sheriff.votes = {};
      this.addSystemMessage(state, "警長第一輪最高票平手，僅平票候選人進入第二輪重選。 ");
      this.saveBroadcast(state);
      return;
    }
    delete state.sheriff.sheriffId;
    state.sheriff.successors = [];
    this.addSystemMessage(state, "警長重選仍平票，本局不設警長。 ");
    this.enterNight(state, 1);
  }

  private enterNight(state: GameState, round: number): void {
    state.phase = "night";
    state.round = round;
    state.votes = {};
    state.nightActions = freshNightActions();
    state.debateOrder = [];
    state.debateIndex = 0;
    state.debateCompleted = [];
    state.lastNightDeaths = [];
    this.addSystemMessage(state, `第 ${round} 夜開始。公開聊天暫停，所有技能由伺服器依固定結算順序處理。`);
    this.saveBroadcast(state);
    if (areNightActionsComplete(state)) this.finishNight(state);
  }

  private submitNightAction(token: string, action: NightClientAction): void {
    const state = this.requireState();
    if (state.phase !== "night") throw new Error("目前不是夜晚階段");
    const actor = this.playerByToken(state, token);
    if (!actor.alive || actor.isSpectator || !actor.role) throw new Error("目前不能執行夜晚技能");
    if (actor.isAI) throw new Error("AI 玩家由房主透過 BYOK 執行");
    this.applyNightAction(state, actor, action);
    this.afterNightSubmission(state);
  }

  private applyNightAction(state: GameState, actor: Player, action: NightClientAction): void {
    if (action.kind === "werewolf") {
      if (playerFaction(actor) !== "werewolf") throw new Error("你的身份不能參與狼刀");
      if (actor.role === "sun_wolf" || actor.role === "sniper_eight_wolf") throw new Error("你的狼人變體不參與普通夜刀");
      if (actor.role === "lurking_wolf" && this.mem(state, actor.id).awake !== true) throw new Error("潛伏狼尚未解除潛伏，不能參與普通夜刀");
      if (actor.role === "young_wolf" && state.round <= 3) throw new Error("幼狼前三輪不能參與狼刀");
      const target = state.players.find((p) => p.id === action.targetId && p.alive && !p.isSpectator);
      if (!target || target.id === actor.id || playerFaction(target) === "werewolf") throw new Error("狼人目標無效");
      state.nightActions.wolfVotes[actor.id] = target.id;
      return;
    }
    if (action.kind === "seer") {
      if (actor.role !== "seer") throw new Error("你的身份不能使用預言家查驗");
      const target = this.requireAliveOther(state, actor, action.targetId);
      state.nightActions.seerTargets[actor.id] = target.id;
      return;
    }
    if (action.kind === "guard") {
      if (actor.role !== "guard") throw new Error("你的身份不能守護");
      const target = state.players.find((p) => p.id === action.targetId && p.alive && !p.isSpectator);
      if (!target || !canGuardTarget(state.guardLastTargets[actor.id], target.id)) throw new Error("守衛不能連續兩晚守護同一人");
      state.nightActions.guardTargets[actor.id] = target.id;
      return;
    }
    if (actor.role !== "witch") throw new Error("你的身份不能使用女巫技能");
    this.validateWitchAction(state, actor, action.action);
    state.nightActions.witchActions[actor.id] = action.action;
  }

  private submitRoleAction(token: string, effect: RoleActionEffect, targetIds: string[], option?: string): void {
    const state = this.requireState();
    const actor = this.playerByToken(state, token);
    if (actor.isAI) throw new Error("AI 玩家由房主透過 BYOK 執行");
    this.submitRoleActionInternal(state, actor, effect, targetIds, option);
    if (state.phase === "night") this.afterNightSubmission(state);
    else this.saveBroadcast(state);
  }

  private submitRoleActionInternal(state: GameState, actor: Player, effect: RoleActionEffect, targetIds: string[], option?: string): void {
    const prompt = roleActionPrompt(actor, state);
    if (!prompt || prompt.effect !== effect) throw new Error("目前沒有這個角色技能可用");
    if (prompt.timing === "night" && prompt.oncePerGame && option === "__pass__") {
      state.nightActions.roleActions[actor.id] = { effect, targetIds: [], option, submittedAt: Date.now() };
      return;
    }
    this.validateTargetCount(prompt.targetMode, targetIds);
    const legal = new Set(this.legalTargets(state, actor, prompt.targetMode).map((p) => p.id));
    for (const id of targetIds) if (!legal.has(id)) throw new Error("技能目標無效");
    if (prompt.options && (!option || !prompt.options.includes(option))) throw new Error("技能選項無效");
    const submission: RoleActionSubmission = { effect, targetIds: [...targetIds], ...(option ? { option } : {}), submittedAt: Date.now() };
    if (prompt.timing === "night") state.nightActions.roleActions[actor.id] = submission;
    else this.resolveImmediateRoleAction(state, actor, submission);
    if (prompt.oncePerGame) this.mem(state, actor.id)[`used:${effect}`] = true;
  }

  private afterNightSubmission(state: GameState): void {
    this.touchAndSave(state);
    this.broadcast(state);
    if (areNightActionsComplete(state)) this.finishNight(state);
  }

  private finishNight(state: GameState): void {
    for (const [seerId, targetId] of Object.entries(state.nightActions.seerTargets)) {
      const seer = state.players.find((p) => p.id === seerId && p.alive);
      const target = state.players.find((p) => p.id === targetId && p.alive);
      if (!seer || !target || this.isActionDisabled(state, seer.id)) continue;
      if (target.role === "demon_wolf" && this.mem(state, target.id).retaliationUsed !== true) {
        this.mem(state, target.id).retaliationUsed = true;
        this.killPlayer(state, seer.id, "demon_wolf_retaliation", target.id, true);
        continue;
      }
      this.storeTeamResult(state, seer, target);
      this.resolveSpiritInspection(state, seer, target);
    }
    this.resolveNightRoleActions(state);
    if (state.winner) return this.endGame(state, state.winner);
    const wolfTarget = this.wolfTarget(state);
    const guardTargets = new Set(Object.values(state.nightActions.guardTargets));
    let actualWolfTarget = wolfTarget;
    let wolfKillLanded = false;
    const redirected = this.systemMem(state).redirectWolfKill;
    if (typeof redirected === "string") actualWolfTarget = redirected;
    if (actualWolfTarget) {
      const target = state.players.find((p) => p.id === actualWolfTarget);
      if (target) {
        const healed = Object.values(state.nightActions.witchActions).some((a) => a.type === "heal") && state.witchHealAvailable;
        const isProtected = guardTargets.has(target.id) || this.isNightProtected(state, target.id);
        if (healed) {
          state.witchHealAvailable = false;
          for (const medicine of livingPlayers(state.players).filter((p) => p.role === "medicine_wolf")) this.storeRoleResult(state, medicine, target, `本晚狼刀目標 ${target.name} 被解藥救下`);
        }
        if (!healed && !isProtected) wolfKillLanded = this.killPlayer(state, target.id, "wolf", this.firstLivingWolfId(state));
      }
    }
    for (const action of Object.values(state.nightActions.witchActions)) {
      if (action.type === "poison" && state.witchPoisonAvailable) {
        this.killPlayer(state, action.targetId, "poison");
        state.witchPoisonAvailable = false;
      }
    }
    if (wolfKillLanded) {
      for (const wolf of livingPlayers(state.players).filter((p) => p.role === "berserker_wolf")) this.mem(state, wolf.id).voteBonus = Number(this.mem(state, wolf.id).voteBonus ?? 0) + 1;
      for (const wolf of livingPlayers(state.players).filter((p) => p.role === "vampire_wolf")) {
        const memory = this.mem(state, wolf.id);
        const charge = Number(memory.wolfKillCharge ?? 0) + 1;
        memory.wolfKillCharge = charge;
        if (charge >= 2 && memory.vampireShield !== 1) { memory.vampireShield = 1; memory.wolfKillCharge = 0; }
      }
    }
    for (const [guardId, targetId] of Object.entries(state.nightActions.guardTargets)) state.guardLastTargets[guardId] = targetId;
    this.applyEndOfNightStatuses(state);
    const wolfVictim = actualWolfTarget ? state.players.find((p) => p.id === actualWolfTarget && !p.alive) : undefined;
    if (wolfVictim?.role) {
      for (const keeper of livingPlayers(state.players).filter((p) => p.role === "gravekeeper")) this.storeRoleResult(state, keeper, wolfVictim, `上一夜狼刀死者職業：${roleDefinition(wolfVictim.role).name}`);
    }
    state.lastNightDeaths = Object.entries(state.deathReasons)
      .filter(([id, reason]) => !this.mem(state, id)[`announced:${state.round}`] && reason.startsWith(`r${state.round}:`))
      .map(([id]) => id);
    for (const id of state.lastNightDeaths) this.mem(state, id)[`announced:${state.round}`] = true;

    const deathText = this.formatNightDeaths(state);
    this.addSystemMessage(state, deathText);
    state.nightActions = freshNightActions();
    state.votes = {};
    if (state.pendingReaction) {
      state.phase = "reaction";
      this.saveBroadcast(state);
      return;
    }
    const winner = checkWinner(state.players);
    if (winner) return this.endGame(state, winner);
    this.beginDebate(state);
  }

  private resolveNightRoleActions(state: GameState): void {
    const submissions = Object.entries(state.nightActions.roleActions);
    const orderedEffects: RoleActionEffect[] = [
      "disable_current_action", "disable_next_action", "disable_permanently", "hide_inspection_result", "redirect_wolf_kill",
      "protect", "set_permanent_guard", "set_dreamwalker", "yin_yang_bless", "set_scapegoat", "set_bodyguard",
      "inspect_team", "inspect_true_role", "inspect_action", "inspect_pair_for_wolf", "priest_check", "angel_check", "devil_check", "wolf_cop_check",
      "disguise_as_target", "copy_ability_and_block", "copy_dead_role", "steal_role_delayed", "charm_target", "link_lovers", "add_curse_stack",
      "visit_target", "observe_and_redirect", "redirect_targeted_action", "curse_caster_mark", "reroll_same_faction_role", "mark_for_reply",
      "trap_next_vote", "raven_vote_curse", "mark_convert_on_death", "mark_chain_kill_village", "pollen_block", "dose_target",
      "convert_to_werewolf_if_last", "kill_if_no_wolves", "hunt_non_village", "strong_kill", "piercing_poison", "kill_target", "kill_if_hive_dead", "kill_if_targeted_by_other", "cooldown_kill",
      "freeze_or_detonate", "necromancer_milestone", "warlock_choice", "spend_stacks_to_disable", "fake_kill", "sacrifice_revive",
      "magician_swap", "burglar_steal", "identify_partner", "alchemist_sequence", "awaken_if_wolf_dead", "infect_blood", "choose_allegiance"
    ];
    for (const effect of orderedEffects) {
      for (const [actorId, action] of submissions) {
        if (action.effect !== effect || action.option === "__pass__") continue;
        const actor = state.players.find((p) => p.id === actorId && p.alive && !p.isSpectator);
        if (!actor || this.isActionDisabled(state, actorId)) continue;
        this.resolveNightRoleAction(state, actor, action);
      }
    }
  }

  private resolveNightRoleAction(state: GameState, actor: Player, action: RoleActionSubmission): void {
    const am = this.mem(state, actor.id);
    const redirectTo = am.redirectNextActionTo;
    const effectiveTargetIds = [...action.targetIds];
    if (typeof redirectTo === "string" && effectiveTargetIds.length > 0) {
      const redirected = state.players.find((p) => p.id === redirectTo && p.alive && !p.isSpectator);
      if (redirected) effectiveTargetIds[0] = redirected.id;
      delete am.redirectNextActionTo;
    }
    const target = effectiveTargetIds[0] ? state.players.find((p) => p.id === effectiveTargetIds[0]) : undefined;
    const second = effectiveTargetIds[1] ? state.players.find((p) => p.id === effectiveTargetIds[1]) : undefined;
    const tm = target ? this.mem(state, target.id) : undefined;
    if (target?.role === "demon_wolf" && playerFaction(actor) === "village" && this.mem(state, target.id).retaliationUsed !== true) {
      this.mem(state, target.id).retaliationUsed = true;
      this.killPlayer(state, actor.id, "demon_wolf_retaliation", target.id, true);
      return;
    }
    switch (action.effect) {
      case "inspect_team": if (target) this.storeTeamResult(state, actor, target); break;
      case "inspect_true_role": if (target?.role) this.storeRoleResult(state, actor, target, target.role); break;
      case "inspect_action": if (target) this.storeRoleResult(state, actor, target, state.nightActions.roleActions[target.id]?.effect ?? (state.nightActions.wolfVotes[target.id] ? "wolf_kill" : "無主動技能")); break;
      case "inspect_pair_for_wolf": {
        const hasWolf = [target, second].some((p) => p && playerFaction(p) === "werewolf");
        if (target && second) this.storeRoleResult(state, actor, target, `${target.name}、${second.name} 中${hasWolf ? "至少有一名狼人" : "沒有狼人"}`);
        break;
      }
      case "priest_check": if (target) { if (target.role === "vampire_wolf_copy") { this.killPlayer(state, target.id, "priest", actor.id); am.deathShield = 1; } else this.storeRoleResult(state, actor, target, "不是吸血狼"); } break;
      case "angel_check": if (target?.role) { this.storeRoleResult(state, actor, target, target.role); if (state.round >= 2 && playerFaction(target) === "werewolf") this.killPlayer(state, target.id, "angel", actor.id); } break;
      case "devil_check": if (target?.role) { this.storeRoleResult(state, actor, target, target.role); if (state.round >= 2 && target.role === "angel") this.killPlayer(state, target.id, "devil", actor.id); } break;
      case "wolf_cop_check": if (target) { const match = target.role === "fraudster" || target.role === "traitor_wolf"; this.storeRoleResult(state, actor, target, match ? "查到偽狼／叛狼" : "不是偽狼／叛狼"); if (!match) this.killPlayer(state, actor.id, "wolf_cop_backfire"); } break;
      case "disable_current_action": if (target) this.mem(state, target.id).disabledUntilRound = state.round; break;
      case "disable_next_action": if (target) this.mem(state, target.id).disabledUntilRound = state.round + 1; break;
      case "disable_permanently": if (target) this.mem(state, target.id).disabledPermanently = true; break;
      case "hide_inspection_result": if (target) this.mem(state, target.id).inspectionHiddenRound = state.round; break;
      case "redirect_wolf_kill": if (target) this.systemMem(state).redirectWolfKill = target.id; break;
      case "set_scapegoat": if (target) am.scapegoat = target.id; break;
      case "set_bodyguard": if (target) am.bodyguard = target.id; break;
      case "set_dreamwalker": if (target) { am.dreamwalker = target.id; this.mem(state, target.id).nightProtectedRound = state.round; } break;
      case "yin_yang_bless": if (target) this.mem(state, target.id)[action.option === "day" ? "dayBlessing" : "nightBlessing"] = true; break;
      case "set_permanent_guard": if (target) am.permanentGuard = target.id; break;
      case "disguise_as_target": if (target) am.disguiseTarget = target.id; break;
      case "copy_ability_and_block": if (target?.role) { am.copiedRole = target.role; if (tm) tm.disabledUntilRound = state.round + 1; } break;
      case "copy_dead_role": if (target?.role && !target.alive) actor.role = target.role; break;
      case "steal_role_delayed": if (target?.role) { am.stealRole = target.role; am.stealTarget = target.id; } break;
      case "charm_target": if (target) am.charmed = target.id; break;
      case "link_lovers": if (target && second) { this.mem(state, target.id).lover = second.id; this.mem(state, second.id).lover = target.id; } break;
      case "visit_target": if (target) {
        const visited = this.asStringArray(am.visitedTargets);
        if (!visited.includes(target.id)) visited.push(target.id);
        am.visitedTargets = visited;
        const required = Math.max(1, activePlayers(state.players).length - 1);
        if (visited.length >= required) { state.winner = "neutral"; state.winnerPlayerIds = [actor.id]; state.winnerLabel = `${actor.name}（色狼）完成所有其他正式玩家的秘密造訪，達成個人特殊勝利`; }
      } break;
      case "observe_and_redirect": if (target) { const seen = state.nightActions.roleActions[target.id]?.effect ?? (state.nightActions.wolfVotes[target.id] ? "wolf_kill" : "無主動技能"); this.storeRoleResult(state, actor, target, `觀察到：${seen}`); this.mem(state, target.id).redirectNextActionTo = actor.id; } break;
      case "redirect_targeted_action": if (target) this.mem(state, target.id).redirectNextActionTo = actor.id; break;
      case "curse_caster_mark": if (target) { if (action.option === "substitute") am.curseSubstitute = target.id; else this.mem(state, target.id).disabledUntilRound = state.round + 1; } break;
      case "reroll_same_faction_role": if (target?.role) { const faction = playerFaction(target); const pool = ROLE_LIST.filter((def) => def.faction === faction && def.id !== target.role); if (pool.length) target.role = secureShuffle(pool)[0]!.id; } break;
      case "mark_for_reply": if (target) am.replyTarget = target.id; break;
      case "add_curse_stack": if (target) { const stacks = Number(tm?.curseStacks ?? 0) + 1; if (tm) tm.curseStacks = stacks; if (stacks >= 3) this.killPlayer(state, target.id, "voodoo", actor.id); } break;
      case "trap_next_vote": if (target) this.mem(state, target.id).trappedVoteRound = state.round; break;
      case "raven_vote_curse": if (target) am.ravenVote = target.id; break;
      case "mark_convert_on_death": if (target) am.convertOnDeath = target.id; break;
      case "mark_chain_kill_village": if (target) am.chainKillMark = target.id; break;
      case "pollen_block": if (target) { if (tm) tm.disabledUntilRound = state.round + 1; am.pollenTarget = target.id; } break;
      case "dose_target": if (target) { const doses = Number(tm?.pharmacyDoses ?? 0) + 1; if (tm) tm.pharmacyDoses = doses; if (doses === 1) tm!.nightProtectedRound = state.round; else this.killPlayer(state, target.id, "pharmacist", actor.id); } break;
      case "convert_to_werewolf_if_last": if (target) { const wolves = livingPlayers(state.players).filter((p) => playerFaction(p) === "werewolf"); if (wolves.length === 1 && wolves[0]!.id === actor.id) { target.role = "werewolf"; target.factionOverride = "werewolf"; } } break;
      case "kill_if_no_wolves": if (target) { const otherWolves = livingPlayers(state.players).filter((p) => playerFaction(p) === "werewolf" && p.id !== actor.id); if (otherWolves.length === 0) this.killPlayer(state, target.id, "red_axe", actor.id, true); } break;
      case "hunt_non_village": if (target) { if (playerFaction(target) === "village") this.killPlayer(state, actor.id, "hunt_backfire"); else this.killPlayer(state, target.id, "hunt", actor.id); } break;
      case "strong_kill": if (target) this.killPlayer(state, target.id, "strong_kill", actor.id, true); break;
      case "piercing_poison": if (target) this.killPlayer(state, target.id, "wolf_witch_poison", actor.id, true); break;
      case "kill_target": if (target) this.killPlayer(state, target.id, "role_kill", actor.id); break;
      case "kill_if_hive_dead": if (target && state.players.some((p) => p.role === "hive" && !p.alive)) this.killPlayer(state, target.id, "bee", actor.id); break;
      case "kill_if_targeted_by_other": if (target && this.wasTargetedByOther(state, target.id, actor.id)) this.killPlayer(state, target.id, "shadow_wolf", actor.id); break;
      case "cooldown_kill": if (target && state.round % 2 === 0) this.killPlayer(state, target.id, "sniper_wolf", actor.id); break;
      case "freeze_or_detonate": if (action.option === "detonate") this.detonateFrozen(state, actor); else if (target) { const frozen = this.asStringArray(am.frozenTargets); if (!frozen.includes(target.id)) frozen.push(target.id); am.frozenTargets = frozen; this.mem(state, target.id).frozenBy = actor.id; } break;
      case "necromancer_milestone": this.resolveNecromancer(state, actor, target); break;
      case "warlock_choice": if (action.option === "poison" && target && am.warlockPoisonUsed !== true) { this.killPlayer(state, target.id, "warlock_poison", actor.id); am.warlockPoisonUsed = true; } else if (action.option === "nullify" && target && am.warlockNullifyUsed !== true) { this.mem(state, target.id).disabledUntilRound = state.round; am.warlockNullifyUsed = true; } break;
      case "spend_stacks_to_disable": if (target) { this.mem(state, target.id).disabledUntilRound = state.round + 1; am.vomitStacks = 0; } break;
      case "fake_kill": if (target) { this.killPlayer(state, target.id, "fake_kill", actor.id, true); this.mem(state, target.id).reviveRound = state.round + 1; } break;
      case "sacrifice_revive": if (target && !target.alive) { this.killPlayer(state, actor.id, "sacrifice", actor.id, true); target.alive = true; delete state.deathReasons[target.id]; } break;
      case "magician_swap": if (target && second) this.magicianSwap(state, target, second); break;
      case "burglar_steal": if (target?.role) { actor.role = target.role; if (playerFaction(target) === "werewolf") this.killPlayer(state, target.id, "burglar", actor.id); else target.role = "villager"; } break;
      case "identify_partner": if (target) { if (target.role !== "fist_brother") this.killPlayer(state, actor.id, "wrong_fist", actor.id, true); } break;
      case "alchemist_sequence": this.resolveAlchemist(state, actor, target); break;
      case "awaken_if_wolf_dead": if (target && state.players.some((p) => playerFaction(p) === "werewolf" && p.id !== actor.id && !p.alive)) { this.killPlayer(state, target.id, "blood_sacrifice", actor.id, true); am.awake = true; } break;
      case "infect_blood": if (target) target.factionOverride = "blood"; break;
      case "choose_allegiance": if (action.option && ["village", "werewolf", "spirit"].includes(action.option)) actor.factionOverride = action.option as Faction; break;
      default: break;
    }
  }

  private resolveImmediateRoleAction(state: GameState, actor: Player, action: RoleActionSubmission): void {
    const target = action.targetIds[0] ? state.players.find((p) => p.id === action.targetIds[0] && p.alive) : undefined;
    const second = action.targetIds[1] ? state.players.find((p) => p.id === action.targetIds[1] && p.alive) : undefined;
    switch (action.effect) {
      case "self_destruct_kill":
        if (!target) throw new Error("需要指定帶走目標");
        this.killPlayer(state, actor.id, "self_destruct", actor.id, true);
        this.killPlayer(state, target.id, "white_wolf_king", actor.id, true);
        this.checkAndMaybeEnd(state); if (!state.winner) this.enterNight(state, Math.max(1, state.round + (state.round ? 1 : 0))); return;
      case "blood_moon":
        this.killPlayer(state, actor.id, "blood_moon", actor.id, true);
        this.systemMem(state).goodSkillsDisabledRound = Math.max(1, state.round + 1);
        this.checkAndMaybeEnd(state); if (!state.winner) this.enterNight(state, Math.max(1, state.round + (state.round ? 1 : 0))); return;
      case "duel":
        if (!target) throw new Error("需要決鬥目標");
        if (playerFaction(target) === "werewolf") { this.killPlayer(state, target.id, "knight_duel", actor.id, true); this.checkAndMaybeEnd(state); if (!state.winner) this.enterNight(state, state.round + 1); }
        else { this.killPlayer(state, actor.id, "knight_duel_backfire", actor.id, true); this.checkAndMaybeEnd(state); }
        return;
      case "plant_bomb": if (target) this.mem(state, target.id).bombHolder = target.id; break;
      case "sniper_two_kills": if (target) this.killPlayer(state, target.id, "sniper", actor.id, true); if (second) this.killPlayer(state, second.id, "sniper", actor.id, true); break;
      case "public_reveal_role": if (target?.role) this.addSystemMessage(state, `偵查兵公開：${target.name} 的真實職業是 ${roleDefinition(target.role).name}。`); break;
      case "force_exile": if (target) { this.killPlayer(state, target.id, "judge", actor.id, true); this.checkAndMaybeEnd(state); if (!state.winner) this.enterNight(state, state.round + 1); return; }
      case "day_assassinate": if (target) this.killPlayer(state, target.id, "sun_wolf", actor.id, true); break;
      case "redirect_votes_from_self": if (target) { for (const [voter, voted] of Object.entries(state.votes)) if (voted === actor.id) state.votes[voter] = target.id; } break;
      case "suicide_bomb": this.killPlayer(state, actor.id, "suicide_bomber", actor.id, true); if (target) this.killPlayer(state, target.id, "suicide_bomber", actor.id, true); if (second) this.killPlayer(state, second.id, "suicide_bomber", actor.id, true); break;
      case "appoint_sheriff": if (target && state.phase === "sheriff") { state.sheriff.sheriffId = target.id; state.sheriff.successors = []; this.addSystemMessage(state, `村長指定 ${target.name} 為警長。`); this.enterNight(state, 1); return; } break;
      case "death_shot": if (target && state.pendingReaction?.actorId === actor.id) {
        const resume = state.pendingReaction.resumePhase;
        this.killPlayer(state, target.id, "death_shot", actor.id, true);
        delete state.pendingReaction;
        this.checkAndMaybeEnd(state);
        if (state.winner) return;
        if (this.popDeathReaction(state)) { this.saveBroadcast(state); return; }
        if (resume === "night") this.enterNight(state, state.round + 1);
        else if (resume === "vote") this.enterVote(state);
        else this.beginDebate(state);
        return;
      } break;
      case "redirect_exile": if (target && state.pendingReaction?.actorId === actor.id) {
        const resume = state.pendingReaction.resumePhase;
        this.killPlayer(state, target.id, "redirected_exile", actor.id, true);
        delete state.pendingReaction;
        this.checkAndMaybeEnd(state);
        if (state.winner) return;
        if (this.popDeathReaction(state)) { this.saveBroadcast(state); return; }
        if (resume === "debate") this.beginDebate(state); else this.enterNight(state, state.round + 1);
        return;
      } break;
      default: break;
    }
    this.checkAndMaybeEnd(state);
  }

  private beginDebate(state: GameState): void {
    state.phase = "debate";
    state.debateOrder = createDebateOrder(state.players);
    state.debateIndex = 0;
    state.debateCompleted = [];
    this.addSystemMessage(state, `第 ${state.round} 天進入正式辯論。所有需要發言的存活玩家完成一輪後才開放投票。`);
    this.saveBroadcast(state);
    if (state.debateOrder.length === 0) this.enterVote(state);
  }

  private submitDebateSpeech(token: string, content: string, locale?: AppLocale): void {
    const state = this.requireState();
    if (state.phase !== "debate") throw new Error("目前不是正式辯論階段");
    const actor = this.playerByToken(state, token);
    if (!actor.alive || actor.isSpectator) throw new Error("目前不能參與正式辯論");
    if (currentDebaterId(state.debateOrder, state.debateIndex) !== actor.id) throw new Error("尚未輪到你正式發言");
    if (actor.isAI) throw new Error("AI 玩家由房主透過 BYOK 執行");
    this.recordDebateSpeech(state, actor, this.normalizeSpeech(content), this.normalizeMessageLocale(locale));
    if (isDebateComplete(state.debateOrder, state.debateIndex)) this.enterVote(state);
    else this.saveBroadcast(state);
  }

  private recordDebateSpeech(state: GameState, actor: Player, text: string, locale: AppLocale = "zh-TW"): void {
    state.messages.push(this.speechMessage(state, actor, text, locale));
    state.debateCompleted.push(actor.id);
    const respondingNobles = livingPlayers(state.players).filter((p) => p.role === "noble" && this.mem(state, p.id).replyTarget === actor.id);
    for (const noble of respondingNobles) {
      delete this.mem(state, noble.id).replyTarget;
      state.debateOrder.splice(state.debateIndex + 1, 0, noble.id);
      this.addSystemMessage(state, `${noble.name}（貴族）取得對 ${actor.name} 的追加正式回應權。`);
    }
    state.debateIndex += 1;
    this.trimMessages(state);
  }

  private enterVote(state: GameState): void {
    state.phase = "vote";
    state.votes = {};
    this.addSystemMessage(state, "正式發言完成，現在開放放逐投票。聊天室不能提前取代正式辯論 Gate。 ");
    this.saveBroadcast(state);
  }

  private castVote(token: string, targetId: string): void {
    const state = this.requireState();
    const voter = this.playerByToken(state, token);
    if (voter.isAI) throw new Error("AI 玩家由房主透過 BYOK 執行");
    this.castVoteById(state, voter.id, targetId);
  }

  private castVoteById(state: GameState, voterId: string, targetId: string): void {
    if (state.phase !== "vote") throw new Error("目前不是放逐投票階段");
    const voter = state.players.find((p) => p.id === voterId && p.alive && !p.isSpectator);
    const target = state.players.find((p) => p.id === targetId && p.alive && !p.isSpectator);
    if (!voter || !target) throw new Error("投票玩家或目標無效");
    const pkCandidates = this.asStringArray(this.systemMem(state).pkVoteCandidates);
    if (pkCandidates.length > 0 && !pkCandidates.includes(target.id)) throw new Error("PK 重投只能投給平票候選人");
    if (voter.id === target.id) throw new Error("不能投給自己");
    state.votes[voter.id] = target.id;
    const voterMemory = this.mem(state, voter.id);
    if (voterMemory.bombHolder === voter.id) {
      delete voterMemory.bombHolder;
      this.mem(state, target.id).bombHolder = target.id;
      this.addSystemMessage(state, `炸彈在投票時被傳遞；目前持有者不公開。`);
    }
    if (areVotesComplete(state)) this.finishVote(state);
    else this.saveBroadcast(state);
  }

  private finishVote(state: GameState): void {
    for (const player of livingPlayers(state.players)) {
      if (this.mem(state, player.id).trappedVoteRound === state.round && state.votes[player.id]) this.killPlayer(state, player.id, "trapper", undefined, true);
      if (player.role === "ferry_spirit" && Object.values(state.votes).includes(player.id)) this.killPlayer(state, player.id, "ferry_vote", undefined, true);
    }

    for (const verifier of livingPlayers(state.players).filter((p) => p.role === "verifier")) {
      const wolfVoted = Object.keys(state.votes).some((id) => {
        const voter = state.players.find((p) => p.id === id);
        return voter && playerFaction(voter) === "werewolf";
      });
      this.storeRoleResult(state, verifier, verifier, wolfVoted ? "本輪有效投票者中有狼人陣營" : "本輪有效投票者中沒有狼人陣營");
    }

    const topTargets = topWeightedVoteTargets(state);
    const eliminatedId = topTargets.length === 1 ? topTargets[0] : undefined;
    if (!eliminatedId && topTargets.length > 1) {
      const system = this.systemMem(state);
      const revoteCount = Number(system.voteRevoteCount ?? 0);
      if (state.settings.tieRule === "revote" && revoteCount < 1) {
        system.voteRevoteCount = revoteCount + 1;
        state.votes = {};
        this.addSystemMessage(state, `最高票平手：${topTargets.map((id) => this.nameOf(state, id)).join("、")}。依房規進行全場重投。`);
        this.saveBroadcast(state);
        return;
      }
      if (state.settings.tieRule === "pk_revote" && revoteCount < 1) {
        system.voteRevoteCount = revoteCount + 1;
        system.pkVoteCandidates = topTargets;
        state.phase = "debate";
        state.debateOrder = secureShuffle(topTargets);
        state.debateIndex = 0;
        state.debateCompleted = [];
        state.votes = {};
        this.addSystemMessage(state, `最高票平手，進入 PK 辯論：${topTargets.map((id) => this.nameOf(state, id)).join("、")}。平票者完成追加發言後，全場只可在這些候選人中重投。`);
        this.saveBroadcast(state);
        return;
      }
      delete system.voteRevoteCount;
      delete system.pkVoteCandidates;
      delete state.lastVoteEliminated;
      this.addSystemMessage(state, "重投後仍平票，或房規採平票無人出局；本日無人被放逐。 ");
      this.checkAndMaybeEnd(state);
      if (!state.winner) this.enterNight(state, state.round + 1);
      return;
    }

    if (eliminatedId) {
      const target = state.players.find((p) => p.id === eliminatedId);
      if (target?.role === "masochist_cultist") {
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
        const livingWolves = livingPlayers(state.players).filter((p) => playerFaction(p) === "werewolf");
        if (livingWolves.length === 1 && livingWolves[0]!.id === target.id && this.mem(state, target.id).bloodLastStandUsed !== true) {
          const tm = this.mem(state, target.id);
          tm.bloodLastStandUsed = true;
          tm.bloodLastStandRound = state.round + 1;
          this.addSystemMessage(state, `${target.name}（血狼）作為最後一狼被放逐，但依角色能力延後到下一個夜晚結束才真正出局。`);
          const system = this.systemMem(state); delete system.voteRevoteCount; delete system.pkVoteCandidates;
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
        for (const medium of livingPlayers(state.players).filter((p) => p.role === "medium")) {
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
      this.addSystemMessage(state, "本輪沒有形成有效最高票，無人出局。 ");
    }
    const system = this.systemMem(state);
    delete system.voteRevoteCount;
    delete system.pkVoteCandidates;
    this.checkAndMaybeEnd(state);
    if (state.winner) return;
    this.enterNight(state, state.round + 1);
  }

  private checkAndMaybeEnd(state: GameState): void {
    const winner = checkWinner(state.players);
    if (winner) this.endGame(state, winner);
  }

  private endGame(state: GameState, winner: Faction): void {
    state.phase = "ended";
    state.winner = winner;
    if (!state.winnerPlayerIds) state.winnerPlayerIds = activePlayers(state.players).filter((p) => playerFaction(p) === winner).map((p) => p.id);
    if (!state.winnerLabel) state.winnerLabel = `${this.factionName(winner)}獲勝`;
    this.addSystemMessage(state, `遊戲結束：${state.winnerLabel}。`);
    this.saveBroadcast(state);
  }

  private initializeRoleMemories(state: GameState): void {
    for (const player of activePlayers(state.players)) {
      this.mem(state, player.id);
      if (player.role === "spy") player.factionOverride = secureShuffle<Faction>(["village", "werewolf", "spirit"])[0]!;
      if (player.role === "confirmed_villager") this.addSystemMessage(state, `${player.name} 是系統公開確認的好人（金水）。`);
      if (player.role === "vomit_wolf") this.mem(state, player.id).vomitStacks = 0;
    }
  }

  private applyEndOfNightStatuses(state: GameState): void {
    for (const player of state.players) {
      const m = this.mem(state, player.id);
      if (player.role === "vomit_wolf" && player.alive) m.vomitStacks = Number(m.vomitStacks ?? 0) + 1;
      const reviveRound = m.reviveRound;
      if (typeof reviveRound === "number" && reviveRound <= state.round && !player.alive) { player.alive = true; delete state.deathReasons[player.id]; delete m.reviveRound; }
      const delayedKillRound = m.delayedKillRound;
      if (typeof delayedKillRound === "number" && delayedKillRound <= state.round && player.alive) { delete m.delayedKillRound; this.killPlayer(state, player.id, "delayed_sting", undefined, true); }
      const bloodLastStandRound = m.bloodLastStandRound;
      if (typeof bloodLastStandRound === "number" && bloodLastStandRound <= state.round && player.alive) { delete m.bloodLastStandRound; this.killPlayer(state, player.id, "blood_last_stand_end", undefined, true); }
      if (player.role === "thief" && typeof m.stealRole === "string" && typeof m.stealTarget === "string") {
        const target = state.players.find((p) => p.id === m.stealTarget);
        if (target?.role) { const old = player.role; player.role = target.role; target.role = old; }
        delete m.stealRole; delete m.stealTarget;
      }
      if (player.role === "apprentice_seer" && !state.players.some((p) => p.alive && p.role === "seer")) player.role = "seer";
      if (player.role === "fist_brother" && player.alive && state.players.filter((p) => p.alive && p.role === "fist_brother").length === 1) player.role = "coward";
    }
  }

  private killPlayer(state: GameState, targetId: string, reason: string, killerId?: string, bypassProtection = false): boolean {
    const target = state.players.find((p) => p.id === targetId && p.alive && !p.isSpectator);
    if (!target) return false;
    const m = this.mem(state, target.id);
    if (!bypassProtection && state.phase === "night") {
      const redirectCandidates: Array<[string, string]> = [
        ["scapegoat", "ninja_redirect"], ["bodyguard", "sadist_bodyguard"], ["curseSubstitute", "curse_substitute"]
      ];
      for (const [key, redirectReason] of redirectCandidates) {
        const redirectId = m[key];
        if (typeof redirectId !== "string" || m[`used:${key}`] === true) continue;
        const substitute = state.players.find((p) => p.id === redirectId && p.alive && !p.isSpectator);
        if (!substitute) continue;
        m[`used:${key}`] = true;
        return this.killPlayer(state, substitute.id, redirectReason, target.id, true);
      }
    }
    if (!bypassProtection) {
      if (reason === "wolf" && target.role === "wraith") return false;
      if (reason.includes("poison") && target.role === "medicine_wolf") return false;
      if (reason.includes("poison") && target.role === "ghost_hunter" && m.poisonShieldUsed !== true) { m.poisonShieldUsed = true; return false; }
      if (state.phase === "night" && target.role === "vampire_wolf" && m.vampireShield === 1) { m.vampireShield = 0; return false; }
      if (reason === "wolf" && target.role === "physicist" && m.physicsShieldUsed !== true) { m.physicsShieldUsed = true; return false; }
      if (m.deathShield === 1) { m.deathShield = 0; return false; }
      if (state.phase === "night" && m.nightBlessing === true) { m.nightBlessing = false; return false; }
      if (state.phase !== "night" && m.dayBlessing === true) { m.dayBlessing = false; return false; }
      if (reason === "wolf" && m.nightProtectedRound === state.round) return false;
      if (reason === "wolf" && this.isPermanentlyGuarded(state, target.id)) return false;
    }
    target.alive = false;
    state.deathReasons[target.id] = `r${state.round}:${reason}${killerId ? `:${killerId}` : ""}`;

    if (reason === "wolf" && target.role === "sacrifice") {
      const wolf = livingPlayers(state.players).find((p) => playerFaction(p) === "werewolf");
      if (wolf) this.addSystemMessage(state, `祭品效果公開：${wolf.name} 是狼人陣營。`);
    }
    for (const witness of livingPlayers(state.players).filter((p) => p.role === "witness")) {
      const wm = this.mem(state, witness.id);
      if (reason === "wolf" && wm.witnessUsed !== true && killerId) { wm.witnessUsed = true; this.storeRoleResult(state, witness, target, `狼人擊殺者線索：${this.nameOf(state, killerId)}`); }
    }
    const lover = m.lover;
    if (typeof lover === "string") this.killPlayer(state, lover, "lover", target.id, true);
    if (target.role === "wolf_beauty" && typeof m.charmed === "string") this.killPlayer(state, m.charmed, "wolf_beauty_charm", target.id, true);
    if (target.role === "ice_queen") {
      for (const frozen of this.asStringArray(m.frozenTargets)) this.killPlayer(state, frozen, "ice_queen_death", target.id, true);
    }
    for (const wolf of state.players.filter((p) => p.role === "confusing_wolf")) {
      const mark = this.mem(state, wolf.id).convertOnDeath;
      if (mark === target.id && target.role) { target.alive = true; target.role = "werewolf"; target.factionOverride = "werewolf"; delete state.deathReasons[target.id]; delete this.mem(state, wolf.id).convertOnDeath; }
    }
    for (const priest of state.players.filter((p) => p.role === "wolf_priest")) {
      const pm = this.mem(state, priest.id);
      if (pm.chainKillMark !== target.id || pm.chainTriggered === true) continue;
      const victim = secureShuffle(livingPlayers(state.players).filter((p) => playerFaction(p) === "village"))[0];
      pm.chainTriggered = true;
      if (victim) this.killPlayer(state, victim.id, "wolf_priest_chain", priest.id, true);
    }
    if (target.role === "dream_guide" && state.phase === "night" && typeof m.dreamwalker === "string") this.killPlayer(state, m.dreamwalker, "dream_link", target.id, true);
    if (target.role === "queen_bee" && state.phase === "night" && typeof m.pollenTarget === "string") this.mem(state, m.pollenTarget).delayedKillRound = state.round + 1;
    if (target.role === "betrayer") target.factionOverride = "werewolf";
    if (target.role === "hunter" || target.role === "black_wolf_king") {
      if (!(reason === "wolf_witch_poison" && target.role === "hunter")) this.queueDeathReaction(state, target.id, reason, state.phase === "night" ? "debate" : "night");
    }
    if (target.role === "resentful_wolf" && killerId) this.mem(state, killerId).disabledUntilRound = state.round + 2;
    if (target.role === "hive") for (const bee of state.players.filter((p) => p.role === "bee")) this.mem(state, bee.id).hiveDead = true;
    if (state.sheriff.sheriffId === target.id) {
      const next = state.sheriff.successors.find((id) => state.players.some((p) => p.id === id && p.alive && !p.isSpectator));
      state.sheriff.successors = state.sheriff.successors.filter((id) => id !== next && id !== target.id);
      if (next) { state.sheriff.sheriffId = next; this.addSystemMessage(state, `${this.nameOf(state, next)} 依候補順位繼任警長。`); }
      else { delete state.sheriff.sheriffId; this.addSystemMessage(state, "現任警長出局，且已無存活候補，本局警長職位懸缺。 "); }
    }
    return true;
  }

  private queueDeathReaction(state: GameState, actorId: string, reason: string, resumePhase: "night" | "debate" | "vote" | "ended"): void {
    if (!state.pendingReaction) {
      state.pendingReaction = { actorId, effect: "death_shot", reason, resumePhase };
      return;
    }
    const queue = this.asStringArray(this.systemMem(state).deathReactionQueue);
    queue.push(`${actorId}|${resumePhase}|${reason}`);
    this.systemMem(state).deathReactionQueue = queue;
  }

  private popDeathReaction(state: GameState): boolean {
    const queue = this.asStringArray(this.systemMem(state).deathReactionQueue);
    const raw = queue.shift();
    this.systemMem(state).deathReactionQueue = queue;
    if (!raw) return false;
    const [actorId, resumeRaw, ...reasonParts] = raw.split("|");
    const resumePhase = (["night", "debate", "vote", "ended"].includes(resumeRaw ?? "") ? resumeRaw : "debate") as "night" | "debate" | "vote" | "ended";
    if (!actorId) return this.popDeathReaction(state);
    state.pendingReaction = { actorId, effect: "death_shot", reason: reasonParts.join("|") || "連鎖死亡", resumePhase };
    state.phase = "reaction";
    return true;
  }

  private isNightProtected(state: GameState, targetId: string): boolean {
    const m = this.mem(state, targetId);
    return m.nightProtectedRound === state.round || m.nightBlessing === true || this.isPermanentlyGuarded(state, targetId);
  }

  private isPermanentlyGuarded(state: GameState, targetId: string): boolean {
    return state.players.some((p) => p.alive && p.role === "guardian" && this.mem(state, p.id).permanentGuard === targetId);
  }

  private isActionDisabled(state: GameState, playerId: string): boolean {
    const m = this.mem(state, playerId);
    if (m.disabledPermanently === true) return true;
    if (typeof m.disabledUntilRound === "number" && m.disabledUntilRound >= state.round) return true;
    if (this.systemMem(state).goodSkillsDisabledRound === state.round) {
      const player = state.players.find((p) => p.id === playerId);
      if (player && playerFaction(player) === "village") return true;
    }
    return false;
  }

  private storeTeamResult(state: GameState, actor: Player, target: Player): void {
    state.seerResults[actor.id] ??= {};
    const hidden = this.mem(state, target.id).inspectionHiddenRound === state.round;
    let result: Faction | "hidden" = hidden ? "hidden" : (playerFaction(target) ?? "neutral");
    if (!hidden && target.role) {
      const passives = new Set(roleDefinition(target.role).passives ?? []);
      if (passives.has("seer_looks_village") || (passives.has("seer_village_until_round4") && state.round <= 3)) result = "village";
      if (passives.has("hidden_from_inspection_until_awake") && this.mem(state, target.id).awake !== true) result = "village";
      if (passives.has("seer_looks_werewolf")) result = "werewolf";
      if (passives.has("first_seer_looks_village") && this.mem(state, target.id).seerSeenOnce !== true) { result = "village"; this.mem(state, target.id).seerSeenOnce = true; }
      const disguise = this.mem(state, target.id).disguiseTarget;
      if (typeof disguise === "string") {
        const fake = state.players.find((p) => p.id === disguise);
        if (fake) result = playerFaction(fake) ?? result;
      }
    }
    state.seerResults[actor.id]![target.id] = result;
  }

  private resolveSpiritInspection(state: GameState, actor: Player, target: Player): void {
    if (playerFaction(target) !== "spirit" || !target.role) return;
    if (target.role === "ferry_spirit") return;
    if (target.role === "ancestral_spirit") {
      const tm = this.mem(state, target.id);
      const count = Number(tm.exorciseCount ?? 0) + 1;
      tm.exorciseCount = count;
      if (count >= 2) this.killPlayer(state, target.id, "exorcise", actor.id, true);
      return;
    }
    if (target.role === "cursed_spirit") this.mem(state, actor.id).disabledUntilRound = state.round + 1;
    this.killPlayer(state, target.id, "exorcise", actor.id, true);
  }

  private storeRoleResult(state: GameState, actor: Player, target: Player, result: string): void {
    state.roleResults[actor.id] ??= {};
    const hidden = this.mem(state, target.id).inspectionHiddenRound === state.round;
    const disguise = this.mem(state, target.id).disguiseTarget;
    if (hidden) state.roleResults[actor.id]![target.id] = "被隱藏";
    else if (typeof disguise === "string") {
      const fake = state.players.find((p) => p.id === disguise);
      state.roleResults[actor.id]![target.id] = fake?.role ? roleDefinition(fake.role).name : result;
    } else state.roleResults[actor.id]![target.id] = result;
  }

  private magicianSwap(state: GameState, a: Player, b: Player): void {
    if (a.alive !== b.alive) {
      const living = a.alive ? a : b;
      const dead = a.alive ? b : a;
      living.alive = false; dead.alive = true;
      state.deathReasons[living.id] = `r${state.round}:magician_swap`;
      delete state.deathReasons[dead.id];
    } else if (a.role && b.role) [a.role, b.role] = [b.role, a.role];
  }

  private resolveNecromancer(state: GameState, actor: Player, target?: Player): void {
    const dead = activePlayers(state.players).filter((p) => !p.alive).length;
    const ratio = state.initialPlayerCount ? dead / state.initialPlayerCount : 0;
    const m = this.mem(state, actor.id);
    if (ratio >= 0.5 && m.deathShield !== 1) m.deathShield = 1;
    if (ratio >= 0.75 && target) this.killPlayer(state, target.id, "necromancer", actor.id, true);
    else if (ratio >= 0.25 && target) this.storeRoleResult(state, actor, target, target.role ? roleDefinition(target.role).name : "未知");
  }

  private resolveAlchemist(state: GameState, actor: Player, target?: Player): void {
    const m = this.mem(state, actor.id);
    const stage = Number(m.alchemistStage ?? 0);
    if (stage === 0) { if (target) this.mem(state, target.id).disabledUntilRound = state.round; m.alchemistStage = 1; }
    else if (stage === 1) { m.deathShield = 1; m.alchemistStage = 2; }
    else if (stage === 2 && target) { this.killPlayer(state, target.id, "alchemist", actor.id, true); m.alchemistStage = 3; }
  }

  private detonateFrozen(state: GameState, actor: Player): void {
    const m = this.mem(state, actor.id);
    let kills = Number(m.iceQueenKills ?? 0);
    for (const id of this.asStringArray(m.frozenTargets)) if (this.killPlayer(state, id, "ice_queen", actor.id, true)) kills += 1;
    m.iceQueenKills = kills;
    if (kills > state.initialPlayerCount / 2) { state.winner = "neutral"; state.winnerPlayerIds = [actor.id]; state.winnerLabel = `${actor.name}（冰雪女王）凍結死亡人數過半，獨自獲勝`; }
  }

  private wasTargetedByOther(state: GameState, targetId: string, actorId: string): boolean {
    return Object.entries(state.nightActions.roleActions).some(([id, action]) => id !== actorId && action.targetIds.includes(targetId)) || Object.values(state.nightActions.seerTargets).includes(targetId) || Object.values(state.nightActions.guardTargets).includes(targetId);
  }

  private wolfTarget(state: GameState): string | undefined {
    const counts: Record<string, number> = {};
    for (const target of Object.values(state.nightActions.wolfVotes)) counts[target] = (counts[target] ?? 0) + 1;
    const ordered = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (!ordered[0]) return undefined;
    return ordered[0]![0];
  }

  private firstLivingWolfId(state: GameState): string | undefined { return livingPlayers(state.players).find((p) => playerFaction(p) === "werewolf")?.id; }

  private formatNightDeaths(state: GameState): string {
    if (state.lastNightDeaths.length === 0) return `第 ${state.round} 天早晨：昨夜是平安夜。`;
    const names = state.lastNightDeaths.map((id) => this.nameOf(state, id));
    if (state.settings.deathInfo === "hidden") return `第 ${state.round} 天早晨：昨夜有 ${names.length} 名玩家死亡，房規隱藏死者與死因。`;
    if (state.settings.deathInfo === "names") return `第 ${state.round} 天早晨：${names.join("、")} 死亡；死因依房規隱藏。`;
    const details = state.lastNightDeaths.map((id) => `${this.nameOf(state, id)}（${this.deathReasonLabel(state.deathReasons[id] ?? "") }）`);
    return `第 ${state.round} 天早晨：${details.join("、")}。`;
  }

  private deathReasonLabel(raw: string): string {
    const reason = raw.split(":")[1] ?? raw;
    const labels: Record<string, string> = { wolf: "狼刀", poison: "女巫毒藥", strong_kill: "強襲", wolf_witch_poison: "狼巫毒藥", hunt: "狩獵", angel: "天使查驗", devil: "惡魔查驗", voodoo: "巫毒詛咒", fake_kill: "假死" };
    return labels[reason] ?? "特殊能力";
  }

  private pendingAITask(state: GameState): PendingAITask | undefined {
    if (state.phase === "debate") {
      const id = currentDebaterId(state.debateOrder, state.debateIndex);
      const player = state.players.find((p) => p.id === id && p.isAI && p.alive);
      if (player) return { playerId: player.id, operation: "debate_speech" };
    }
    if (state.phase === "vote" && isAIVotingUnlocked(state.players, state.votes)) {
      const player = livingPlayers(state.players).find((p) => p.isAI && !state.votes[p.id]);
      if (player) return { playerId: player.id, operation: "vote" };
    }
    if (state.phase === "night") {
      const ai = livingPlayers(state.players).find((p) => p.isAI && needsNightAction(state, p));
      if (ai) return { playerId: ai.id, operation: this.participatesWolfVote(state, ai) && !state.nightActions.wolfVotes[ai.id] ? "night_action" : "role_action" };
    }
    return undefined;
  }

  private assertFreshAITask(state: GameState, hostToken: string, playerId: string, operation: PendingAITask["operation"]): void {
    this.assertHost(state, hostToken);
    const task = this.pendingAITask(state);
    if (!task || task.playerId !== playerId || task.operation !== operation) throw new Error("AI 操作已過期，請重新同步房間狀態");
  }

  private async decideAIDebateTurn(state: GameState, actor: Player, apiKeys: string[]): Promise<{ message: string; action?: unknown }> {
    if (!actor.ai) throw new Error("AI 設定不存在");
    const dayPrompt = roleActionPrompt(actor, state);
    const usableDayPrompt = dayPrompt?.timing === "day" ? dayPrompt : undefined;
    const legalTargets = usableDayPrompt ? this.legalTargets(state, actor, usableDayPrompt.targetMode) : [];
    const actionInstruction = usableDayPrompt
      ? [
          `你目前有一個可選白天技能：effect=${usableDayPrompt.effect}，targetMode=${usableDayPrompt.targetMode}。`,
          `合法目標：${legalTargets.length ? legalTargets.map((p) => `${p.id}=${p.name}`).join(", ") : "無需目標或目前無合法目標"}。`,
          usableDayPrompt.options?.length ? `合法 option：${usableDayPrompt.options.join(", ")}。` : "此技能沒有 option。",
          "只有你真的決定現在發動技能時，action 才填物件；否則 action 必須是 null。",
          `action 物件格式：{"effect":"${usableDayPrompt.effect}","targetIds":${usableDayPrompt.targetMode === "none" ? "[]" : usableDayPrompt.targetMode.startsWith("two_") ? '["玩家ID1","玩家ID2"]' : '["玩家ID"]'}${usableDayPrompt.options?.length ? ',"option":"合法選項"' : ""}}。`,
          "如果發言文字提到『自爆／決鬥／技能』但你並沒有要實際發動，action 必須維持 null；伺服器只相信結構化 action，不從文字關鍵字觸發技能。"
        ].join("\n")
      : "你目前沒有可在正式發言階段發動的角色技能，因此 action 必須是 null。";
    const result = await callAIWithKeys(apiKeys, {
      config: actor.ai,
      system: this.aiSystemPrompt(actor, state),
      prompt: `${this.privateContext(state, actor)}\n\n現在輪到你正式發言。只回傳 JSON：{"message":"80~180 字繁體中文發言","action":null}。必須提出理由與目前懷疑方向。\n${actionInstruction}`
    });
    const parsed = parseJSONObject(result.text) as AIJSON;
    const message = typeof parsed.message === "string" && parsed.message.trim()
      ? this.normalizeSpeech(parsed.message)
      : "目前資訊仍不足，我會先對照前後發言與夜間結果，再從矛盾最大的玩家開始懷疑。";
    return { message, ...(parsed.action !== undefined ? { action: parsed.action } : {}) };
  }

  private normalizeAIDayAction(
    state: GameState,
    actor: Player,
    raw: unknown
  ): { effect: RoleActionEffect; targetIds: string[]; option?: string } | undefined {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const prompt = roleActionPrompt(actor, state);
    if (!prompt || prompt.timing !== "day") return undefined;
    const record = raw as Record<string, unknown>;
    if (record.effect !== prompt.effect) return undefined;
    const rawIds = Array.isArray(record.targetIds)
      ? record.targetIds
      : typeof record.targetId === "string"
        ? [record.targetId]
        : [];
    if (!rawIds.every((id) => typeof id === "string")) return undefined;
    const targetIds = rawIds as string[];
    try { this.validateTargetCount(prompt.targetMode, targetIds); } catch { return undefined; }
    const legal = new Set(this.legalTargets(state, actor, prompt.targetMode).map((p) => p.id));
    if (targetIds.some((id) => !legal.has(id))) return undefined;
    let option: string | undefined;
    if (prompt.options?.length) {
      if (typeof record.option !== "string" || !prompt.options.includes(record.option)) return undefined;
      option = record.option;
    }
    return { effect: prompt.effect, targetIds, ...(option ? { option } : {}) };
  }

  private async decideAIVote(state: GameState, actor: Player, apiKeys: string[]): Promise<string> {
    return this.decideAITarget(state, actor, apiKeys, livingPlayers(state.players).filter((p) => p.id !== actor.id));
  }

  private async decideAITarget(state: GameState, actor: Player, apiKeys: string[], candidates: Player[]): Promise<string> {
    if (!actor.ai || candidates.length === 0) throw new Error("AI 沒有合法目標");
    const result = await callAIWithKeys(apiKeys, {
      config: actor.ai,
      system: this.aiSystemPrompt(actor, state),
      prompt: `${this.privateContext(state, actor)}\n\n合法目標：${candidates.map((p) => `${p.id}=${p.name}`).join(", ")}。只回傳 JSON：{"targetId":"玩家ID"}。`
    });
    const parsed = parseJSONObject(result.text) as AIJSON;
    const id = typeof parsed.targetId === "string" ? parsed.targetId : "";
    return candidates.some((p) => p.id === id) ? id : candidates[0]!.id;
  }

  private aiSystemPrompt(actor: Player, state: GameState): string {
    const faction = playerFaction(actor) ?? "未知";
    const teammates = faction === "werewolf" ? this.wolfTeammates(state, actor).map((p) => p.name).join("、") : "無";
    return [
      "你正在進行繁體中文辯論式狼人殺。你是玩家，不是主持人。",
      "所有物理追逐、武器、距離與 PvP 效果都已改寫為資訊／狀態機規則。",
      `你的名字：${actor.name}。職業：${actor.role ? roleDefinition(actor.role).name : "未知"}。陣營：${faction}。`,
      `依法可知的狼人隊友：${teammates || "無"}。`,
      "不得要求、回傳或討論 API Key。不得聲稱看過依法不可能取得的私密資訊。",
      "正式發言要根據公開紀錄、死亡資訊、票型與自己合法取得的秘密資訊提出可反駁的推理。"
    ].join("\n");
  }

  private publicContext(state: GameState): string {
    const players = state.players.filter((p) => !p.isSpectator).map((p) => `${p.id}=${p.name}[${p.alive ? "存活" : "出局"}${p.isAI ? ",AI" : ",真人"}]`).join(", ");
    const logs = state.messages.slice(-40).map((m) => `${m.playerName}: ${m.content}`).join("\n");
    return `第 ${state.round} 輪，phase=${state.phase}。\n玩家：${players}\n公開紀錄：\n${logs}`;
  }

  private privateContext(state: GameState, actor: Player): string {
    const seer = JSON.stringify(state.seerResults[actor.id] ?? {});
    const roles = JSON.stringify(state.roleResults[actor.id] ?? {});
    return `${this.publicContext(state)}\n你的秘密查驗：${seer}\n其他角色資訊：${roles}`;
  }

  private projectState(state: GameState, token: string): PrivateView {
    const me = this.playerByToken(state, token);
    const players: PublicPlayer[] = state.players.filter((p) => !p.kickedAt).map((p) => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      isAI: p.isAI,
      isSpectator: p.isSpectator,
      ...(p.isAI && p.ai ? { ai: p.ai } : {}),
      isHost: p.id === state.hostPlayerId,
      isSheriff: p.id === state.sheriff.sheriffId,
      ...(state.phase === "ended" && p.role ? { role: p.role } : {})
    }));
    const privateMe: PrivateView["me"] = {
      id: me.id, name: me.name, alive: me.alive, isHost: me.id === state.hostPlayerId, isSpectator: me.isSpectator, hasPassword: me.isAI || Boolean(me.password)
    };
    if (me.role) {
      privateMe.role = me.role;
      const faction = playerFaction(me);
      if (faction) privateMe.faction = faction;
    }
    if (me.role && playerFaction(me) === "werewolf") privateMe.wolfTeammates = this.wolfTeammates(state, me).map((p) => p.id);
    const seerResults = state.seerResults[me.id];
    if (seerResults) privateMe.seerResults = seerResults;
    const derivedRoleResults: Record<string, string> = { ...(state.roleResults[me.id] ?? {}) };
    if (me.role === "captain") {
      for (const player of activePlayers(state.players)) if (player.role) derivedRoleResults[`role:${player.id}`] = `${player.name}：${roleDefinition(player.role).name}`;
    }
    if (me.role === "precog" && state.phase === "vote") {
      const top = topWeightedVoteTargets(state);
      if (top.length === 1) {
        const player = state.players.find((p) => p.id === top[0]);
        if (player?.role) derivedRoleResults["precog:top"] = `目前唯一最高票 ${player.name}：${roleDefinition(player.role).name}`;
      } else derivedRoleResults["precog:top"] = "目前最高票尚未唯一確定";
    }
    if (Object.keys(derivedRoleResults).length) privateMe.roleResults = derivedRoleResults;
    if (me.role === "witch") {
      privateMe.witchHealAvailable = state.witchHealAvailable;
      privateMe.witchPoisonAvailable = state.witchPoisonAvailable;
      const victim = this.wolfTarget(state);
      if (victim) { privateMe.witchKnownVictim = victim; privateMe.witchCanHealKnownVictim = state.witchHealAvailable && (victim !== me.id || canWitchSelfSave(activePlayers(state.players).length, state.round)); }
    }
    if (me.role === "guard") { const lastGuardTarget = state.guardLastTargets[me.id]; if (lastGuardTarget) privateMe.guardLastTarget = lastGuardTarget; }
    const participants = activePlayers(state.players).filter((p) => !p.kickedAt);
    const roleSetupError = validateRoleSetup(state.roleSetup, participants.length);
    const prompt = roleActionPrompt(me, state);
    const result: PrivateView = {
      roomId: state.roomId, phase: state.phase, round: state.round, players, roleSetup: state.roleSetup,
      ...(roleSetupError ? { roleSetupError } : {}), canStart: !roleSetupError, settings: state.settings, sheriff: state.sheriff,
      messages: state.messages, me: privateMe, ...(prompt ? { roleAction: prompt } : {}), roleActionSubmitted: Boolean(state.nightActions.roleActions[me.id]), canSubmitWolfVote: this.participatesWolfVote(state, me), wolfVoteSubmitted: Boolean(state.nightActions.wolfVotes[me.id]), votesCast: Object.keys(state.votes),
      ...(this.asStringArray(this.systemMem(state).pkVoteCandidates).length ? { voteCandidateIds: this.asStringArray(this.systemMem(state).pkVoteCandidates) } : {}),
      nightSubmitted: this.nightSubmittedPlayers(state), debateOrder: state.debateOrder, debateIndex: state.debateIndex,
      debateCompleted: state.debateCompleted, aiVotingUnlocked: isAIVotingUnlocked(state.players, state.votes), lastNightDeaths: state.lastNightDeaths,
      ...(state.settings.deathInfo === "full" ? { deathReasons: state.deathReasons } : {}),
      ...(state.lastVoteEliminated ? { lastVoteEliminated: state.lastVoteEliminated } : {}),
      ...(state.winner ? { winner: state.winner } : {}), ...(state.winnerPlayerIds ? { winnerPlayerIds: state.winnerPlayerIds } : {}),
      ...(state.winnerLabel ? { winnerLabel: state.winnerLabel } : {})
    };
    const speaker = currentDebaterId(state.debateOrder, state.debateIndex); if (speaker) result.currentSpeakerId = speaker;
    if (me.id === state.hostPlayerId) { const ai = this.pendingAITask(state); if (ai) result.pendingAI = ai; }
    return result;
  }

  private wolfTeammates(state: GameState, actor: Player): Player[] {
    if (playerFaction(actor) !== "werewolf") return [];
    if (actor.role === "primordial_wolf" || actor.role === "sun_wolf" || actor.role === "sniper_eight_wolf" || actor.role === "lurking_wolf") return [];
    return livingPlayers(state.players).filter((p) => p.id !== actor.id && playerFaction(p) === "werewolf" && p.role !== "primordial_wolf" && p.role !== "sun_wolf" && p.role !== "sniper_eight_wolf" && p.role !== "lurking_wolf");
  }

  private participatesWolfVote(state: GameState, actor: Player): boolean {
    if (playerFaction(actor) !== "werewolf") return false;
    if (actor.role === "sun_wolf" || actor.role === "sniper_eight_wolf") return false;
    if (actor.role === "young_wolf" && state.round <= 3) return false;
    if (actor.role === "lurking_wolf" && this.mem(state, actor.id).awake !== true) return false;
    return true;
  }

  private legalWolfTargets(state: GameState, actor: Player): Player[] { return livingPlayers(state.players).filter((p) => p.id !== actor.id && playerFaction(p) !== "werewolf"); }

  private legalTargets(state: GameState, actor: Player, mode: string): Player[] {
    const alive = livingPlayers(state.players);
    const dead = activePlayers(state.players).filter((p) => !p.alive);
    if (mode === "none") return [];
    if (mode === "one_dead") return dead;
    if (mode === "one_alive_any" || mode === "two_alive_any") return alive;
    if (mode === "one_alive_non_wolf") return alive.filter((p) => p.id !== actor.id && playerFaction(p) !== "werewolf");
    if (mode === "two_any") return activePlayers(state.players).filter((p) => p.id !== actor.id);
    return alive.filter((p) => p.id !== actor.id);
  }

  private validateTargetCount(mode: string, ids: string[]): void {
    const required = mode === "none" ? 0 : mode.startsWith("two_") ? 2 : mode === "optional_alive_other" ? (ids.length > 1 ? -1 : ids.length) : 1;
    if (required >= 0 && ids.length !== required) throw new Error(`此技能需要 ${required} 個目標`);
    if (new Set(ids).size !== ids.length) throw new Error("技能目標不能重複");
  }

  private requireAliveOther(state: GameState, actor: Player, id: string): Player {
    const target = state.players.find((p) => p.id === id && p.alive && !p.isSpectator && p.id !== actor.id);
    if (!target) throw new Error("目標無效");
    return target;
  }

  private validateWitchAction(state: GameState, actor: Player, action: WitchAction): void {
    if (action.type === "heal") {
      if (!state.witchHealAvailable) throw new Error("解藥已使用");
      const victim = this.wolfTarget(state); if (!victim) throw new Error("目前沒有可救的狼刀目標");
      if (victim === actor.id && !canWitchSelfSave(activePlayers(state.players).length, state.round)) throw new Error("此人數／輪次房規下女巫不能自救");
    }
    if (action.type === "poison") {
      if (!state.witchPoisonAvailable) throw new Error("毒藥已使用");
      this.requireAliveOther(state, actor, action.targetId);
    }
  }

  private assertLoginAllowed(nameKey: string): void {
    const failure = this.authFailures.get(nameKey);
    if (!failure) return;
    if (failure.blockedUntil <= Date.now()) { this.authFailures.delete(nameKey); return; }
    throw new Error("登入嘗試過多，請稍後再試");
  }

  private recordLoginFailure(nameKey: string): void {
    const now = Date.now();
    const current = this.authFailures.get(nameKey);
    const count = current && current.blockedUntil > now - 60_000 ? current.count + 1 : 1;
    const blockedUntil = count >= 5 ? now + 60_000 : now + 10_000;
    this.authFailures.set(nameKey, { count, blockedUntil });
  }

  private async assertRoomPassword(state: GameState, supplied?: string): Promise<void> {
    if (!state.roomPassword) return;
    const key = "__room_password__";
    this.assertLoginAllowed(key);
    if (!supplied || !(await verifyPassword(supplied, state.roomPassword))) {
      this.recordLoginFailure(key);
      throw new Error("房間密碼錯誤");
    }
    this.authFailures.delete(key);
  }

  private async newHumanPlayer(name: string, password: string, spectator: boolean): Promise<Player> {
    const normalized = normalizePlayerName(name);
    return { id: crypto.randomUUID(), token: randomToken(), name: normalized.display, nameKey: normalized.key, password: await createPasswordVerifier(password), alive: !spectator, isAI: false, isSpectator: spectator, joinedAt: Date.now() };
  }

  private newAIPlayer(name: string, ai: AIConfig): Player {
    const normalized = normalizePlayerName(name);
    return { id: crypto.randomUUID(), token: randomToken(), name: normalized.display, nameKey: normalized.key, alive: true, isAI: true, isSpectator: false, ai, joinedAt: Date.now() };
  }

  private playerByToken(state: GameState, token: string): Player {
    const player = state.players.find((p) => !p.kickedAt && secureEqual(p.token, token));
    if (!player) throw new Error("玩家憑證無效，請用人物名稱與密碼重新登入");
    return player;
  }

  private assertHost(state: GameState, token: string): void { if (this.playerByToken(state, token).id !== state.hostPlayerId) throw new Error("只有房主可以執行此操作"); }
  private assertLobby(state: GameState): void { if (state.phase !== "lobby") throw new Error("目前不是大廳階段"); }

  private validateAIConfig(ai: AIConfig): void {
    if (!new Set(["openai", "gemini", "deepseek", "openai-compatible"]).has(ai.provider)) throw new Error("AI provider 無效");
    if (!ai.model.trim() || ai.model.length > 120) throw new Error("AI model 無效");
    if (ai.provider === "openai-compatible") { if (!ai.baseUrl?.trim()) throw new Error("OpenAI-compatible Provider 必須設定 Base URL"); const u = new URL(ai.baseUrl); if (u.protocol !== "https:") throw new Error("自訂 API Base URL 必須使用 HTTPS"); }
  }

  private normalizeRoleSetup(raw: RoleSetup): RoleSetup {
    const out: RoleSetup = {};
    for (const def of ROLE_LIST) {
      const value = raw[def.id];
      if (value === undefined) continue;
      if (!Number.isInteger(value) || value < 0) throw new Error(`${def.name} 數量必須是 0 以上整數`);
      if (value > 0) out[def.id] = value;
    }
    return out;
  }

  private resizeRoleSetupAfterLeave(setup: RoleSetup): RoleSetup {
    const out = { ...setup };
    if ((out.villager ?? 0) > 0) out.villager = (out.villager ?? 0) - 1;
    else {
      const id = ROLE_LIST.find((def) => (out[def.id] ?? 0) > 0)?.id;
      if (id) out[id] = Math.max(0, (out[id] ?? 0) - 1);
    }
    return out;
  }

  private nightSubmittedPlayers(state: GameState): string[] {
    return [...new Set([...Object.keys(state.nightActions.wolfVotes), ...Object.keys(state.nightActions.seerTargets), ...Object.keys(state.nightActions.guardTargets), ...Object.keys(state.nightActions.witchActions), ...Object.keys(state.nightActions.roleActions)])];
  }

  private mem(state: GameState, playerId: string): Record<string, RoleMemoryValue> { state.roleMemory[playerId] ??= {}; return state.roleMemory[playerId]!; }
  private systemMem(state: GameState): Record<string, RoleMemoryValue> { return this.mem(state, "__system"); }
  private asStringArray(value: RoleMemoryValue | undefined): string[] { return Array.isArray(value) && value.every((v) => typeof v === "string") ? [...value] : []; }

  private addSystemMessage(state: GameState, content: string): void { state.messages.push({ id: crypto.randomUUID(), playerName: "系統", content, sourceLocale: "zh-TW", kind: "system", createdAt: Date.now(), round: state.round, phase: state.phase }); this.trimMessages(state); }
  private speechMessage(state: GameState, player: Player, content: string, sourceLocale: AppLocale = "zh-TW"): ChatMessage { return { id: crypto.randomUUID(), playerId: player.id, playerName: player.name, content, sourceLocale, kind: "speech", createdAt: Date.now(), round: state.round, phase: state.phase }; }
  private chatMessage(state: GameState, player: Player, content: string, sourceLocale: AppLocale = "zh-TW"): ChatMessage { return { id: crypto.randomUUID(), playerId: player.id, playerName: player.name, content, sourceLocale, kind: "chat", createdAt: Date.now(), round: state.round, phase: state.phase }; }
  private trimMessages(state: GameState): void { if (state.messages.length > 500) state.messages = state.messages.slice(-500); }
  private normalizeSpeech(content: string): string { const text = content.trim().replace(/\s+/g, " ").slice(0, 900); if (text.length < 2) throw new Error("正式發言至少需要 2 個字元"); return text; }
  private normalizeChat(content: string): string { const text = content.trim().replace(/\s+/g, " ").slice(0, 500); if (!text) throw new Error("聊天訊息不能為空白"); return text; }
  private nameOf(state: GameState, id: string): string { return state.players.find((p) => p.id === id)?.name ?? "未知玩家"; }
  private factionName(faction: Faction): string { return ({ village: "好人陣營", werewolf: "狼人陣營", spirit: "怨靈陣營", neutral: "特殊角色", blood: "血族陣營" } satisfies Record<Faction, string>)[faction]; }

  private normalizeMessageLocale(locale?: AppLocale): AppLocale { return locale === "zh-CN" || locale === "en" ? locale : "zh-TW"; }

  private closePlayerSockets(playerId: string, code: number, reason: string): void { for (const ws of this.ctx.getWebSockets()) { const a = ws.deserializeAttachment() as SocketAttachment | null; if (a?.playerId === playerId) ws.close(code, reason); } }
  private broadcast(state: GameState): void { for (const ws of this.ctx.getWebSockets()) { const a = ws.deserializeAttachment() as SocketAttachment | null; if (!a) continue; try { ws.send(JSON.stringify({ type: "state", state: this.projectState(state, a.token) } satisfies ServerMessage)); } catch { ws.close(1008, "Invalid session"); } } }
  private saveBroadcast(state: GameState): void { this.touchAndSave(state); this.broadcast(state); }

  private loadState(): GameState | undefined {
    if (this.stateCache) return this.stateCache;
    const row = this.ctx.storage.sql.exec<{ json: string }>("SELECT json FROM room_state WHERE key = 'state'").toArray()[0];
    if (!row) return undefined;
    const parsed = JSON.parse(row.json) as GameState;
    this.migrateState(parsed);
    this.stateCache = parsed;
    return parsed;
  }

  private migrateState(state: GameState): void {
    state.settings ??= { ...DEFAULT_SETTINGS };
    state.settings.autoRoleSetup ??= false;
    state.sheriff ??= { enabled: false, electionRound: 0, candidates: [], votes: {}, successors: [] };
    state.roleMemory ??= {};
    state.roleResults ??= {};
    state.deathReasons ??= {};
    state.initialPlayerCount ??= activePlayers(state.players).length;
    state.nightActions.roleActions ??= {};
    for (const player of state.players) {
      player.isSpectator ??= false;
      player.nameKey ??= normalizePlayerName(player.name).key;
    }
  }

  private requireState(): GameState { const state = this.loadState(); if (!state) throw new Error("房間不存在"); return state; }
  private saveState(state: GameState): void { this.ctx.storage.sql.exec("INSERT INTO room_state (key, json) VALUES ('state', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json", JSON.stringify(state)); this.stateCache = state; }
  private touchAndSave(state: GameState): void { state.updatedAt = Date.now(); this.saveState(state); }
}

function randomToken(): string { const bytes = new Uint8Array(24); crypto.getRandomValues(bytes); return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function secureEqual(a: string, b: string): boolean { if (a.length !== b.length) return false; const left = new TextEncoder().encode(a); const right = new TextEncoder().encode(b); let diff = 0; for (let i = 0; i < left.length; i += 1) diff |= left[i]! ^ right[i]!; return diff === 0; }
function assertNever(value: never): never { throw new Error(`未處理的操作: ${JSON.stringify(value)}`); }
