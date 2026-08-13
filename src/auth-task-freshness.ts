import type { GameState, PasswordVerifier, Player } from "./types.js";

export type RoomCommitContext = {
  state: GameState;
  roomId: string;
};

export type HumanSessionCommitContext = RoomCommitContext & {
  playerId: string;
  token: string;
  password: PasswordVerifier | undefined;
};

export function captureRoomCommitContext(state: GameState): RoomCommitContext {
  return { state, roomId: state.roomId };
}

export function assertFreshRoomCommit(state: GameState, context: RoomCommitContext): void {
  if (state !== context.state || state.roomId !== context.roomId) {
    throw new Error("房間狀態已變更，請重試");
  }
}

export function resolveFreshHumanJoin(state: GameState, context: RoomCommitContext, nameKey: string): boolean {
  assertFreshRoomCommit(state, context);
  if (state.players.some((player) => !player.kickedAt && player.nameKey === nameKey)) {
    throw new Error("這個玩家名稱已被使用，請登入原有人物或改用其他名稱");
  }
  return state.phase !== "lobby";
}

export function captureHumanSessionCommitContext(state: GameState, player: Player): HumanSessionCommitContext {
  return {
    ...captureRoomCommitContext(state),
    playerId: player.id,
    token: player.token,
    password: player.password
  };
}

export function resolveFreshHumanSession(state: GameState, context: HumanSessionCommitContext): Player {
  assertFreshRoomCommit(state, context);
  const player = state.players.find((candidate) => candidate.id === context.playerId && !candidate.isAI && !candidate.kickedAt);
  if (!player || player.token !== context.token || player.password !== context.password) {
    throw new Error("玩家登入狀態已變更，請重新登入後再試");
  }
  return player;
}
