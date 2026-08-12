import "./core-role-text.js";
import { installCoreAuditHardeningRules } from "./core-audit-hardening.js";
import { installCoreDebateFlowRules } from "./core-debate-flow.js";
import { installCoreFakeDeathRules } from "./core-fake-death.js";
import { installCoreIntegrityRules } from "./core-integrity.js";
import { installCoreMagicianRules } from "./core-magician.js";
import { installCorePhaseAIRules } from "./core-phase-ai.js";
import { installPost28FinalizeRules } from "./core-post28-finalize.js";
import { installPost28FullRepairRules } from "./core-post28-repair.js";
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
export { magicianPrompt, resolveMagicianBySource } from "./core-magician.js";
export { normalizeDebateSlots, revivePlayerInvariant } from "./core-post28-repair.js";

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
  installCoreMagicianRules(GameRoomCtor);
  if (typeof proto.systemMem === "function" && typeof proto.mem === "function" && typeof proto.touchAndSave === "function") {
    installCoreAuditHardeningRules(GameRoomCtor as unknown as Parameters<typeof installCoreAuditHardeningRules>[0]);
    installPost28FullRepairRules(GameRoomCtor as unknown as Parameters<typeof installPost28FullRepairRules>[0]);
    installPost28FinalizeRules(GameRoomCtor as unknown as Parameters<typeof installPost28FinalizeRules>[0]);
  }
  // This compatibility invariant must be outermost: audit/post-28 layers may
  // create/persist deadlines during their composed save path, so debate flow
  // clears only the debate deadline after those layers finish.
  installCoreDebateFlowRules(GameRoomCtor);
}
