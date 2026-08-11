import { livingPlayers, playerFaction } from "./game-engine.js";
import { roleDefinition } from "./roles.js";
import type { GameState } from "./types.js";

type RoomPrototype = Record<string, any> & { __officialSourceRulesInstalled?: boolean };

/**
 * Narrow compatibility layer for rules that are explicit in the user-provided
 * Cool-Mi author post but differ from the older web adaptation.
 *
 * Forum-comment wish-list roles are not promoted to official rules here, and
 * explicit project overrides (for example equal ordinary exile votes) remain
 * authoritative when they conflict with older source text.
 */
export function installOfficialSourceRules(GameRoomCtor: { prototype: RoomPrototype }): void {
  const proto = GameRoomCtor.prototype;
  if (proto.__officialSourceRulesInstalled) return;
  proto.__officialSourceRulesInstalled = true;

  const originalKillPlayer = proto.killPlayer;
  proto.killPlayer = function (state: GameState, targetId: string, reason: string, killerId?: string, bypassProtection = false): boolean {
    const target = state.players.find((player) => player.id === targetId && player.alive && !player.isSpectator && !player.kickedAt);
    if (target?.role === "wraith" && wraithNightInvincibilityApplies(state, reason)) return false;
    return originalKillPlayer.call(this, state, targetId, reason, killerId, bypassProtection) as boolean;
  };

  // The author's v4.0 update states that a wraith is invincible at night while
  // any good-aligned player is still alive. Preserve the explicit project
  // priority established for addons: lover suicide is a relationship death and
  // still kills a wraith.
  const wraith = roleDefinition("wraith");
  wraith.summary = "場上仍有活著的好人陣營玩家時，夜晚無敵；情侶殉情不受此保護。狼人死光且仍有怨靈存活時，怨靈陣營可進入勝利判定。";
  wraith.passives = ["night_invincible_while_village_alive", "spirit_endgame"];
}

export function wraithNightInvincibilityApplies(state: GameState, reason: string): boolean {
  if (state.phase !== "night" || reason === "lover") return false;
  return livingPlayers(state.players).some((player) => !player.kickedAt && playerFaction(player) === "village");
}
