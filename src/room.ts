import { DurableObject } from "cloudflare:workers";
import { callAI, parseJSONObject, type AIEnv } from "./ai";
import {
  areNightActionsComplete,
  areVotesComplete,
  assignRoles,
  canGuardTarget,
  canWitchSelfSave,
  checkWinner,
  createDebateOrder,
  currentDebaterId,
  freshNightActions,
  isDebateComplete,
  isAIVotingUnlocked,
  pluralityTarget,
  resolveNight,
  teamForRole
} from "./game-engine";
import type {
  AIConfig,
  ChatMessage,
  ClientMessage,
  GameState,
  NightClientAction,
  Player,
  PrivateView,
  PublicPlayer,
  Role,
  ServerMessage,
  WitchAction
} from "./types";

type SocketAttachment = { playerId: string; token: string };
type InitResult = { roomId: string; playerId: string; token: string };
type JoinResult = { playerId: string; token: string };
type AIJSON = { message?: unknown; targetId?: unknown; action?: unknown };

export class GameRoom extends DurableObject<AIEnv> {
  private stateCache: GameState | undefined;

  constructor(ctx: DurableObjectState, env: AIEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room_state (
          key TEXT PRIMARY KEY,
          json TEXT NOT NULL
        )
      `);
    });
  }

  async initialize(roomId: string, hostName: string, maxPlayers: number): Promise<InitResult> {
    const existing = this.loadState();
    if (existing) throw new Error("ROOM_ALREADY_EXISTS");
    const host = this.newPlayer(hostName, false);
    const now = Date.now();
    const state: GameState = {
      roomId,
      hostPlayerId: host.id,
      maxPlayers,
      phase: "lobby",
      round: 0,
      players: [host],
      messages: [],
      votes: {},
      nightActions: freshNightActions(),
      seerResults: {},
      witchHealAvailable: true,
      witchPoisonAvailable: true,
      guardLastTargets: {},
      debateOrder: [],
      debateIndex: 0,
      debateCompleted: [],
      lastNightDeaths: [],
      createdAt: now,
      updatedAt: now
    };
    this.addSystemMessage(state, `房間 ${roomId} 已建立。模式固定為辯論式。`);
    this.saveState(state);
    return { roomId, playerId: host.id, token: host.token };
  }

  async joinHuman(name: string): Promise<JoinResult> {
    const state = this.requireState();
    this.assertLobby(state);
    this.assertPlayerName(state, name);
    if (state.players.length >= state.maxPlayers) throw new Error("房間已滿");
    const player = this.newPlayer(name, false);
    state.players.push(player);
    this.addSystemMessage(state, `${player.name} 加入房間。`);
    this.touchAndSave(state);
    this.broadcast(state);
    return { playerId: player.id, token: player.token };
  }

  async addAI(hostToken: string, name: string, ai: AIConfig): Promise<{ playerId: string }> {
    const state = this.requireState();
    this.assertHost(state, hostToken);
    this.assertLobby(state);
    this.assertPlayerName(state, name);
    if (state.players.length >= state.maxPlayers) throw new Error("房間已滿");
    this.validateAIConfig(ai);
    const player = this.newPlayer(name, true, ai);
    state.players.push(player);
    this.addSystemMessage(state, `AI 玩家 ${player.name} 加入房間（${ai.provider} / ${ai.model}）。`);
    this.touchAndSave(state);
    this.broadcast(state);
    return { playerId: player.id };
  }

  async getStateByToken(token: string): Promise<PrivateView> {
    return this.projectState(this.requireState(), token);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const url = new URL(request.url);
    const token = url.searchParams.get("token") ?? "";
    const state = this.requireState();
    const player = state.players.find((p) => secureEqual(p.token, token));
    if (!player) return new Response("Unauthorized", { status: 401 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: player.id, token: player.token } satisfies SocketAttachment);
    server.send(JSON.stringify({ type: "state", state: this.projectState(state, player.token) } satisfies ServerMessage));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment<SocketAttachment>();
    if (!attachment) {
      ws.send(JSON.stringify({ type: "error", message: "連線身份遺失，請重新整理。" } satisfies ServerMessage));
      ws.close(1008, "Missing identity");
      return;
    }
    try {
      const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
      const command = JSON.parse(raw) as ClientMessage;
      this.handleClientMessage(attachment.token, command);
    } catch (error) {
      const text = error instanceof Error ? error.message : "未知錯誤";
      ws.send(JSON.stringify({ type: "error", message: text } satisfies ServerMessage));
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    ws.close(1011, "WebSocket error");
  }

  private handleClientMessage(token: string, command: ClientMessage): void {
    switch (command.type) {
      case "start":
        this.startGame(token);
        return;
      case "debate_speech":
        this.submitDebateSpeech(token, command.content);
        return;
      case "vote":
        this.castVote(token, command.targetId);
        return;
      case "night_action":
        this.submitNightAction(token, command.action);
        return;
      default:
        return assertNever(command);
    }
  }

  private startGame(token: string): void {
    const state = this.requireState();
    this.assertHost(state, token);
    this.assertLobby(state);
    if (state.players.length < 5) throw new Error("至少需要 5 名玩家才能開始");
    state.players = assignRoles(state.players);
    state.phase = "night";
    state.round = 1;
    state.votes = {};
    state.nightActions = freshNightActions();
    state.guardLastTargets = {};
    state.debateOrder = [];
    state.debateIndex = 0;
    state.debateCompleted = [];
    state.lastNightDeaths = [];
    delete state.lastVoteEliminated;
    delete state.winner;
    this.addSystemMessage(state, "遊戲開始。固定採辯論式流程；天黑請閉眼。");
    this.touchAndSave(state);
    this.broadcast(state);
    this.ctx.waitUntil(this.runAINightActions());
  }

  private submitDebateSpeech(token: string, content: string): void {
    const state = this.requireState();
    if (state.phase !== "debate") throw new Error("目前不是辯論發言階段");
    const actor = this.playerByToken(state, token);
    if (!actor.alive) throw new Error("已出局玩家不能參與本輪辯論");
    const currentId = currentDebaterId(state.debateOrder, state.debateIndex);
    if (!currentId || currentId !== actor.id) throw new Error("尚未輪到你正式發言");
    if (actor.isAI) throw new Error("AI 玩家由伺服器自動發言");

    const text = this.normalizeSpeech(content);
    this.recordDebateSpeech(state, actor, text);
    if (isDebateComplete(state.debateOrder, state.debateIndex)) {
      this.enterVote(state);
      return;
    }
    this.touchAndSave(state);
    this.broadcast(state);
    this.ctx.waitUntil(this.runAIDebateTurns());
  }

  private castVote(token: string, targetId: string): void {
    const state = this.requireState();
    if (state.phase !== "vote") throw new Error("目前不是放逐投票階段");
    const voter = this.playerByToken(state, token);
    if (!voter.alive) throw new Error("已出局玩家不能投票");
    if (voter.isAI) throw new Error("AI 玩家由伺服器自動投票");
    const target = state.players.find((p) => p.id === targetId && p.alive);
    if (!target) throw new Error("投票目標無效");
    if (target.id === voter.id) throw new Error("不能投給自己");
    state.votes[voter.id] = target.id;
    this.touchAndSave(state);
    this.broadcast(state);
    if (areVotesComplete(state)) {
      this.finishVote(state);
      return;
    }
    this.ctx.waitUntil(this.runAIVotes());
  }

  private submitNightAction(token: string, action: NightClientAction): void {
    const state = this.requireState();
    if (state.phase !== "night") throw new Error("目前不是夜晚階段");
    const actor = this.playerByToken(state, token);
    if (!actor.alive || !actor.role) throw new Error("目前不能執行夜晚技能");
    if (actor.isAI) throw new Error("AI 玩家由伺服器自動執行夜晚行動");
    this.applyNightAction(state, actor, action);
    this.touchAndSave(state);
    this.broadcast(state);
    if (areNightActionsComplete(state)) {
      this.finishNight(state);
    } else {
      this.ctx.waitUntil(this.runAINightActions());
    }
  }

  private applyNightAction(state: GameState, actor: Player, action: NightClientAction): void {
    const target = "targetId" in action ? state.players.find((p) => p.id === action.targetId && p.alive) : undefined;
    switch (action.kind) {
      case "werewolf":
        if (actor.role !== "werewolf") throw new Error("你的身份不能執行狼人行動");
        if (!target || target.id === actor.id || target.role === "werewolf") throw new Error("狼人目標無效");
        state.nightActions.wolfVotes[actor.id] = target.id;
        return;
      case "seer":
        if (actor.role !== "seer") throw new Error("你的身份不能查驗");
        if (!target || target.id === actor.id) throw new Error("查驗目標無效");
        state.nightActions.seerTargets[actor.id] = target.id;
        return;
      case "guard":
        if (actor.role !== "guard") throw new Error("你的身份不能守護");
        if (!target) throw new Error("守護目標無效");
        if (!canGuardTarget(state.guardLastTargets[actor.id], target.id)) throw new Error("守衛不能連續兩晚守護同一位玩家");
        state.nightActions.guardTargets[actor.id] = target.id;
        return;
      case "witch":
        if (actor.role !== "witch") throw new Error("你的身份不能使用女巫技能");
        this.validateWitchAction(state, actor, action.action);
        state.nightActions.witchActions[actor.id] = action.action;
        return;
      default:
        return assertNever(action);
    }
  }

  private validateWitchAction(state: GameState, actor: Player, action: WitchAction): void {
    if (action.type === "heal") {
      if (!state.witchHealAvailable) throw new Error("解藥已使用");
      const victim = this.witchKnownVictim(state);
      if (!victim) throw new Error("目前沒有可使用解藥的狼人擊殺目標");
      if (victim === actor.id && !canWitchSelfSave(state.players.length, state.round)) {
        throw new Error("此人數／輪次設定下女巫不能自救");
      }
    }
    if (action.type === "poison") {
      if (!state.witchPoisonAvailable) throw new Error("毒藥已使用");
      const target = state.players.find((p) => p.id === action.targetId && p.alive);
      if (!target || target.id === actor.id) throw new Error("毒藥目標無效");
    }
  }

  private finishNight(state: GameState): void {
    for (const [seerId, targetId] of Object.entries(state.nightActions.seerTargets)) {
      const target = state.players.find((p) => p.id === targetId);
      if (!target?.role) continue;
      state.seerResults[seerId] ??= {};
      state.seerResults[seerId]![targetId] = teamForRole(target.role);
    }

    const resolution = resolveNight(state);
    const witchAction = Object.values(state.nightActions.witchActions)[0];
    if (witchAction?.type === "heal" && resolution.healed) state.witchHealAvailable = false;
    if (witchAction?.type === "poison") state.witchPoisonAvailable = false;
    for (const [guardId, targetId] of Object.entries(state.nightActions.guardTargets)) {
      state.guardLastTargets[guardId] = targetId;
    }

    state.lastNightDeaths = resolution.deaths;
    for (const id of resolution.deaths) {
      const player = state.players.find((p) => p.id === id);
      if (player) player.alive = false;
    }

    const winner = checkWinner(state.players);
    if (winner) {
      this.endGame(state, winner);
      return;
    }

    state.nightActions = freshNightActions();
    state.votes = {};
    if (state.lastNightDeaths.length === 0) {
      this.addSystemMessage(state, `第 ${state.round} 天早晨：昨夜是平安夜。`);
    } else {
      const names = state.lastNightDeaths.map((id) => state.players.find((p) => p.id === id)?.name ?? "未知玩家");
      this.addSystemMessage(state, `第 ${state.round} 天早晨：${names.join("、")} 昨夜死亡。`);
    }
    this.beginDebate(state);
  }

  private beginDebate(state: GameState): void {
    state.phase = "debate";
    state.debateOrder = createDebateOrder(state.players);
    state.debateIndex = 0;
    state.debateCompleted = [];
    const names = state.debateOrder.map((id) => state.players.find((p) => p.id === id)?.name ?? "未知玩家");
    this.addSystemMessage(state, `本日進入依序辯論。發言順序：${names.join(" → ")}。所有存活玩家完成發言後才會開放放逐票。`);
    this.touchAndSave(state);
    this.broadcast(state);
    this.ctx.waitUntil(this.runAIDebateTurns());
  }

  private recordDebateSpeech(state: GameState, actor: Player, text: string): void {
    state.messages.push(this.speechMessage(state, actor, text));
    state.debateCompleted.push(actor.id);
    state.debateIndex += 1;
    this.trimMessages(state);
  }

  private enterVote(state: GameState): void {
    state.phase = "vote";
    state.votes = {};
    this.addSystemMessage(state, "本輪所有存活玩家已完成正式發言，現在進入放逐投票。平票則本輪無人出局。AI 在仍有真人存活時不會搶先投第一票。 ");
    this.touchAndSave(state);
    this.broadcast(state);
    this.ctx.waitUntil(this.runAIVotes());
  }

  private finishVote(state: GameState): void {
    const eliminatedId = pluralityTarget(state.votes);
    if (eliminatedId) {
      state.lastVoteEliminated = eliminatedId;
      const player = state.players.find((p) => p.id === eliminatedId);
      if (player) {
        player.alive = false;
        this.addSystemMessage(state, `${player.name} 經辯論後被放逐出局。`);
      }
    } else {
      delete state.lastVoteEliminated;
      this.addSystemMessage(state, "本輪投票平票，無人被放逐。 ");
    }

    const winner = checkWinner(state.players);
    if (winner) {
      this.endGame(state, winner);
      return;
    }

    state.phase = "night";
    state.round += 1;
    state.votes = {};
    state.nightActions = freshNightActions();
    state.debateOrder = [];
    state.debateIndex = 0;
    state.debateCompleted = [];
    state.lastNightDeaths = [];
    this.addSystemMessage(state, `第 ${state.round} 夜開始。天黑請閉眼。`);
    this.touchAndSave(state);
    this.broadcast(state);
    this.ctx.waitUntil(this.runAINightActions());
  }

  private endGame(state: GameState, winner: "werewolf" | "village"): void {
    state.phase = "ended";
    state.winner = winner;
    const label = winner === "werewolf" ? "狼人陣營" : "村民陣營";
    this.addSystemMessage(state, `遊戲結束：${label}獲勝。`);
    this.touchAndSave(state);
    this.broadcast(state);
  }

  private async runAINightActions(): Promise<void> {
    for (;;) {
      const state = this.requireState();
      if (state.phase !== "night") return;
      const actor = state.players.find((p) => p.isAI && p.alive && p.role && this.needsNightAction(state, p));
      if (!actor?.role) return;
      const action = await this.decideAINightAction(state, actor);
      const fresh = this.requireState();
      if (fresh.phase !== "night") return;
      const currentActor = fresh.players.find((p) => p.id === actor.id && p.alive);
      if (!currentActor?.role || !this.needsNightAction(fresh, currentActor)) continue;
      this.applyNightAction(fresh, currentActor, action);
      this.touchAndSave(fresh);
      this.broadcast(fresh);
      if (areNightActionsComplete(fresh)) {
        this.finishNight(fresh);
        return;
      }
    }
  }

  private async runAIDebateTurns(): Promise<void> {
    for (;;) {
      const state = this.requireState();
      if (state.phase !== "debate") return;
      if (isDebateComplete(state.debateOrder, state.debateIndex)) {
        this.enterVote(state);
        return;
      }
      const currentId = currentDebaterId(state.debateOrder, state.debateIndex);
      const actor = state.players.find((p) => p.id === currentId && p.alive);
      if (!actor) {
        state.debateIndex += 1;
        this.touchAndSave(state);
        continue;
      }
      if (!actor.isAI) return;

      const message = await this.decideAIDebateMessage(state, actor);
      const fresh = this.requireState();
      if (fresh.phase !== "debate") return;
      const freshCurrentId = currentDebaterId(fresh.debateOrder, fresh.debateIndex);
      const current = fresh.players.find((p) => p.id === actor.id && p.alive && p.isAI);
      if (!current || freshCurrentId !== current.id) continue;
      this.recordDebateSpeech(fresh, current, message);
      if (isDebateComplete(fresh.debateOrder, fresh.debateIndex)) {
        this.enterVote(fresh);
        return;
      }
      this.touchAndSave(fresh);
      this.broadcast(fresh);
    }
  }

  private async runAIVotes(): Promise<void> {
    for (;;) {
      const state = this.requireState();
      if (state.phase !== "vote") return;
      if (!isAIVotingUnlocked(state.players, state.votes)) return;
      const actor = state.players.find((p) => p.isAI && p.alive && !state.votes[p.id]);
      if (!actor) return;
      const targetId = await this.decideAIVote(state, actor);
      const fresh = this.requireState();
      if (fresh.phase !== "vote" || !isAIVotingUnlocked(fresh.players, fresh.votes)) return;
      const current = fresh.players.find((p) => p.id === actor.id && p.alive && p.isAI);
      const target = fresh.players.find((p) => p.id === targetId && p.alive && p.id !== actor.id);
      if (!current || !target || fresh.votes[current.id]) continue;
      fresh.votes[current.id] = target.id;
      this.touchAndSave(fresh);
      this.broadcast(fresh);
      if (areVotesComplete(fresh)) {
        this.finishVote(fresh);
        return;
      }
    }
  }

  private async decideAIDebateMessage(state: GameState, actor: Player): Promise<string> {
    const fallback = `我先依照目前公開資訊整理：昨夜結果與前面發言都要一起看，暫時保留一到兩個可疑位，等票型再驗證，不會只因跟風就直接定狼。`;
    if (!actor.ai || !actor.role) return fallback;
    const system = this.aiSystemPrompt(actor, state);
    const priorSpeeches = state.messages
      .filter((m) => m.round === state.round && m.phase === "debate" && m.kind === "speech")
      .slice(-12)
      .map((m) => `${m.playerName}: ${m.content}`)
      .join("\n");
    const prompt = `${this.privateContext(state, actor)}\n\n本輪已發言內容：\n${priorSpeeches || "你是本輪第一位發言者。"}\n\n現在輪到你進行正式辯論發言。請回傳 JSON：{"message":"80~180 字繁體中文發言"}。發言至少要包含：一個可驗證的推理依據、一個目前站邊或懷疑方向；要回應前面玩家的邏輯（若已有發言），不能只喊『我投某人』或無理由跟票。`;
    try {
      const result = await callAI(this.env, { config: actor.ai, system, prompt });
      const parsed = parseJSONObject(result.text) as AIJSON;
      return typeof parsed.message === "string" && parsed.message.trim() ? this.normalizeSpeech(parsed.message) : fallback;
    } catch (error) {
      this.logAIError(actor, "debate_speech", error);
      return fallback;
    }
  }

  private async decideAIVote(state: GameState, actor: Player): Promise<string> {
    const candidates = state.players.filter((p) => p.alive && p.id !== actor.id);
    const fallback = this.fallbackTarget(candidates, actor, state.round);
    if (!actor.ai || !actor.role) return fallback;
    const system = this.aiSystemPrompt(actor, state);
    const prompt = `${this.privateContext(state, actor)}\n\n辯論已結束。候選：${candidates.map((p) => `${p.id}=${p.name}`).join(", ")}。請根據公開發言、夜間結果與你合法知道的私密資訊做一致的陣營策略，只回傳 JSON：{"targetId":"玩家ID"}。`;
    try {
      const result = await callAI(this.env, { config: actor.ai, system, prompt });
      const parsed = parseJSONObject(result.text) as AIJSON;
      const targetId = typeof parsed.targetId === "string" ? parsed.targetId : "";
      return candidates.some((p) => p.id === targetId) ? targetId : fallback;
    } catch (error) {
      this.logAIError(actor, "vote", error);
      return fallback;
    }
  }

  private async decideAINightAction(state: GameState, actor: Player): Promise<NightClientAction> {
    if (!actor.role) throw new Error("AI 身份不存在");
    if (actor.role === "witch") return this.decideAIWitchAction(state, actor);

    const candidates = this.nightCandidates(state, actor);
    const fallbackTarget = this.fallbackTarget(candidates, actor, state.round);
    const fallback = this.roleAction(actor.role, fallbackTarget);
    if (!actor.ai) return fallback;

    const system = this.aiSystemPrompt(actor, state);
    const prompt = `${this.privateContext(state, actor)}\n\n夜晚合法目標：${candidates.map((p) => `${p.id}=${p.name}`).join(", ")}。請只回傳 JSON：{"targetId":"玩家ID"}。`;
    try {
      const result = await callAI(this.env, { config: actor.ai, system, prompt });
      const parsed = parseJSONObject(result.text) as AIJSON;
      const targetId = typeof parsed.targetId === "string" ? parsed.targetId : "";
      const valid = candidates.some((p) => p.id === targetId) ? targetId : fallbackTarget;
      return this.roleAction(actor.role, valid);
    } catch (error) {
      this.logAIError(actor, "night_action", error);
      return fallback;
    }
  }

  private async decideAIWitchAction(state: GameState, actor: Player): Promise<NightClientAction> {
    const victim = this.witchKnownVictim(state);
    const maySelfSave = victim !== actor.id || canWitchSelfSave(state.players.length, state.round);
    const canHeal = Boolean(victim && state.witchHealAvailable && maySelfSave);
    const poisonCandidates = state.players.filter((p) => p.alive && p.id !== actor.id);
    const fallbackAction: WitchAction = canHeal ? { type: "heal" } : { type: "pass" };
    if (!actor.ai) return { kind: "witch", action: fallbackAction };
    const system = this.aiSystemPrompt(actor, state);
    const prompt = `${this.privateContext(state, actor)}\n\n狼人目前確定的擊殺目標：${victim ?? "無或尚未確定"}。解藥：${state.witchHealAvailable ? "可用" : "已用"}；本次是否允許救此目標：${canHeal ? "是" : "否"}；毒藥：${state.witchPoisonAvailable ? "可用" : "已用"}。可毒目標：${poisonCandidates.map((p) => `${p.id}=${p.name}`).join(", ")}。只回傳 JSON，三選一：{"action":"heal"}、{"action":"poison","targetId":"玩家ID"}、{"action":"pass"}。`;
    try {
      const result = await callAI(this.env, { config: actor.ai, system, prompt });
      const parsed = parseJSONObject(result.text) as AIJSON;
      if (parsed.action === "heal" && canHeal) return { kind: "witch", action: { type: "heal" } };
      if (parsed.action === "poison" && state.witchPoisonAvailable && typeof parsed.targetId === "string" && poisonCandidates.some((p) => p.id === parsed.targetId)) {
        return { kind: "witch", action: { type: "poison", targetId: parsed.targetId } };
      }
      return { kind: "witch", action: { type: "pass" } };
    } catch (error) {
      this.logAIError(actor, "witch_action", error);
      return { kind: "witch", action: fallbackAction };
    }
  }

  private roleAction(role: Role, targetId: string): NightClientAction {
    if (role === "werewolf") return { kind: "werewolf", targetId };
    if (role === "seer") return { kind: "seer", targetId };
    if (role === "guard") return { kind: "guard", targetId };
    throw new Error(`身份 ${role} 沒有目標型夜晚技能`);
  }

  private nightCandidates(state: GameState, actor: Player): Player[] {
    if (actor.role === "werewolf") return state.players.filter((p) => p.alive && p.id !== actor.id && p.role !== "werewolf");
    if (actor.role === "seer") return state.players.filter((p) => p.alive && p.id !== actor.id);
    if (actor.role === "guard") return state.players.filter((p) => p.alive && canGuardTarget(state.guardLastTargets[actor.id], p.id));
    return [];
  }

  private needsNightAction(state: GameState, player: Player): boolean {
    if (player.role === "werewolf") return !state.nightActions.wolfVotes[player.id];
    if (player.role === "seer") return !state.nightActions.seerTargets[player.id];
    if (player.role === "guard") return !state.nightActions.guardTargets[player.id];
    if (player.role === "witch") {
      const wolves = state.players.filter((p) => p.alive && p.role === "werewolf");
      const wolvesReady = wolves.every((p) => Boolean(state.nightActions.wolfVotes[p.id]));
      return wolvesReady && !state.nightActions.witchActions[player.id];
    }
    return false;
  }

  private aiSystemPrompt(actor: Player, state: GameState): string {
    const teammates = actor.role === "werewolf"
      ? state.players.filter((p) => p.alive && p.role === "werewolf").map((p) => p.name).join("、")
      : "無";
    const seer = actor.role === "seer" ? JSON.stringify(state.seerResults[actor.id] ?? {}) : "{}";
    return [
      "你正在進行繁體中文『辯論式狼人殺』。你是玩家，不是主持人。",
      "這不是暴民式或即時 PvP：白天必須依照發言順位，以公開資訊、前後矛盾、站邊、夜間死亡與票型進行推理。",
      `你的名字：${actor.name}。你的身份：${actor.role ?? "未知"}。`,
      `狼人隊友（只有你是狼人時才可信）：${teammates}。`,
      `你的預言家查驗紀錄（只有你是預言家時才可信）：${seer}。`,
      "不得捏造不存在的系統規則，不得要求或輸出 API Key。",
      "公開發言可以策略性跳身份，但不能聲稱看過你依法不可能取得的伺服器私密資訊。",
      "每次正式發言要有推理依據與可被其他玩家反駁的判斷；不要無理由跟票。",
      "你的目標是協助自己的陣營獲勝。"
    ].join("\n");
  }

  private publicContext(state: GameState): string {
    const players = state.players.map((p) => `${p.id}=${p.name}[${p.alive ? "存活" : "出局"}${p.isAI ? ",AI" : ",真人"}]`).join(", ");
    const logs = state.messages.slice(-36).map((m) => `${m.playerName}: ${m.content}`).join("\n");
    const order = state.debateOrder.map((id) => state.players.find((p) => p.id === id)?.name ?? id).join(" → ");
    return `目前第 ${state.round} 輪，階段=${state.phase}。\n玩家：${players}\n本輪辯論順序：${order || "尚未建立"}\n公開紀錄：\n${logs}`;
  }

  private privateContext(state: GameState, actor: Player): string {
    return `${this.publicContext(state)}\n你的身份=${actor.role ?? "未知"}。`;
  }

  private projectState(state: GameState, token: string): PrivateView {
    const me = this.playerByToken(state, token);
    const players: PublicPlayer[] = state.players.map((p) => {
      const publicPlayer: PublicPlayer = {
        id: p.id,
        name: p.name,
        alive: p.alive,
        isAI: p.isAI,
        isHost: p.id === state.hostPlayerId
      };
      if (p.isAI && p.ai) publicPlayer.ai = p.ai;
      if (state.phase === "ended" && p.role) publicPlayer.role = p.role;
      return publicPlayer;
    });
    const privateMe: PrivateView["me"] = {
      id: me.id,
      name: me.name,
      alive: me.alive,
      isHost: me.id === state.hostPlayerId
    };
    if (state.phase !== "lobby" && me.role) privateMe.role = me.role;
    if (me.role === "werewolf") privateMe.wolfTeammates = state.players.filter((p) => p.role === "werewolf" && p.id !== me.id).map((p) => p.id);
    if (me.role === "seer") privateMe.seerResults = state.seerResults[me.id] ?? {};
    if (me.role === "guard") {
      const lastGuardTarget = state.guardLastTargets[me.id];
      if (lastGuardTarget) privateMe.guardLastTarget = lastGuardTarget;
    }
    if (me.role === "witch") {
      privateMe.witchHealAvailable = state.witchHealAvailable;
      privateMe.witchPoisonAvailable = state.witchPoisonAvailable;
      const victim = this.witchKnownVictim(state);
      if (victim) {
        privateMe.witchKnownVictim = victim;
        privateMe.witchCanHealKnownVictim = state.witchHealAvailable && (victim !== me.id || canWitchSelfSave(state.players.length, state.round));
      }
    }
    const result: PrivateView = {
      roomId: state.roomId,
      phase: state.phase,
      round: state.round,
      maxPlayers: state.maxPlayers,
      players,
      messages: state.messages,
      me: privateMe,
      votesCast: Object.keys(state.votes),
      nightSubmitted: this.nightSubmittedPlayers(state),
      debateOrder: state.debateOrder,
      debateIndex: state.debateIndex,
      debateCompleted: state.debateCompleted,
      aiVotingUnlocked: isAIVotingUnlocked(state.players, state.votes),
      lastNightDeaths: state.lastNightDeaths
    };
    const currentSpeakerId = currentDebaterId(state.debateOrder, state.debateIndex);
    if (currentSpeakerId) result.currentSpeakerId = currentSpeakerId;
    if (state.lastVoteEliminated) result.lastVoteEliminated = state.lastVoteEliminated;
    if (state.winner) result.winner = state.winner;
    return result;
  }

  private nightSubmittedPlayers(state: GameState): string[] {
    return [...new Set([
      ...Object.keys(state.nightActions.wolfVotes),
      ...Object.keys(state.nightActions.seerTargets),
      ...Object.keys(state.nightActions.guardTargets),
      ...Object.keys(state.nightActions.witchActions)
    ])];
  }

  private witchKnownVictim(state: GameState): string | undefined {
    const livingWolves = state.players.filter((p) => p.alive && p.role === "werewolf");
    if (!livingWolves.every((p) => Boolean(state.nightActions.wolfVotes[p.id]))) return undefined;
    return pluralityTarget(state.nightActions.wolfVotes);
  }

  private fallbackTarget(candidates: Player[], actor: Player, round: number): string {
    if (candidates.length === 0) throw new Error("沒有合法目標");
    const sorted = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
    const seed = [...actor.id].reduce((sum, ch) => sum + ch.charCodeAt(0), round);
    return sorted[seed % sorted.length]!.id;
  }

  private normalizeSpeech(content: string): string {
    const text = content.trim().replace(/\s+/g, " ").slice(0, 700);
    if (text.length < 2) throw new Error("正式發言至少需要 2 個字元");
    return text;
  }

  private logAIError(actor: Player, operation: string, error: unknown): void {
    console.warn(JSON.stringify({
      event: "ai_fallback",
      playerId: actor.id,
      provider: actor.ai?.provider ?? "none",
      model: actor.ai?.model ?? "none",
      operation,
      error: error instanceof Error ? error.message.slice(0, 300) : "unknown"
    }));
  }

  private validateAIConfig(ai: AIConfig): void {
    const allowed = new Set(["openai", "gemini", "deepseek", "openai-compatible"]);
    if (!allowed.has(ai.provider)) throw new Error("AI provider 無效");
    if (!ai.model.trim() || ai.model.length > 120) throw new Error("AI model 無效");
  }

  private newPlayer(name: string, isAI: boolean, ai?: AIConfig): Player {
    const player: Player = {
      id: crypto.randomUUID(),
      token: randomToken(),
      name: name.trim().slice(0, 24),
      alive: true,
      isAI,
      joinedAt: Date.now()
    };
    if (ai) player.ai = ai;
    return player;
  }

  private playerByToken(state: GameState, token: string): Player {
    const player = state.players.find((p) => secureEqual(p.token, token));
    if (!player) throw new Error("玩家憑證無效，請重新加入房間");
    return player;
  }

  private assertHost(state: GameState, token: string): void {
    const player = this.playerByToken(state, token);
    if (player.id !== state.hostPlayerId) throw new Error("只有房主可以執行此操作");
  }

  private assertLobby(state: GameState): void {
    if (state.phase !== "lobby") throw new Error("遊戲已經開始");
  }

  private assertPlayerName(state: GameState, raw: string): void {
    const name = raw.trim();
    if (name.length < 1 || name.length > 24) throw new Error("玩家名稱需為 1–24 字元");
    if (state.players.some((p) => p.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("玩家名稱已被使用");
  }

  private addSystemMessage(state: GameState, content: string): void {
    state.messages.push({
      id: crypto.randomUUID(),
      playerName: "系統",
      content,
      kind: "system",
      createdAt: Date.now(),
      round: state.round,
      phase: state.phase
    });
    this.trimMessages(state);
  }

  private speechMessage(state: GameState, player: Player, content: string): ChatMessage {
    return {
      id: crypto.randomUUID(),
      playerId: player.id,
      playerName: player.name,
      content,
      kind: "speech",
      createdAt: Date.now(),
      round: state.round,
      phase: state.phase
    };
  }

  private trimMessages(state: GameState): void {
    if (state.messages.length > 240) state.messages = state.messages.slice(-240);
  }

  private broadcast(state: GameState): void {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment<SocketAttachment>();
      if (!attachment) continue;
      try {
        const payload: ServerMessage = { type: "state", state: this.projectState(state, attachment.token) };
        ws.send(JSON.stringify(payload));
      } catch {
        ws.close(1008, "Invalid session");
      }
    }
  }

  private loadState(): GameState | undefined {
    if (this.stateCache) return this.stateCache;
    const rows = this.ctx.storage.sql.exec<{ json: string }>("SELECT json FROM room_state WHERE key = 'state'").toArray();
    const row = rows[0];
    if (!row) return undefined;
    const parsed = JSON.parse(row.json) as GameState;
    this.stateCache = parsed;
    return parsed;
  }

  private requireState(): GameState {
    const state = this.loadState();
    if (!state) throw new Error("房間不存在");
    return state;
  }

  private saveState(state: GameState): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO room_state (key, json) VALUES ('state', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json",
      JSON.stringify(state)
    );
    this.stateCache = state;
  }

  private touchAndSave(state: GameState): void {
    state.updatedAt = Date.now();
    this.saveState(state);
  }
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function secureEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

function assertNever(value: never): never {
  throw new Error(`未處理的操作: ${JSON.stringify(value)}`);
}
