import "./core-role-text.js";
import { installCoreAuditHardeningRules } from "./core-audit-hardening.js";
import { installCoreFakeDeathRules } from "./core-fake-death.js";
import { installCoreIntegrityRules } from "./core-integrity.js";
import { installCorePhaseAIRules } from "./core-phase-ai.js";
import { installCoreRelationshipRules } from "./core-relationships.js";
import { installCoreStateRules } from "./core-state.js";
import { installCoreTerminalRules } from "./core-terminal.js";

export {
  CORE_REMOVED_ROLE_IDS,
  DEFAULT_PHASE_SECONDS,
  FOOL_CHANCE,
  activeCoreRoleDefinitions,
  coreWinner,
  defaultAllRoleSetup,
  exactDuplicateCoreSkills
} from "./core-state.js";
export { canonicalReactionResume, coreActionAvailable, coreActionOptions, normalizeDebateCursor } from "./core-integrity.js";

export function installCoreRules(GameRoomCtor: { prototype: Record<string, any> & { __coreRulesInstalled?: boolean } }): void {
  const proto = GameRoomCtor.prototype;
  if (proto.__coreRulesInstalled) return;
  proto.__coreRulesInstalled = true;
  installCoreStateRules(GameRoomCtor);
  installCoreRelationshipRules(GameRoomCtor);
  installCorePhaseAIRules(GameRoomCtor);
  installCoreIntegrityRules(GameRoomCtor);
  installCoreTerminalRules(GameRoomCtor);
  installCoreFakeDeathRules(GameRoomCtor);
  installCoreAuditHardeningRules(GameRoomCtor as unknown as Parameters<typeof installCoreAuditHardeningRules>[0]);
}
