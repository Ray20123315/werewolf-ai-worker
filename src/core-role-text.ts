import { ROLE_REGISTRY } from "./roles.js";
import type { Role } from "./types.js";

const SUMMARY_OVERRIDES: Partial<Record<Role, string>> = {
  berserker_wolf: "狼隊成功刀人後累積一次狂暴；下一次受到烏鴉或炸彈造成的無效票效果時可消耗一次狂暴抵銷，但普通放逐仍只計 1 票。",
  bomb_wolf: "白天把炸彈植入玩家；持有者下一次實際投票時該票無效，若投給玩家則炸彈同時傳給其投票目標。",
  raven: "夜晚詛咒一人，使其翌日普通放逐票無效；不增加任何玩家的票數。",
  fake_killer: "每晚可製造一名假死者；假死不觸發獵人、戀人、警長繼任等真死亡副作用，下一輪自動恢復。",
  magician: "每局一次選兩名其他玩家：一死一活交換生死；兩人都活且在白天時交換目前投票；其他情況交換職業與勝利陣營歸屬。",
  suicide_bomber: "白天公開自爆，可指定 0～2 名其他存活玩家同死；若爆炸後場上沒有其他存活正式玩家，炸彈客達成個人特殊勝利。"
};

const DEBATE_ADAPTATION_OVERRIDES: Partial<Record<Role, string>> = {
  berserker_wolf: "移除移動速度與加權票；成功狼刀改為累積一次可抵銷烏鴉／炸彈無效票的狂暴，普通放逐仍維持一人一票。",
  suicide_bomber: "移除爆炸半徑；改為白天公開自爆並可指定 0～2 名目標，終局由伺服器判斷特殊個人勝利。"
};

for (const [role, summary] of Object.entries(SUMMARY_OVERRIDES) as Array<[Role, string]>) {
  const definition = ROLE_REGISTRY[role];
  if (definition) definition.summary = summary;
}
for (const [role, adaptation] of Object.entries(DEBATE_ADAPTATION_OVERRIDES) as Array<[Role, string]>) {
  const definition = ROLE_REGISTRY[role];
  if (definition) definition.debateAdaptation = adaptation;
}

export function canonicalRoleSummary(role: Role): string {
  return ROLE_REGISTRY[role].summary;
}
