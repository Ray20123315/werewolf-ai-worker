import type { GameState, Player } from "./types.js";

type RoomPrototype = Record<string, any> & { __relationshipRulesInstalled?: boolean };

export function installRelationshipRules(GameRoomCtor: { prototype: RoomPrototype }): void {
  const proto = GameRoomCtor.prototype;
  if (proto.__relationshipRulesInstalled) return;

  const originalSubmitRoleActionInternal = proto.submitRoleActionInternal;
  if (typeof originalSubmitRoleActionInternal !== "function") return;
  proto.__relationshipRulesInstalled = true;

  proto.submitRoleActionInternal = function (
    state: GameState,
    actor: Player,
    effect: string,
    targetIds: string[],
    option?: string
  ): void {
    originalSubmitRoleActionInternal.call(this, state, actor, effect, targetIds, option);
    if (effect !== "link_lovers" || actor.role !== "cupid") return;

    const pair = [...new Set(targetIds)]
      .filter((id) => state.players.some((player) => player.id === id && !player.isSpectator && !player.kickedAt))
      .slice(0, 2);
    if (pair.length === 2) this.mem(state, actor.id).cupidLinkedIds = pair;
  };
}
