import { callAIWithKeys, parseJSONObject } from "./ai.js";
import { captureAITaskContext, isCurrentAITask } from "./ai-task-freshness.js";
import type { AITaskContext } from "./ai-task-freshness.js";
import { playerFaction, roleActionPrompt, secureShuffle } from "./game-engine.js";
import { coreWinner, DEFAULT_PHASE_SECONDS, formalLiving } from "./core-state.js";
import type { RuntimeSettings } from "./core-state.js";
import { availableUnlinkedLoverTargets, effectiveLoverGroupSize } from "./core-relationships.js";
import type { ChatMessage, GameState, Player, RoleActionSubmission } from "./types.js";

type RoomPrototype = Record<string, any> & { __corePhaseAIRulesInstalled?: boolean };
type RuntimeAITask = { playerId: string; operation: string };
type RuntimeMessage = ChatMessage & { channel?: "public" | "werewolf" | "lovers"; audienceIds?: string[] };
const COUNCIL_OPERATION = "core_wolf_council";

export function installCorePhaseAIRules(GameRoomCtor: { prototype: RoomPrototype }): void {
  const proto = GameRoomCtor.prototype;
  if (proto.__corePhaseAIRulesInstalled) return;
  proto.__corePhaseAIRulesInstalled = true;

  const originalRequireState = proto.requireState;
  const originalResetGame = proto.resetGame;
  const originalEnterNight = proto.enterNight;
  const originalBeginDebate = proto.beginDebate;
  const originalEnterVote = proto.enterVote;
  const originalEndGame = proto.endGame;
  const originalProjectState = proto.projectState;
  const originalHandleClientMessage = proto.handleClientMessage;
  const originalPendingAITask = proto.pendingAITask;
  const originalRunAI = proto.runAI;
  const originalDecideAIVote = proto.decideAIVote;

  proto.requireState = function (): GameState {
    const state = originalRequireState.call(this) as GameState;
    if (state?.settings && state.roleMemory && ["night", "debate", "vote"].includes(state.phase) && !phaseDeadline(state)) {
      setPhaseDeadline(this, state, state.phase === "night" ? "night" : "day");
    }
    return state;
  };

  if (typeof originalResetGame === "function") {
    proto.resetGame = function (token: string): void {
      const result = originalResetGame.call(this, token);
      const state = this.requireState() as GameState;
      clearPhaseDeadline(this, state);
      return result;
    };
  }

  if (typeof originalEnterNight === "function") {
    proto.enterNight = function (state: GameState, round: number): void {
      const result = originalEnterNight.call(this, state, round);
      if (state.phase === "night") {
        resetWolfCouncil(this, state);
        setPhaseDeadline(this, state, "night");
      }
      return result;
    };
  }

  if (typeof originalBeginDebate === "function") {
    proto.beginDebate = function (state: GameState): void {
      if (finishByCoreWinner(this, state)) return;
      const result = originalBeginDebate.call(this, state);
      if (state.phase === "debate") setPhaseDeadline(this, state, "day");
      return result;
    };
  }

  if (typeof originalEnterVote === "function") {
    proto.enterVote = function (state: GameState): void {
      const system = this.systemMem(state) as Record<string, unknown>;
      const existing = typeof system.phaseDeadlineAt === "number" && system.phaseDeadlineKind === "day" ? system.phaseDeadlineAt as number : undefined;
      const result = originalEnterVote.call(this, state);
      if (state.phase !== "vote") return result;
      if (existing) {
        system.phaseDeadlineAt = existing;
        system.phaseDeadlineKind = "day";
        void this.ctx?.storage?.setAlarm?.(existing);
      } else setPhaseDeadline(this, state, "day");
      return result;
    };
  }

  proto.checkAndMaybeEnd = function (state: GameState): void {
    if (state.winner) return;
    finishByCoreWinner(this, state);
  };

  if (typeof originalEndGame === "function") {
    proto.endGame = function (state: GameState, winner: any): void {
      clearPhaseDeadline(this, state);
      return originalEndGame.call(this, state, winner);
    };
  }

  if (typeof originalProjectState === "function") {
    proto.projectState = function (state: GameState, token: string): any {
      const view = originalProjectState.call(this, state, token);
      view.phaseDeadlineAt = phaseDeadline(state);
      return view;
    };
  }

  if (typeof originalHandleClientMessage === "function") {
    proto.handleClientMessage = async function (token: string, command: any): Promise<void> {
      const state = this.requireState() as GameState;
      const actor = this.playerByToken(state, token) as Player;
      if (command?.type === "chat" && !actor.alive && !actor.isSpectator && !["lobby", "ended"].includes(state.phase)) {
        const canLastWords = state.phase === "reaction" && state.pendingReaction?.actorId === actor.id && actor.role === "hunter" && this.mem(state, actor.id).hunterLastWordsSent !== true;
        if (!canLastWords) throw new Error("出局玩家不能在進行中的對局公開發言");
        const text = this.normalizeChat(String(command.content ?? ""));
        const message = this.chatMessage(state, actor, `【獵人遺言】${text}`) as RuntimeMessage;
        state.messages.push(message);
        this.mem(state, actor.id).hunterLastWordsSent = true;
        this.trimMessages(state);
        this.saveBroadcast(state);
        return;
      }
      return originalHandleClientMessage.call(this, token, command);
    };
  }

  if (typeof originalPendingAITask === "function") {
    proto.pendingAITask = function (state: GameState): RuntimeAITask | undefined {
      const council = nextAllAIWolfCouncil(this, state);
      if (council) return { playerId: council.id, operation: COUNCIL_OPERATION };
      return originalPendingAITask.call(this, state) as RuntimeAITask | undefined;
    };
  }

  if (typeof originalRunAI === "function") {
    proto.runAI = async function (hostToken: string, playerId: string, apiKeys: string[]): Promise<{ ok: true }> {
      const before = this.requireState() as GameState;
      this.assertHost(before, hostToken);
      const task = this.pendingAITask(before) as RuntimeAITask | undefined;
      if (!task || task.playerId !== playerId) throw new Error("此 AI 目前沒有待執行操作");
      const taskContext = captureAITaskContext(before, task);
      const actor = before.players.find((player) => player.id === playerId && player.isAI && player.alive && !player.isSpectator && player.ai);
      if (!actor?.ai) throw new Error("AI 玩家狀態無效");
      if (task.operation === COUNCIL_OPERATION) return runWolfCouncilAI(this, before, actor, taskContext, apiKeys);
      if (before.phase === "night" && actor.role === "cupid" && !before.nightActions.roleActions[actor.id] && roleActionPrompt(actor, before)?.effect === "link_lovers") {
        return runCupidGroupAI(this, before, actor);
      }
      return originalRunAI.call(this, hostToken, playerId, apiKeys);
    };
  }

  if (typeof originalDecideAIVote === "function") {
    proto.decideAIVote = async function (state: GameState, actor: Player, apiKeys: string[]): Promise<string> {
      if (state.sheriff.sheriffId === actor.id) {
        const candidates = formalLiving(state).filter((player) => player.id !== actor.id);
        if (!candidates.length) return "__abstain__";
        return this.decideAITarget(state, actor, apiKeys, candidates);
      }
      return originalDecideAIVote.call(this, state, actor, apiKeys);
    };
  }

  proto.alarm = async function (): Promise<void> {
    const state = this.requireState() as GameState;
    const deadline = phaseDeadline(state);
    if (!deadline) return;
    if (Date.now() + 25 < deadline) {
      await this.ctx.storage.setAlarm(deadline);
      return;
    }
    clearPhaseDeadline(this, state);
    if (state.phase === "night") {
      forcePassNight(this, state);
      this.addSystemMessage(state, "夜晚時間到，尚未提交的行動視為略過，立即結算本夜。 ");
      this.finishNight(state);
      return;
    }
    if (state.phase === "debate") {
      state.debateIndex = state.debateOrder.length;
      state.debateCompleted = [...new Set(state.debateOrder)];
      this.addSystemMessage(state, "白天時間到，尚未完成的正式發言自動略過；未投票者將視為棄票。 ");
      this.enterVote(state);
    }
    if (state.phase === "vote") this.finishVote(state);
  };
}

function finishByCoreWinner(room: any, state: GameState): boolean {
  const winner = coreWinner(state);
  if (!winner) return false;
  room.endGame(state, winner);
  return Boolean(state.winner);
}

function phaseDeadline(state: GameState): number | undefined {
  const value = state.roleMemory.__system?.phaseDeadlineAt;
  return typeof value === "number" ? value : undefined;
}

function setPhaseDeadline(room: any, state: GameState, kind: "day" | "night"): void {
  const settings = state.settings as RuntimeSettings;
  const seconds = kind === "night" ? settings.nightDurationSeconds ?? DEFAULT_PHASE_SECONDS : settings.dayDurationSeconds ?? DEFAULT_PHASE_SECONDS;
  const deadline = Date.now() + Math.max(15, Math.min(3600, Math.floor(Number(seconds) || DEFAULT_PHASE_SECONDS))) * 1000;
  const system = room.systemMem(state) as Record<string, unknown>;
  system.phaseDeadlineAt = deadline;
  system.phaseDeadlineKind = kind;
  void room.ctx?.storage?.setAlarm?.(deadline);
}

function clearPhaseDeadline(room: any, state: GameState): void {
  if (!state?.roleMemory) return;
  const system = room.systemMem(state) as Record<string, unknown>;
  delete system.phaseDeadlineAt;
  delete system.phaseDeadlineKind;
  if (typeof room.rescheduleRoomAlarm === "function") room.rescheduleRoomAlarm(state);
  else void room.ctx?.storage?.deleteAlarm?.();
}

function forcePassNight(room: any, state: GameState): void {
  for (const actor of formalLiving(state)) {
    if (actor.role === "witch" && !state.nightActions.witchActions[actor.id]) state.nightActions.witchActions[actor.id] = { type: "pass" };
    const prompt = roleActionPrompt(actor, state);
    if (prompt?.timing === "night" && !state.nightActions.roleActions[actor.id]) {
      state.nightActions.roleActions[actor.id] = { effect: prompt.effect, targetIds: [], option: "__pass__", submittedAt: Date.now() } as RoleActionSubmission;
    }
    const addons = Array.isArray((actor as any).addonRoles) ? (actor as any).addonRoles : [];
    if (addons.includes("sadist_leader")) room.mem(state, actor.id).sadistProbeRound = state.round;
  }
}

function resetWolfCouncil(room: any, state: GameState): void {
  const system = room.systemMem(state) as Record<string, unknown>;
  system.coreWolfCouncilRound = state.round;
  system.coreWolfCouncilActors = [];
}

function nextAllAIWolfCouncil(room: any, state: GameState): Player | undefined {
  if (state.phase !== "night") return undefined;
  const wolves = formalLiving(state).filter((player) => playerFaction(player) === "werewolf");
  if (wolves.length < 2 || wolves.some((player) => !player.isAI || !player.ai)) return undefined;
  const system = room.systemMem(state) as Record<string, unknown>;
  if (Number(system.coreWolfCouncilRound ?? 0) !== state.round) resetWolfCouncil(room, state);
  const used = new Set(Array.isArray(system.coreWolfCouncilActors) ? system.coreWolfCouncilActors.filter((id): id is string => typeof id === "string") : []);
  return wolves.find((player) => !used.has(player.id));
}

async function runWolfCouncilAI(room: any, state: GameState, actor: Player, taskContext: AITaskContext, apiKeys: string[]): Promise<{ ok: true }> {
  const result = await callAIWithKeys(apiKeys, {
    config: actor.ai!,
    system: room.aiSystemPrompt(actor, state),
    prompt: `${room.privateContext(state, actor)}\n\n目前狼隊全部由 AI 操作。先在狼人密聊中討論今晚刀口，再由狼刀主控做最後決定。請用 20~70 個繁體中文字提出建議與理由。只回 JSON：{"message":"內容"}。`
  });
  const parsed = parseJSONObject(result.text) as Record<string, unknown>;
  const content = typeof parsed.message === "string" && parsed.message.trim() ? room.normalizeChat(parsed.message) : "請狼刀主控綜合公開發言與隊友意見決定今晚刀口。";
  const current = room.requireState() as GameState;
  if (!isCurrentAITask(room, current, taskContext)) return { ok: true };
  const nowActor = current.players.find((player) => player.id === actor.id && player.alive && player.isAI && !player.isSpectator && player.ai);
  if (!nowActor) return { ok: true };
  const audienceIds = formalLiving(current).filter((player) => playerFaction(player) === "werewolf").map((player) => player.id);
  const message = room.chatMessage(current, nowActor, content) as RuntimeMessage;
  message.channel = "werewolf";
  message.audienceIds = audienceIds;
  current.messages.push(message);
  const system = room.systemMem(current) as Record<string, unknown>;
  const used = Array.isArray(system.coreWolfCouncilActors) ? system.coreWolfCouncilActors.filter((id): id is string => typeof id === "string") : [];
  if (!used.includes(nowActor.id)) used.push(nowActor.id);
  system.coreWolfCouncilActors = used;
  room.trimMessages(current);
  room.touchAndSave(current);
  room.broadcast(current);
  return { ok: true };
}

function runCupidGroupAI(room: any, state: GameState, actor: Player): { ok: true } {
  const expected = effectiveLoverGroupSize(state);
  const candidates = availableUnlinkedLoverTargets(state);
  if (candidates.length < expected) {
    state.nightActions.roleActions[actor.id] = { effect: "link_lovers", targetIds: [], option: "__pass__", submittedAt: Date.now() } as RoleActionSubmission;
  } else {
    const chosen = secureShuffle(candidates).slice(0, expected).map((player) => player.id);
    room.submitRoleActionInternal(state, actor, "link_lovers", chosen);
  }
  room.afterNightSubmission(state);
  return { ok: true };
}
