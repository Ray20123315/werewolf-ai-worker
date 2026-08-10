import { callAIWithKeys, parseJSONObject } from "./ai.js";
import { areVotesComplete, livingPlayers, playerFaction, sheriffSecondVoteKey } from "./game-engine.js";
import type { ChatMessage, GameState, Player } from "./types.js";

type RuntimeMessage = ChatMessage & { channel?: "public" | "werewolf" | "lovers"; audienceIds?: string[] };
type RoomPrototype = Record<string, any> & { __houseRulesInstalled?: boolean };
type WinConditionMode = "slaughter_edge" | "slaughter_all";

const MAX_PUBLIC_AI_REPLIES_PER_DAY = 2;
const MAX_WOLF_AI_MESSAGES_PER_NIGHT = 2;
const PUBLIC_CONTEXT_MESSAGES = 18;
const WOLF_LEADER_PRIORITY: Record<string, number> = {
  black_wolf_king: 0,
  white_wolf_king: 1,
  great_wolf: 2,
  werewolf: 3
};

export function installHouseRules(GameRoomCtor: { prototype: RoomPrototype }): void {
  const proto = GameRoomCtor.prototype;
  if (proto.__houseRulesInstalled) return;
  proto.__houseRulesInstalled = true;

  const originalRequireState = proto.requireState;
  const originalConfigureSettings = proto.configureSettings;
  const originalEnterNight = proto.enterNight;
  const originalParticipatesWolfVote = proto.participatesWolfVote;
  const originalFirstLivingWolfId = proto.firstLivingWolfId;
  const originalCastVoteById = proto.castVoteById;
  const originalPendingAITask = proto.pendingAITask;
  const originalRunAI = proto.runAI;
  const originalPublicContext = proto.publicContext;
  const originalProjectState = proto.projectState;
  const originalHandleClientMessage = proto.handleClientMessage;

  proto.requireState = function (): GameState {
    const state = originalRequireState.call(this) as GameState;
    ensureWinCondition(state);
    markWinCondition(state);
    return state;
  };

  proto.configureSettings = function (token: string, raw: Record<string, unknown>): void {
    originalConfigureSettings.call(this, token, raw);
    if (raw?.winCondition === "slaughter_edge" || raw?.winCondition === "slaughter_all") {
      const state = this.requireState() as GameState;
      (state.settings as any).winCondition = raw.winCondition;
      markWinCondition(state);
      this.saveBroadcast(state);
    }
  };

  proto.enterNight = function (state: GameState, round: number): void {
    ensureWinCondition(state);
    markWinCondition(state);
    const system = this.systemMem(state) as Record<string, unknown>;
    system.wolfLeaderId = chooseWolfLeader(this, state, originalParticipatesWolfVote);
    system.aiWolfChatRound = round;
    system.aiWolfChatCount = 0;
    system.aiWolfChatActors = [];
    system.aiFreeChatRound = round;
    system.aiFreeChatCount = 0;
    system.aiFreeChatActors = [];
    delete system.aiFreeChatPlayerId;
    return originalEnterNight.call(this, state, round);
  };

  proto.participatesWolfVote = function (state: GameState, actor: Player): boolean {
    if (!originalParticipatesWolfVote.call(this, state, actor)) return false;
    const system = this.systemMem(state) as Record<string, unknown>;
    let leaderId = typeof system.wolfLeaderId === "string" ? system.wolfLeaderId : undefined;
    if (!leaderId || !state.players.some((p) => p.id === leaderId && p.alive && !p.isSpectator)) {
      leaderId = chooseWolfLeader(this, state, originalParticipatesWolfVote);
      system.wolfLeaderId = leaderId;
    }
    return Boolean(leaderId && actor.id === leaderId);
  };

  proto.firstLivingWolfId = function (state: GameState): string | undefined {
    const leaderId = (this.systemMem(state) as Record<string, unknown>).wolfLeaderId;
    if (typeof leaderId === "string" && state.players.some((p) => p.id === leaderId && p.alive && !p.isSpectator)) return leaderId;
    return originalFirstLivingWolfId.call(this, state);
  };

  proto.castVoteById = function (state: GameState, voterId: string, rawTargetId: string): void {
    const voter = state.players.find((p) => p.id === voterId && p.alive && !p.isSpectator);
    const isSheriff = voter?.id === state.sheriff.sheriffId;
    if (!isSheriff) return originalCastVoteById.call(this, state, voterId, rawTargetId);

    const [firstId, encodedSecond] = String(rawTargetId).split("|", 2);
    const secondId = encodedSecond || firstId;
    if (!firstId || !secondId) throw new Error("警長兩張票都需要合法目標");
    validateSheriffVoteTarget(this, state, voter!, firstId);
    validateSheriffVoteTarget(this, state, voter!, secondId);

    const secondKey = sheriffSecondVoteKey(voterId);
    delete state.votes[secondKey];
    originalCastVoteById.call(this, state, voterId, firstId);
    state.votes[secondKey] = secondId;

    if (areVotesComplete(state)) this.finishVote(state);
    else this.saveBroadcast(state);
  };

  proto.decideAIVote = async function (state: GameState, actor: Player, apiKeys: string[]): Promise<string> {
    let candidates = livingPlayers(state.players).filter((p) => p.id !== actor.id);
    const pkCandidates = this.asStringArray((this.systemMem(state) as Record<string, unknown>).pkVoteCandidates) as string[];
    if (pkCandidates.length) candidates = candidates.filter((p) => pkCandidates.includes(p.id));
    if (!candidates.length) throw new Error("AI 沒有合法投票目標");

    if (state.sheriff.sheriffId !== actor.id) return this.decideAITarget(state, actor, apiKeys, candidates);
    if (!actor.ai) throw new Error("AI 設定不存在");

    const result = await callAIWithKeys(apiKeys, {
      config: actor.ai,
      system: this.aiSystemPrompt(actor, state),
      prompt: `${this.privateContext(state, actor)}\n\n你是警長，有兩張獨立放逐票，可同投一人或拆投兩人。合法目標：${candidates.map((p) => `${p.id}=${p.name}`).join(", ")}。只回傳 JSON：{"targetIds":["玩家ID1","玩家ID2"]}。`
    });
    const parsed = parseJSONObject(result.text) as Record<string, unknown>;
    const ids = Array.isArray(parsed.targetIds) ? parsed.targetIds.filter((id): id is string => typeof id === "string") : [];
    const first = candidates.some((p) => p.id === ids[0]) ? ids[0]! : candidates[0]!.id;
    const second = candidates.some((p) => p.id === ids[1]) ? ids[1]! : (candidates[1]?.id ?? first);
    return `${first}|${second}`;
  };

  proto.pendingAITask = function (state: GameState): any {
    if (state.phase === "night") {
      const wolfChat = nextWolfChatAI(this, state);
      if (wolfChat) return { playerId: wolfChat.id, operation: "wolf_chat" };
    }

    const base = originalPendingAITask.call(this, state);
    if (base) return base;

    if (state.phase === "debate") {
      const system = this.systemMem(state) as Record<string, unknown>;
      const queued = typeof system.aiFreeChatPlayerId === "string" ? system.aiFreeChatPlayerId : undefined;
      const actor = queued ? state.players.find((p) => p.id === queued && p.isAI && p.alive && !p.isSpectator) : undefined;
      if (actor) return { playerId: actor.id, operation: "free_chat" };
      delete system.aiFreeChatPlayerId;
    }
    return undefined;
  };

  proto.runAI = async function (hostToken: string, playerId: string, apiKeys: string[]): Promise<{ ok: true }> {
    const state = this.requireState() as GameState;
    this.assertHost(state, hostToken);
    const task = this.pendingAITask(state);
    if (!task || task.playerId !== playerId) throw new Error("此 AI 目前沒有待執行操作");
    if (task.operation !== "free_chat" && task.operation !== "wolf_chat") return originalRunAI.call(this, hostToken, playerId, apiKeys);

    const actor = state.players.find((p) => p.id === playerId && p.isAI && p.alive && !p.isSpectator);
    if (!actor?.ai) throw new Error("AI 玩家狀態無效");

    const wolfChat = task.operation === "wolf_chat";
    const result = await callAIWithKeys(apiKeys, {
      config: actor.ai,
      system: this.aiSystemPrompt(actor, state),
      prompt: wolfChat
        ? `${this.privateContext(state, actor)}\n\n現在是狼人夜間短討論。用 20~55 個繁體中文字，對狼隊提出一個簡短判斷或刀人建議；不要重述規則。只回傳 JSON：{"message":"內容"}。`
        : `${this.privateContext(state, actor)}\n\n現在不是你的正式發言，只做一次簡短公開互動。用 20~65 個繁體中文字回應最新公開討論，提出一個有理由的觀察；不要搶主持流程。只回傳 JSON：{"message":"內容"}。`
    });
    const parsed = parseJSONObject(result.text) as Record<string, unknown>;
    const fallback = wolfChat ? "我先看前面資訊與身分風險，狼刀建議集中，不要把隊友關係聊得太明顯。" : "我先記這個說法，等等會對照票型和前後矛盾再判斷。";
    const content = typeof parsed.message === "string" && parsed.message.trim() ? this.normalizeChat(parsed.message) : fallback;
    const message = this.chatMessage(state, actor, content) as RuntimeMessage;

    const system = this.systemMem(state) as Record<string, unknown>;
    if (wolfChat) {
      const audience = [actor.id, ...(this.wolfTeammates(state, actor) as Player[]).map((p) => p.id)];
      if (audience.length < 2) throw new Error("目前沒有可用的狼人秘密聊天室");
      message.channel = "werewolf";
      message.audienceIds = audience;
      const actors = asStringArray(system.aiWolfChatActors);
      if (!actors.includes(actor.id)) actors.push(actor.id);
      system.aiWolfChatActors = actors;
      system.aiWolfChatCount = Number(system.aiWolfChatCount ?? 0) + 1;
    } else {
      delete system.aiFreeChatPlayerId;
      const actors = asStringArray(system.aiFreeChatActors);
      if (!actors.includes(actor.id)) actors.push(actor.id);
      system.aiFreeChatActors = actors;
      system.aiFreeChatCount = Number(system.aiFreeChatCount ?? 0) + 1;
    }

    state.messages.push(message);
    this.trimMessages(state);
    this.touchAndSave(state);
    this.broadcast(state);
    return { ok: true };
  };

  proto.publicContext = function (state: GameState): string {
    const allMessages = state.messages;
    state.messages = allMessages.slice(-PUBLIC_CONTEXT_MESSAGES);
    try {
      return originalPublicContext.call(this, state);
    } finally {
      state.messages = allMessages;
    }
  };

  proto.projectState = function (state: GameState, token: string): any {
    ensureWinCondition(state);
    markWinCondition(state);
    const view = originalProjectState.call(this, state, token);
    view.settings.winCondition = (state.settings as any).winCondition;
    const me = this.playerByToken(state, token) as Player;
    if (playerFaction(me) === "werewolf") {
      const leaderId = (this.systemMem(state) as Record<string, unknown>).wolfLeaderId;
      if (typeof leaderId === "string") view.me.wolfLeaderId = leaderId;
    }
    return view;
  };

  proto.handleClientMessage = async function (token: string, command: any): Promise<void> {
    const before = this.requireState() as GameState;
    const actor = this.playerByToken(before, token) as Player;
    await originalHandleClientMessage.call(this, token, command);
    if (command?.type !== "chat" || (command.channel && command.channel !== "public") || actor.isAI) return;

    const state = this.requireState() as GameState;
    if (state.phase !== "debate" || !actor.alive || actor.isSpectator) return;
    const system = this.systemMem(state) as Record<string, unknown>;
    const count = Number(system.aiFreeChatCount ?? 0);
    if (count >= MAX_PUBLIC_AI_REPLIES_PER_DAY || typeof system.aiFreeChatPlayerId === "string") return;
    const used = new Set(asStringArray(system.aiFreeChatActors));
    const candidates = livingPlayers(state.players).filter((p) => p.isAI && p.ai && !used.has(p.id));
    const next = candidates[0];
    if (!next) return;
    system.aiFreeChatPlayerId = next.id;
    this.saveBroadcast(state);
  };
}

function ensureWinCondition(state: GameState): void {
  const settings = state.settings as any;
  if (settings.winCondition !== "slaughter_edge" && settings.winCondition !== "slaughter_all") settings.winCondition = "slaughter_edge";
}

function markWinCondition(state: GameState): void {
  (state.players as any).__winConditionMode = (state.settings as any).winCondition as WinConditionMode;
}

function chooseWolfLeader(room: any, state: GameState, baseParticipates: Function): string | undefined {
  const candidates = livingPlayers(state.players)
    .filter((player) => baseParticipates.call(room, state, player))
    .sort((a, b) => (WOLF_LEADER_PRIORITY[a.role ?? ""] ?? 10) - (WOLF_LEADER_PRIORITY[b.role ?? ""] ?? 10) || a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
  return candidates[0]?.id;
}

function validateSheriffVoteTarget(room: any, state: GameState, voter: Player, targetId: string): void {
  const target = state.players.find((p) => p.id === targetId && p.alive && !p.isSpectator);
  if (!target || target.id === voter.id) throw new Error("警長放逐票目標無效");
  const pkCandidates = room.asStringArray((room.systemMem(state) as Record<string, unknown>).pkVoteCandidates) as string[];
  if (pkCandidates.length && !pkCandidates.includes(targetId)) throw new Error("PK 重投只能投給平票候選人");
}

function nextWolfChatAI(room: any, state: GameState): Player | undefined {
  const system = room.systemMem(state) as Record<string, unknown>;
  if (Number(system.aiWolfChatRound ?? 0) !== state.round) return undefined;
  if (Number(system.aiWolfChatCount ?? 0) >= MAX_WOLF_AI_MESSAGES_PER_NIGHT) return undefined;
  const used = new Set(asStringArray(system.aiWolfChatActors));
  return livingPlayers(state.players).find((p) => p.isAI && p.ai && playerFaction(p) === "werewolf" && !used.has(p.id) && (room.wolfTeammates(state, p) as Player[]).length > 0);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
