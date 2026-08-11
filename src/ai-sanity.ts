import { livingPlayers, playerFaction } from "./game-engine.js";
import type { GameState, Player } from "./types.js";

type RoomPrototype = Record<string, any> & { __aiSanityRulesInstalled?: boolean };
type RuntimeAITask = { playerId: string; operation: string };

export function installAISanityRules(GameRoomCtor: { prototype: RoomPrototype }): void {
  const proto = GameRoomCtor.prototype;
  if (proto.__aiSanityRulesInstalled || typeof proto.pendingAITask !== "function") return;
  proto.__aiSanityRulesInstalled = true;

  const originalPendingAITask = proto.pendingAITask;

  proto.pendingAITask = function (state: GameState): RuntimeAITask | undefined {
    if (state.phase !== "night") return originalPendingAITask.call(this, state) as RuntimeAITask | undefined;

    const pendingWolf = unresolvedWolfKillActor(this, state);
    if (pendingWolf?.isAI && pendingWolf.ai) {
      return { playerId: pendingWolf.id, operation: "night_action" };
    }

    const task = originalPendingAITask.call(this, state) as RuntimeAITask | undefined;
    if (!pendingWolf || !task) return task;

    const actor = state.players.find((player) => player.id === task.playerId);
    if (actor?.role === "witch") return undefined;
    return task;
  };
}

function unresolvedWolfKillActor(room: any, state: GameState): Player | undefined {
  const hasLegalWolfTarget = livingPlayers(state.players).some((player) => playerFaction(player) !== "werewolf");
  if (!hasLegalWolfTarget) return undefined;

  return livingPlayers(state.players).find((player) =>
    room.participatesWolfVote(state, player) && !state.nightActions.wolfVotes[player.id]
  );
}
