import { coreWinner } from "./core-state.js";
import type { GameState } from "./types.js";

type RoomPrototype = Record<string, any> & { __coreTerminalRulesInstalled?: boolean };

/**
 * The legacy room resolves a raw game-engine winner inside finishNight().
 * CoreRules has newer winner semantics (fake-death, Red Axe continuation,
 * slaughter-edge/slaughter-all). This final wrapper prevents that legacy
 * shortcut from ending the game before the canonical terminal gate runs.
 */
export function installCoreTerminalRules(GameRoomCtor: { prototype: RoomPrototype }): void {
  const proto = GameRoomCtor.prototype;
  if (proto.__coreTerminalRulesInstalled) return;
  proto.__coreTerminalRulesInstalled = true;

  const originalRequireState = proto.requireState;
  const originalFinishNight = proto.finishNight;

  if (typeof originalRequireState === "function") {
    proto.requireState = function (): GameState {
      const state = originalRequireState.call(this) as GameState;
      clearRevivedFakeDeathMarkers(this, state);
      return state;
    };
  }

  if (typeof originalFinishNight === "function") {
    proto.finishNight = function (state: GameState): void {
      let suppressedLegacyTerminal = false;
      const hadOwnEndGame = Object.prototype.hasOwnProperty.call(this, "endGame");
      const previousOwnEndGame = hadOwnEndGame ? this.endGame : undefined;
      const canonicalEndGame = this.endGame;

      this.endGame = (candidateState: GameState, winner: any): any => {
        // A resolver that has already explicitly assigned state.winner is a
        // role-specific terminal and must not be second-guessed here.
        if (candidateState.winner) return canonicalEndGame.call(this, candidateState, winner);
        const canonical = coreWinner(candidateState);
        if (canonical !== winner) {
          suppressedLegacyTerminal = true;
          return undefined;
        }
        return canonicalEndGame.call(this, candidateState, winner);
      };

      try {
        originalFinishNight.call(this, state);
      } finally {
        if (hadOwnEndGame) this.endGame = previousOwnEndGame;
        else delete this.endGame;
      }

      clearRevivedFakeDeathMarkers(this, state);
      if (!suppressedLegacyTerminal || state.winner || state.pendingReaction || state.phase !== "night") return;
      this.checkAndMaybeEnd(state);
      if (!state.winner && !state.pendingReaction && state.phase === "night") this.beginDebate(state);
    };
  }
}

function clearRevivedFakeDeathMarkers(room: any, state: GameState): void {
  if (!state?.roleMemory || !Array.isArray(state.players)) return;
  for (const player of state.players) {
    if (!player.alive) continue;
    const memory = typeof room?.mem === "function" ? room.mem(state, player.id) as Record<string, any> : state.roleMemory[player.id] as Record<string, any> | undefined;
    if (!memory || memory.fakeDeath !== true || typeof memory.reviveRound === "number") continue;
    delete memory.fakeDeath;
  }
}
