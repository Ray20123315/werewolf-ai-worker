import type { Faction, Role, RoleActionEffect, RoleActionTiming, RoleTargetMode } from "./types";

export interface RoleDefinition {
  id: Role;
  name: string;
  faction: Faction;
  summary: string;
  source: "official" | "discussion" | "adapted";
  action?: {
    timing: RoleActionTiming;
    effect: RoleActionEffect;
    targetMode: RoleTargetMode;
    oncePerGame?: boolean;
    fromRound?: number;
    options?: readonly string[];
  };
  passives?: readonly string[];
  foolVariant?: string;
  aliases?: readonly string[];
  debateAdaptation?: string;
}

const r = (
  id: Role,
  name: string,
  faction: Faction,
  summary: string,
  source: RoleDefinition["source"],
  extra: Omit<RoleDefinition, "id" | "name" | "faction" | "summary" | "source"> = {}
): RoleDefinition => ({ id, name, faction, summary, source, ...extra });

export const ROLE_REGISTRY: Record<Role, RoleDefinition> = {
  werewolf: r("werewolf", "狼人", "werewolf", "夜晚與狼隊共同選擇擊殺目標。", "official", { action: { timing: "night", effect: "wolf_kill", targetMode: "one_alive_non_wolf" } }),
  black_wolf_king: r("black_wolf_king", "黑狼王", "werewolf", "狼人中的獵人，死亡時可帶走一名玩家。", "official", { action: { timing: "reaction", effect: "death_shot", targetMode: "one_alive_other", oncePerGame: true }, passives: ["wolf_chat"] }),
  white_wolf_king: r("white_wolf_king", "白狼王", "werewolf", "白天可自爆並帶走一名玩家，之後直接進夜晚。", "official", { action: { timing: "day", effect: "self_destruct_kill", targetMode: "one_alive_other", oncePerGame: true }, passives: ["wolf_chat"] }),
  snow_wolf: r("snow_wolf", "雪狼", "werewolf", "預言家類陣營查驗會把你視為好人。", "official", { passives: ["seer_looks_village", "wolf_chat"] }),
  shapeshifter_wolf: r("shapeshifter_wolf", "百變狼", "werewolf", "夜晚偽裝成一名玩家，使身份查驗得到偽裝目標資訊。", "official", { action: { timing: "night", effect: "disguise_as_target", targetMode: "one_alive_other" }, passives: ["wolf_chat"] }),
  primordial_wolf: r("primordial_wolf", "原初狼", "werewolf", "狼群叛徒；普通狼人辨認隊友時會受到干擾。", "official", { passives: ["hidden_from_wolf_list", "wolf_chat"] }),
  berserker_wolf: r("berserker_wolf", "暴走狼", "werewolf", "原作速度成長改成辯論式：狼隊成功刀人後累積一次白天額外票權。", "adapted", { passives: ["wolf_chat", "kill_grants_vote_bonus"], debateAdaptation: "移除移動速度，改為成功狼刀後累積投票影響力。" }),
  bomb_wolf: r("bomb_wolf", "炸彈狼", "werewolf", "白天把炸彈植入玩家；被標記者下一次投票會把炸彈傳給投票目標，結算時持有者承受額外放逐票。", "official", { action: { timing: "day", effect: "plant_bomb", targetMode: "one_alive_other", fromRound: 2 }, passives: ["wolf_chat"] }),
  blood_wolf: r("blood_wolf", "血狼", "werewolf", "白天自爆可取消當日投票並使下一夜好人主動技能失效；最後一狼被票出時可延後死亡一夜。", "official", { action: { timing: "day", effect: "blood_moon", targetMode: "none", oncePerGame: true }, passives: ["wolf_chat", "last_wolf_extra_night"] }),

  cupid: r("cupid", "邱比特", "village", "首夜配對兩名玩家成為戀人；戀人共享特殊存活關係。", "official", { action: { timing: "night", effect: "link_lovers", targetMode: "two_alive_any", oncePerGame: true } }),
  seer: r("seer", "預言家", "village", "每晚查驗一名玩家的陣營。", "official", { action: { timing: "night", effect: "inspect_team", targetMode: "one_alive_other" } }),
  apprentice_seer: r("apprentice_seer", "見習預言家", "village", "預言家死亡後繼承查驗能力與可傳承紀錄。", "official", { passives: ["inherit_seer"] }),
  witch: r("witch", "女巫", "village", "擁有一次解藥與一次毒藥，每晚最多使用其中一種。", "official", { action: { timing: "night", effect: "witch_choice", targetMode: "optional_alive_other", options: ["heal", "poison", "pass"] } }),
  hunter: r("hunter", "獵人", "village", "死亡後可公開帶走一名仍存活的玩家。", "official", { action: { timing: "reaction", effect: "death_shot", targetMode: "one_alive_other", oncePerGame: true } }),
  ninja: r("ninja", "忍者", "village", "夜晚選擇替身；自己遭夜間死亡時可把死亡轉移給替身一次。", "official", { action: { timing: "night", effect: "set_scapegoat", targetMode: "one_alive_other" }, passives: ["redirect_own_night_death_once"] }),
  fraudster: r("fraudster", "詐欺師", "village", "好人方臥底，陣營查驗看起來像狼人。", "official", { passives: ["seer_looks_werewolf"] }),
  masochist_cultist: r("masochist_cultist", "抖M教徒", "village", "自己的普通投票為無效票；若白天成為唯一最高票者則觸發個人特殊勝利。", "official", { passives: ["vote_weight_zero", "wins_if_unique_top_vote"] }),
  sadist_leader: r("sadist_leader", "抖S教主", "village", "每晚可指定一名抖M教徒成為肉盾，替自己承受一次夜間死亡。", "official", { action: { timing: "night", effect: "set_bodyguard", targetMode: "one_alive_other" } }),
  mermaid: r("mermaid", "人魚", "village", "每晚可影響狼人的攻擊對象，把狼刀導向另一名合法目標。", "official", { action: { timing: "night", effect: "redirect_wolf_kill", targetMode: "one_alive_other" } }),
  gravedigger: r("gravedigger", "掘墓者", "village", "夜晚選擇一名死者並變成其職業。", "official", { action: { timing: "night", effect: "copy_dead_role", targetMode: "one_dead", oncePerGame: true } }),
  knight: r("knight", "騎士", "village", "白天公開決鬥：對方是狼人則對方死亡，否則騎士死亡；成功時直接入夜。", "official", { action: { timing: "day", effect: "duel", targetMode: "one_alive_other", oncePerGame: true } }),
  guard: r("guard", "守衛", "village", "每晚守護一名玩家，不能連續兩晚守同一人。", "official", { action: { timing: "night", effect: "protect", targetMode: "one_alive_any" } }),
  detective: r("detective", "偵探", "village", "原作追蹤隱形改為辯論式：查詢目標本晚是否使用主動技能以及技能類型。", "adapted", { action: { timing: "night", effect: "inspect_action", targetMode: "one_alive_other" }, debateAdaptation: "移除距離與隱形追蹤。" }),
  lecher: r("lecher", "色狼", "village", "夜晚騷擾一名玩家並累積造訪紀錄；完成房內多名不同玩家造訪可獲得個人成就勝利。", "adapted", { action: { timing: "night", effect: "visit_target", targetMode: "one_alive_other" }, debateAdaptation: "移除物理接觸，以秘密造訪紀錄取代。" }),
  thief: r("thief", "盜賊", "village", "夜晚標記一名玩家，隔天交換／偷取其職業。", "official", { action: { timing: "night", effect: "steal_role_delayed", targetMode: "one_alive_other", oncePerGame: true } }),
  villager: r("villager", "村民", "village", "沒有主動技能，只靠公開資訊、發言與票型推理。", "official"),

  wraith: r("wraith", "怨靈", "spirit", "夜晚不會被一般狼刀殺死；狼人全滅且仍有怨靈存活時怨靈陣營可搶先勝利。", "official", { passives: ["night_kill_immune", "spirit_endgame"] }),
  voodoo_girl: r("voodoo_girl", "巫毒女孩", "spirit", "每晚詛咒玩家並累積層數，達門檻時目標死亡。", "official", { action: { timing: "night", effect: "add_curse_stack", targetMode: "one_alive_other" }, passives: ["spirit_team"] }),
  tempter: r("tempter", "蠱惑師", "spirit", "每晚詛咒一名玩家；對查驗職業會使其下一次技能失效。", "official", { action: { timing: "night", effect: "disable_next_action", targetMode: "one_alive_other" }, passives: ["spirit_team"] }),

  vampire_wolf_copy: r("vampire_wolf_copy", "吸血狼", "werewolf", "夜晚複製一名玩家的主動能力直到該玩家死亡，並使其下一次能力失靈。", "discussion", { action: { timing: "night", effect: "copy_ability_and_block", targetMode: "one_alive_non_wolf" }, passives: ["wolf_chat"] }),
  priest: r("priest", "牧師", "village", "查驗吸血狼；查中時直接消滅吸血狼並獲得一次死亡護盾。", "discussion", { action: { timing: "night", effect: "priest_check", targetMode: "one_alive_other" } }),
  mimic_wolf: r("mimic_wolf", "模仿狼", "werewolf", "原作換頭顱改為辯論式：選擇一名玩家作為公開／查驗偽裝身份。", "adapted", { action: { timing: "night", effect: "disguise_as_target", targetMode: "one_alive_other" }, passives: ["wolf_chat"], debateAdaptation: "移除裝備與皮膚變換。" }),
  observer: r("observer", "觀察家", "village", "每晚觀察一人，可識破偽裝並取得其真實身份類型。", "adapted", { action: { timing: "night", effect: "inspect_true_role", targetMode: "one_alive_other" }, debateAdaptation: "移除 Minecraft 頭顱、距離與顯形效果，改為真實職業查驗。" }),
  great_wolf: r("great_wolf", "大野狼", "werewolf", "每局一次使用強襲狼刀，無視普通守護。", "discussion", { action: { timing: "night", effect: "strong_kill", targetMode: "one_alive_non_wolf", oncePerGame: true }, passives: ["wolf_chat"] }),
  dream_wolf: r("dream_wolf", "夢狼／噩夢", "werewolf", "每晚恐懼一名玩家，使其該晚主動技能失效。", "discussion", { action: { timing: "night", effect: "disable_current_action", targetMode: "one_alive_other" }, passives: ["wolf_chat"] }),
  dream_guide: r("dream_guide", "引夢人", "village", "每晚必須選擇一名夢遊者；夢遊者當夜免於死亡，但引夢人夜死時夢遊者一同死亡。", "discussion", { action: { timing: "night", effect: "set_dreamwalker", targetMode: "one_alive_other" } }),
  spy: r("spy", "間諜", "neutral", "開局秘密分配要協助的陣營，技能以諜報資訊為主，勝負跟隨指定陣營。", "discussion", { action: { timing: "night", effect: "inspect_action", targetMode: "one_alive_other" }, passives: ["secret_allegiance"] }),
  trapper: r("trapper", "陷阱師", "village", "每晚標記一人；被標記者若隔日投票則在投票結算後死亡。", "discussion", { action: { timing: "night", effect: "trap_next_vote", targetMode: "one_alive_other" } }),
  persuader_wolf: r("persuader_wolf", "說服狼", "werewolf", "只剩自己為最後一狼時可一次把一名非狼人轉為狼人。", "discussion", { action: { timing: "night", effect: "convert_to_werewolf_if_last", targetMode: "one_alive_non_wolf", oncePerGame: true }, passives: ["wolf_chat"] }),

  ghost_hunter: r("ghost_hunter", "獵鬼人", "village", "第二晚起狩獵：非好人目標死亡；好人目標則自己死亡。", "discussion", { action: { timing: "night", effect: "hunt_non_village", targetMode: "one_alive_other", fromRound: 2 }, passives: ["poison_shield_once"] }),
  ice_queen: r("ice_queen", "冰雪女王", "neutral", "每晚凍結一人；可引爆所有被凍結者，若自己造成的死亡超過初始玩家半數則獨贏。", "discussion", { action: { timing: "night", effect: "freeze_or_detonate", targetMode: "optional_alive_other", options: ["freeze", "detonate"] }, passives: ["frozen_die_with_queen"] }),
  red_axe_madman: r("red_axe_madman", "赤斧狂魔", "neutral", "狼人全滅後繼承夜殺權，目標成為最後存活陣營。", "discussion", { action: { timing: "night", effect: "kill_if_no_wolves", targetMode: "one_alive_other" }, passives: ["wins_as_last_survivor"] }),
  necromancer: r("necromancer", "死靈法師", "spirit", "依死亡比例解鎖資訊、護盾與咒殺能力。", "discussion", { action: { timing: "night", effect: "necromancer_milestone", targetMode: "optional_alive_other" }, passives: ["spirit_team"] }),
  warlock: r("warlock", "男巫", "village", "有一次毒藥與一次靈藥；靈藥可使目標當夜技能失效。", "discussion", { action: { timing: "night", effect: "warlock_choice", targetMode: "optional_alive_other", options: ["poison", "nullify", "pass"] } }),
  diviner: r("diviner", "占卜師", "village", "每晚查驗一名玩家的真實職業，不受雪狼等陣營偽裝影響。", "discussion", { action: { timing: "night", effect: "inspect_true_role", targetMode: "one_alive_other" } }),
  wolf_beauty: r("wolf_beauty", "狼美人", "werewolf", "每晚魅惑一人；狼美人出局時目前魅惑對象一同殉情。", "discussion", { action: { timing: "night", effect: "charm_target", targetMode: "one_alive_non_wolf" }, passives: ["wolf_chat", "charmed_dies_with_owner"] }),
  yin_yang_master: r("yin_yang_master", "陰陽師", "village", "每晚給一名玩家白陽或夜陰祝福，分別抵擋下一次白天或夜晚死亡。", "discussion", { action: { timing: "night", effect: "yin_yang_bless", targetMode: "one_alive_other", options: ["day", "night"] } }),
  angel: r("angel", "天使", "village", "查驗真實職業；第二晚起查到狼人時，目標在天亮後死亡。", "discussion", { action: { timing: "night", effect: "angel_check", targetMode: "one_alive_other" } }),
  devil: r("devil", "惡魔", "werewolf", "查驗真實職業；第二晚起查到天使時使其天亮後死亡。", "discussion", { action: { timing: "night", effect: "devil_check", targetMode: "one_alive_non_wolf" }, passives: ["wolf_chat"] }),
  wolf_witch: r("wolf_witch", "狼巫", "werewolf", "第二晚起可使用一次穿透守衛的毒藥；被此毒殺的獵人不能開槍。", "discussion", { action: { timing: "night", effect: "piercing_poison", targetMode: "one_alive_non_wolf", oncePerGame: true, fromRound: 2 }, passives: ["wolf_chat"] }),
  medium: r("medium", "靈媒", "village", "白天有人被放逐後，入夜時得知該玩家所屬陣營。", "discussion", { passives: ["learn_exiled_faction"] }),
  raven: r("raven", "烏鴉", "village", "夜晚詛咒一人，使其翌日投票結算時多一票；至少有一般有效票時才生效。", "discussion", { action: { timing: "night", effect: "raven_vote_curse", targetMode: "one_alive_other" } }),
  poltergeist: r("poltergeist", "騷靈", "spirit", "每晚監視一人的技能使用；可得知其有無技能與目標，並干擾其目標。", "discussion", { action: { timing: "night", effect: "observe_and_redirect", targetMode: "one_alive_other" }, passives: ["spirit_team"] }),
  wealthy_wolf: r("wealthy_wolf", "財狼", "werewolf", "每局一次使一名非狼人玩家的主動技能永久失效。", "discussion", { action: { timing: "night", effect: "disable_permanently", targetMode: "one_alive_non_wolf", oncePerGame: true }, passives: ["wolf_chat", "hidden_identity_from_enemies"] }),
  queen_bee: r("queen_bee", "女王蜂", "village", "原作範圍狀態改為辯論式：撒鱗粉使目標下一次主動技能失效；自己夜死時對標記者留下延遲毒刺。", "adapted", { action: { timing: "night", effect: "pollen_block", targetMode: "one_alive_other" }, passives: ["sting_on_night_death"], debateAdaptation: "移除範圍虛弱與距離毒刺，改為技能封鎖與延遲死亡標記。" }),
  bear_tamer: r("bear_tamer", "馴熊師", "village", "原作距離熊系技能改為每晚選兩人，得知兩人中是否至少一名狼人。", "adapted", { action: { timing: "night", effect: "inspect_pair_for_wolf", targetMode: "two_alive_other" }, debateAdaptation: "移除 10 格距離與熊種移動效果，改為雙目標狼人存在性查驗。" }),
  vomit_wolf: r("vomit_wolf", "嘔吐狼", "werewolf", "原作範圍異常改成資源型辯論效果：累積層數後讓目標下一次投票或技能失效。", "adapted", { action: { timing: "night", effect: "spend_stacks_to_disable", targetMode: "one_alive_non_wolf" }, passives: ["gain_stack_each_night", "wolf_chat"], debateAdaptation: "移除範圍噁心、虛弱與移速狀態，改為可累積的技能封鎖資源。" }),

  physicist: r("physicist", "物理學家", "village", "能額外承受一次狼人夜殺；第二次才真正死亡。", "discussion", { passives: ["wolf_kill_shield_once"] }),
  pharmacist: r("pharmacist", "藥劑師", "village", "每晚對一人下藥；同一目標第一劑保護狼刀，第二劑直接死亡。", "discussion", { action: { timing: "night", effect: "dose_target", targetMode: "one_alive_other" } }),
  sacrifice: r("sacrifice", "祭品", "village", "若被狼人夜殺，天亮時系統公開其中一名存活狼人的身份。", "discussion", { passives: ["reveal_wolf_on_wolf_death"] }),
  sniper: r("sniper", "狙擊手", "village", "白天一次性公開自己身份並指定最多兩人直接死亡。", "discussion", { action: { timing: "day", effect: "sniper_two_kills", targetMode: "two_alive_other", oncePerGame: true } }),
  scout: r("scout", "偵查兵", "village", "白天一次性公開一名玩家的真實職業。", "discussion", { action: { timing: "day", effect: "public_reveal_role", targetMode: "one_alive_other", oncePerGame: true } }),
  verifier: r("verifier", "驗證者", "village", "每早得知上一輪有投有效票的玩家中是否存在狼人。", "discussion", { passives: ["learn_if_wolf_voted"] }),
  confirmed_villager: r("confirmed_villager", "金水", "village", "開局即由系統公開確認為好人陣營。", "discussion", { passives: ["public_confirmed_village"] }),
  scapegoater: r("scapegoater", "嫁禍者", "village", "第一次被票出時公開身份並把放逐結果轉移給另一名玩家。", "discussion", { action: { timing: "reaction", effect: "redirect_exile", targetMode: "one_alive_other", oncePerGame: true } }),
  witness: r("witness", "證人", "village", "第一次發生狼人夜殺時，秘密得知執行狼刀的其中一名狼人。", "discussion", { passives: ["learn_wolf_killer_once"] }),
  traitor_wolf: r("traitor_wolf", "叛狼", "village", "好人陣營的危險臥底：查驗呈狼人，每晚可獨立殺一人。", "discussion", { action: { timing: "night", effect: "kill_target", targetMode: "one_alive_other" }, passives: ["seer_looks_werewolf"] }),
  bee: r("bee", "蜜蜂", "village", "蜂巢死亡後解鎖一次夜間帶走一人的能力。", "discussion", { action: { timing: "night", effect: "kill_if_hive_dead", targetMode: "one_alive_other", oncePerGame: true } }),
  hive: r("hive", "蜂巢", "village", "與蜜蜂配套；辯論式中本身沒有主動技能，死亡會喚醒蜜蜂。", "adapted", { passives: ["awakens_bee_on_death"], debateAdaptation: "移除傳送蜜蜂的物理互動，保留蜂巢死亡後喚醒蜜蜂的關係。" }),
  curse_caster: r("curse_caster", "咒術師", "village", "整合兩版提案：夜晚標記一人；可選擇讓目標下一次技能失效，或在自己夜死時代替自己死亡（一次）。", "discussion", { action: { timing: "night", effect: "curse_caster_mark", targetMode: "one_alive_other", options: ["block", "substitute"] } }),
  hacker: r("hacker", "駭客", "village", "每局一次把目標改成同陣營的另一個職業。", "discussion", { action: { timing: "night", effect: "reroll_same_faction_role", targetMode: "one_alive_other", oncePerGame: true } }),
  precog: r("precog", "預知者", "village", "投票階段可秘密看見目前最高票玩家的真實職業。", "discussion", { passives: ["see_current_top_vote_role"] }),
  discriminator: r("discriminator", "辨別者", "village", "投給好人陣營時自己的票視為無效。", "discussion", { passives: ["vote_only_counts_against_non_village"] }),
  betrayer: r("betrayer", "背叛者", "village", "死亡後勝利陣營改為狼人；生前仍按好人資訊遊玩。", "discussion", { passives: ["dead_allegiance_werewolf"] }),
  fake_killer: r("fake_killer", "偽殺者", "village", "每晚可製造一名假死者；天亮會顯示死亡，但隔天早晨復活。", "discussion", { action: { timing: "night", effect: "fake_kill", targetMode: "one_alive_other" } }),
  substitute: r("substitute", "替死鬼", "village", "每局一次犧牲自己並復活一名已死亡玩家。", "discussion", { action: { timing: "night", effect: "sacrifice_revive", targetMode: "one_dead", oncePerGame: true } }),
  village_chief: r("village_chief", "村長", "village", "若啟用警長玩法，可在警長選舉前指定第一任警長。", "discussion", { action: { timing: "setup", effect: "appoint_sheriff", targetMode: "one_alive_other", oncePerGame: true } }),
  captain: r("captain", "船長", "village", "知道所有玩家真實職業，但不能進行正式辯論發言。", "discussion", { passives: ["knows_all_roles", "skip_formal_debate"] }),
  judge: r("judge", "法官", "village", "白天一次性直接裁決一人出局並立即進夜晚。", "discussion", { action: { timing: "day", effect: "force_exile", targetMode: "one_alive_other", oncePerGame: true } }),
  gravekeeper: r("gravekeeper", "守墓人", "village", "每早得知上一夜遭狼人殺害玩家的真實職業。", "discussion", { passives: ["learn_wolf_victim_role"] }),
  magician: r("magician", "魔術師", "village", "每局一次選兩人：若一死一活則交換生死；都活著則交換職業。", "discussion", { action: { timing: "night", effect: "magician_swap", targetMode: "two_any", oncePerGame: true } }),
  noble: r("noble", "貴族", "village", "原作傳送改為辯論式：每晚指定一人，在翌日其正式發言後獲得一次強制回應權。", "adapted", { action: { timing: "night", effect: "mark_for_reply", targetMode: "one_alive_other" }, debateAdaptation: "移除傳送，改為對指定玩家正式發言後取得追加回應權。" }),
  guardian: r("guardian", "守護者", "village", "開局選擇一名守護對象；守護者存活時該玩家免於一般夜殺。", "adapted", { action: { timing: "night", effect: "set_permanent_guard", targetMode: "one_alive_other", oncePerGame: true }, debateAdaptation: "移除距離與物理無敵，改為存活期間的夜殺保護連結。" }),

  sun_wolf: r("sun_wolf", "日狼", "werewolf", "不參與普通夜刀；白天可在自己正式發言後一次刺殺一人。", "discussion", { action: { timing: "day", effect: "day_assassinate", targetMode: "one_alive_non_wolf", oncePerGame: true }, passives: ["hidden_from_wolf_list"] }),
  medicine_wolf: r("medicine_wolf", "藥狼", "werewolf", "免疫女巫／男巫毒藥，並能辨識被解藥救下的狼刀目標。", "discussion", { passives: ["poison_immune", "learn_healed_wolf_target", "wolf_chat"] }),
  young_wolf: r("young_wolf", "幼狼", "werewolf", "前三輪不能提交狼刀，且預言家陣營查驗視為好人；之後恢復普通狼人。", "discussion", { passives: ["wolf_chat", "young_wolf_delayed_kill", "seer_village_until_round4"] }),
  vampire_wolf: r("vampire_wolf", "吸血鬼（狼人版）", "werewolf", "成功參與數次狼刀後獲得一次夜間死亡護盾；放逐仍直接出局。", "discussion", { passives: ["wolf_chat", "kills_charge_night_shield"] }),
  secondary_snow_wolf: r("secondary_snow_wolf", "次雪狼", "werewolf", "第一次被預言家查驗顯示好人，之後顯示狼人。", "discussion", { passives: ["first_seer_looks_village", "wolf_chat"] }),
  wise_wolf: r("wise_wolf", "慧狼", "werewolf", "狼隊名單會排除詐欺師等偽裝成狼的好人，降低假隊友干擾。", "discussion", { passives: ["accurate_wolf_list", "wolf_chat"] }),
  confusing_wolf: r("confusing_wolf", "惑狼", "werewolf", "每局一次標記一人；若目標在當晚或隔日死亡，會以狼人身份復生。", "discussion", { action: { timing: "night", effect: "mark_convert_on_death", targetMode: "one_alive_non_wolf", oncePerGame: true }, passives: ["wolf_chat"] }),
  shadow_wolf: r("shadow_wolf", "影狼", "werewolf", "原作距離條件改為辯論式：若目標同晚也被其他主動技能指向，影殺成功。", "adapted", { action: { timing: "night", effect: "kill_if_targeted_by_other", targetMode: "one_alive_non_wolf" }, passives: ["wolf_chat"], debateAdaptation: "移除四格距離判定，改為同夜是否被其他指向技能鎖定。" }),
  law_wolf: r("law_wolf", "法狼", "werewolf", "每晚遮蔽一名玩家的查驗結果，使該晚身份／陣營查驗回傳『被隱藏』。", "discussion", { action: { timing: "night", effect: "hide_inspection_result", targetMode: "one_alive_other" }, passives: ["wolf_chat"] }),
  resentful_wolf: r("resentful_wolf", "怨狼", "werewolf", "殺死或放逐怨狼的玩家，接下來兩夜主動技能失效。", "discussion", { passives: ["revenge_disable_killer_two_nights", "wolf_chat"] }),
  debate_wolf: r("debate_wolf", "辯狼", "werewolf", "白天一次性把目前投給自己的票全部轉移到指定玩家。", "discussion", { action: { timing: "vote", effect: "redirect_votes_from_self", targetMode: "one_alive_other", oncePerGame: true }, passives: ["wolf_chat"] }),
  wolf_priest: r("wolf_priest", "祭司", "werewolf", "每局一次標記一人；該人死亡時額外帶走一名好人。", "discussion", { action: { timing: "night", effect: "mark_chain_kill_village", targetMode: "one_alive_non_wolf", oncePerGame: true }, passives: ["wolf_chat"] }),
  wind_wolf: r("wind_wolf", "風狼", "werewolf", "原作傳送改為辯論式：每晚可把一名玩家的指向性技能重新導向另一合法目標。", "adapted", { action: { timing: "night", effect: "redirect_targeted_action", targetMode: "one_alive_other" }, passives: ["wolf_chat"], debateAdaptation: "移除傳送，改為下一次指向技能的伺服器端重新導向。" }),
  disguiser_wolf: r("disguiser_wolf", "偽裝者", "werewolf", "原作空手殺人改為資訊偽裝：夜間不出現在普通狼隊公開名單，查驗預設視為村民。", "adapted", { passives: ["hidden_from_wolf_list", "seer_looks_village"], debateAdaptation: "移除裝備與空手擊殺，改為狼隊名單與查驗資訊偽裝。" }),
  wolf_cop: r("wolf_cop", "狼警", "werewolf", "原作碰撞判定改為查驗：每晚查一人是否為偽狼／叛狼；判斷錯誤會使自己受反噬。", "adapted", { action: { timing: "night", effect: "wolf_cop_check", targetMode: "one_alive_other" }, passives: ["wolf_chat"], debateAdaptation: "移除碰撞／擊殺互動，改為偽狼資訊查驗與錯判反噬。" }),
  elder_wolf: r("elder_wolf", "長老狼", "werewolf", "第二晚起一次性指定一人強制死亡並立即天亮。", "discussion", { action: { timing: "night", effect: "strong_kill", targetMode: "one_alive_non_wolf", oncePerGame: true, fromRound: 2 }, passives: ["wolf_chat"] }),

  ferry_spirit: r("ferry_spirit", "渡靈", "spirit", "不會被一次查驗直接超度，但白天只要收到任何有效票就會在投票結算時死亡。", "discussion", { passives: ["spirit_team", "dies_if_any_vote"] }),
  cursed_spirit: r("cursed_spirit", "咒靈", "spirit", "預言家查驗會使預言家的下次查驗失靈；被票出時投票者也受到能力干擾。", "discussion", { passives: ["curse_seer_on_inspect", "curse_voters_on_exile", "spirit_team"] }),
  ancestral_spirit: r("ancestral_spirit", "祖靈", "spirit", "需要被預言家類角色查驗兩次才會遭到超度。", "discussion", { passives: ["two_inspections_to_exorcise", "spirit_team"] }),
  purifying_spirit: r("purifying_spirit", "淨靈", "spirit", "原作強制隱形改為辯論式：夜晚讓一名玩家的陣營查驗結果暫時隱藏。", "adapted", { action: { timing: "night", effect: "hide_inspection_result", targetMode: "one_alive_other" }, passives: ["spirit_team"], debateAdaptation: "移除強制隱形，改為單晚查驗結果遮蔽。" }),

  gambler: r("gambler", "賭徒", "neutral", "首夜秘密選擇要支持的陣營，最後跟該陣營一起計算勝利。", "discussion", { action: { timing: "night", effect: "choose_allegiance", targetMode: "none", oncePerGame: true, options: ["village", "werewolf", "spirit"] } }),
  burglar: r("burglar", "竊賊", "neutral", "第二晚偷取一名玩家職業；若目標是狼人則目標死亡，否則目標變村民。", "discussion", { action: { timing: "night", effect: "burglar_steal", targetMode: "one_alive_other", oncePerGame: true, fromRound: 2 } }),
  suicide_bomber: r("suicide_bomber", "自殺炸彈客", "neutral", "原作範圍爆炸改為白天公開自爆並指定最多兩人同死；若因此場上只剩自己陣營則獨贏。", "adapted", { action: { timing: "day", effect: "suicide_bomb", targetMode: "two_alive_other", oncePerGame: true }, debateAdaptation: "移除爆炸半徑，改為白天公開自爆並指定最多兩名目標。" }),
  coward: r("coward", "懦夫", "neutral", "當場上剛好剩一名狼人、一名好人與懦夫時，懦夫獨自獲勝。", "discussion", { passives: ["coward_three_player_win"] }),
  sniper_eight_wolf: r("sniper_eight_wolf", "狙八狼", "werewolf", "不與狼隊相認；每兩晚可秘密狙殺一人。", "adapted", { action: { timing: "night", effect: "cooldown_kill", targetMode: "one_alive_other" }, passives: ["hidden_from_wolf_list"], debateAdaptation: "移除望遠鏡瞄準、煙火與移動限制，改為有冷卻的秘密狙殺。" }),
  demon_hunter: r("demon_hunter", "獵魔師", "village", "每晚狩獵一人；非好人目標死亡，好人目標則使獵魔師死亡。", "discussion", { action: { timing: "night", effect: "hunt_non_village", targetMode: "one_alive_other" } }),
  fist_brother: r("fist_brother", "擊拳兄弟", "neutral", "每晚秘密選擇自己認為的同伴；選錯會自己死亡，最後一名兄弟轉生成懦夫。", "adapted", { action: { timing: "night", effect: "identify_partner", targetMode: "one_alive_other" }, passives: ["last_fist_becomes_coward"], debateAdaptation: "移除空手碰撞，改為夜間秘密辨認同伴；選錯自我出局。" }),

  alchemist: r("alchemist", "煉金術師", "village", "技能依序為黑化、白化、純化：干擾、保護、擊殺，必須按順序使用。", "discussion", { action: { timing: "night", effect: "alchemist_sequence", targetMode: "optional_alive_other" } }),
  demon_wolf: r("demon_wolf", "魔狼", "werewolf", "每晚查驗一人真實職業；第一次被好人指向性技能命中時免疫並反噬施術者。", "discussion", { action: { timing: "night", effect: "inspect_true_role", targetMode: "one_alive_non_wolf" }, passives: ["retaliate_village_targeted_action_once", "wolf_chat"] }),
  lurking_wolf: r("lurking_wolf", "潛伏狼", "werewolf", "第一隻其他狼人出局前不與狼隊相認且不被一般查驗識破；之後可血祭一人解除潛伏。", "discussion", { action: { timing: "night", effect: "awaken_if_wolf_dead", targetMode: "one_alive_non_wolf", oncePerGame: true }, passives: ["hidden_from_wolf_list", "hidden_from_inspection_until_awake"] }),
  vampire: r("vampire", "吸血鬼", "blood", "每晚感染一名玩家加入血族；場上所有存活玩家都屬血族時血族獲勝。", "discussion", { action: { timing: "night", effect: "infect_blood", targetMode: "one_alive_other" }, passives: ["blood_endgame"] })
};

export const ROLE_LIST = Object.values(ROLE_REGISTRY);

export function roleDefinition(role: Role): RoleDefinition {
  return ROLE_REGISTRY[role];
}

export function rolesByFaction(faction: Faction): RoleDefinition[] {
  return ROLE_LIST.filter((role) => role.faction === faction);
}
