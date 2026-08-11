import type { GameState, Player } from "./types.js";

type RoomPrototype = Record<string, any> & { __inspectionRulesInstalled?: boolean };

const TRUE_ROLE_INSPECTORS = new Set([
  "observer",
  "diviner",
  "angel",
  "devil",
  "demon_wolf"
]);

const GENERIC_PRIVATE_RESULT_ROLES = new Set([
  "medicine_wolf",
  "gravekeeper",
  "medium",
  "witness",
  "detective",
  "spy",
  "poltergeist"
]);

/**
 * Keeps private information semantically separate from identity inspection.
 *
 * The base room helper historically applied target disguise/inspection hiding to
 * every roleResults entry. That is correct for some identity checks, but wrong
 * for true-role checks and unrelated private notes such as healed-target,
 * gravekeeper, medium, witness, and action-observation information.
 */
export function installInspectionRules(GameRoomCtor: { prototype: RoomPrototype }): void {
  const proto = GameRoomCtor.prototype;
  if (proto.__inspectionRulesInstalled) return;
  proto.__inspectionRulesInstalled = true;

  const originalStoreRoleResult = proto.storeRoleResult;
  if (typeof originalStoreRoleResult !== "function") throw new Error("storeRoleResult runtime hook is unavailable");

  proto.storeRoleResult = function (state: GameState, actor: Player, target: Player, result: string): void {
    state.roleResults[actor.id] ??= {};

    // These roles explicitly inspect the *true* role. Law-wolf / purifying-spirit
    // can still hide the result for the round, but a disguise must not replace it.
    if (isTrueRoleInspection(actor, target, result)) {
      const hidden = this.mem(state, target.id).inspectionHiddenRound === state.round;
      state.roleResults[actor.id]![target.id] = hidden ? "被隱藏" : result;
      return;
    }

    // These results describe events/actions rather than the target's identity.
    // Target disguise or identity-hiding therefore must not rewrite the text.
    if (GENERIC_PRIVATE_RESULT_ROLES.has(actor.role ?? "")) {
      state.roleResults[actor.id]![target.id] = result;
      return;
    }

    originalStoreRoleResult.call(this, state, actor, target, result);
  };
}

function isTrueRoleInspection(actor: Player, target: Player, result: string): boolean {
  return Boolean(
    actor.role
      && TRUE_ROLE_INSPECTORS.has(actor.role)
      && target.role
      && result === target.role
  );
}
