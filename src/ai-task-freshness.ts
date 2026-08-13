import type { GameState } from "./types.js";

export type RuntimeAITask = { playerId: string; operation: string };

export type AITaskContext = {
  roomId: string;
  phase: GameState["phase"];
  round: number;
  playerId: string;
  operation: string;
  roleMemory: GameState["roleMemory"];
  phaseState: unknown;
  debateIndex: number;
  debateCompletedCount: number;
};

export function captureAITaskContext(state: GameState, task: RuntimeAITask): AITaskContext {
  return {
    roomId: state.roomId,
    phase: state.phase,
    round: state.round,
    playerId: task.playerId,
    operation: task.operation,
    roleMemory: state.roleMemory,
    phaseState: phaseStateReference(state),
    debateIndex: state.debateIndex,
    debateCompletedCount: state.debateCompleted.length
  };
}

export function isCurrentAITask(room: any, state: GameState, context: AITaskContext): boolean {
  if (
    state.roomId !== context.roomId
    || state.phase !== context.phase
    || state.round !== context.round
    || state.roleMemory !== context.roleMemory
    || phaseStateReference(state) !== context.phaseState
  ) return false;

  if (
    state.phase === "debate"
    && (state.debateIndex !== context.debateIndex || state.debateCompleted.length !== context.debateCompletedCount)
  ) return false;

  const task = room.pendingAITask(state);
  return task?.playerId === context.playerId && task.operation === context.operation;
}

export function assertCurrentAITask(room: any, state: GameState, context: AITaskContext): void {
  if (!isCurrentAITask(room, state, context)) throw new Error("AI 操作已過期，請重新同步房間狀態");
}

function phaseStateReference(state: GameState): unknown {
  if (state.phase === "night") return state.nightActions;
  if (state.phase === "vote") return state.votes;
  if (state.phase === "sheriff") return state.sheriff.votes;
  if (state.phase === "reaction") return state.pendingReaction;
  if (state.phase === "debate") return state.debateOrder;
  return undefined;
}
