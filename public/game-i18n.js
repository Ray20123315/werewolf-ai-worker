(() => {
  const ROLE = {
    cupid:["丘比特","Cupid","首夜配对两名玩家成为恋人；恋人共享特殊存活关系。","On the first night, link two players as lovers; lovers share a special survival bond."],
    seer:["预言家","Seer","每晚查验一名玩家的阵营。","Inspect one player's faction each night."],
    apprentice_seer:["见习预言家","Apprentice Seer","预言家死亡后继承查验能力与可传承记录。","Inherit the Seer's inspection ability and inheritable records after the Seer dies."],
    witch:["女巫","Witch","拥有一次解药与一次毒药，每晚最多使用其中一种。","Has one antidote and one poison; may use at most one of them each night."],
    hunter:["猎人","Hunter","死亡后可公开带走一名仍存活的玩家。","After dying, may publicly take one living player down as well."],
    ninja:["忍者","Ninja","夜晚选择替身；自己遭夜间死亡时可把死亡转移给替身一次。","Choose a substitute at night; once, redirect your own night death to that substitute."],
    fraudster:["诈欺师","Fraudster","好人方卧底，阵营查验看起来像狼人。","A village-aligned infiltrator whose faction inspections appear werewolf."],
    masochist_cultist:["抖M教徒","Masochist Cultist","自己的普通投票为无效票；若白天成为唯一最高票者则触发个人特殊胜利。","Your normal vote has zero weight; if you become the sole top-voted player by day, you achieve a personal special victory."],
    sadist_leader:["抖S教主","Sadist Leader","每晚可指定一名抖M教徒成为肉盾，替自己承受一次夜间死亡。","Each night, designate a Masochist Cultist as a bodyguard who can absorb one night death for you."],
    mermaid:["人鱼","Mermaid","每晚可影响狼人的攻击对象，把狼刀导向另一名合法目标。","Each night, influence the werewolf attack and redirect it to another legal target."],
    gravedigger:["掘墓者","Gravedigger","夜晚选择一名死者并变成其职业。","Choose a dead player at night and become that player's role."],
    knight:["骑士","Knight","白天公开决斗：对方是狼人则对方死亡，否则骑士死亡；成功时直接入夜。","Publicly duel by day: if the target is a werewolf, the target dies; otherwise the Knight dies. A successful duel goes directly to night."],
    guard:["守卫","Guard","每晚守护一名玩家，不能连续两晚守同一人。","Protect one player each night; the same player cannot be protected on consecutive nights."],
    detective:["侦探","Detective","原作追踪隐形改为辩论式：查询目标本晚是否使用主动技能以及技能类型。","Debate adaptation of tracking: learn whether the target used an active ability tonight and what type it was."],
    lecher:["色狼","Lecher","夜晚骚扰一名玩家并累积造访记录；完成房内多名不同玩家造访可获得个人成就胜利。","Visit one player at night and build a visit record; visiting enough different players can earn a personal achievement victory."],
    thief:["盗贼","Thief","夜晚标记一名玩家，隔天交换／偷取其职业。","Mark one player at night and swap or steal that player's role the next day."],
    villager:["村民","Villager","没有主动技能，只靠公开信息、发言与票型推理。","Has no active ability; relies on public information, discussion, and voting patterns."],
    priest:["牧师","Priest","查验吸血狼；查中时直接消灭吸血狼并获得一次死亡护盾。","Inspect for the Vampire Wolf; on a hit, destroy it and gain one death shield."],
    observer:["观察家","Observer","每晚观察一人，可识破伪装并取得其真实身份类型。","Observe one player each night, seeing through disguises to obtain the true role type."],
    dream_guide:["引梦人","Dream Guide","每晚必须选择一名梦游者；梦游者当夜免于死亡，但引梦人夜死时梦游者一同死亡。","Must choose a sleepwalker each night; the sleepwalker cannot die that night, but dies with the Dream Guide if the Guide dies at night."],
    trapper:["陷阱师","Trapper","每晚标记一人；被标记者若隔日投票则在投票结算后死亡。","Mark one player each night; if that player votes the next day, they die after vote resolution."],
    ghost_hunter:["猎鬼人","Ghost Hunter","第二晚起狩猎：非好人目标死亡；好人目标则自己死亡。","From night two onward, hunt a target: non-village targets die; targeting a village player kills the Ghost Hunter instead."],
    warlock:["男巫","Warlock","有一次毒药与一次灵药；灵药可使目标当夜技能失效。","Has one poison and one spirit potion; the spirit potion disables the target's ability for that night."],
    diviner:["占卜师","Diviner","每晚查验一名玩家的真实职业，不受雪狼等阵营伪装影响。","Inspect one player's true role each night, ignoring faction disguises such as Snow Wolf."],
    yin_yang_master:["阴阳师","Yin-Yang Master","每晚给一名玩家白阳或夜阴祝福，分别抵挡下一次白天或夜晚死亡。","Each night, grant a player a Daylight or Nightshade blessing, blocking their next day or night death respectively."],
    angel:["天使","Angel","查验真实职业；第二晚起查到狼人时，目标在天亮后死亡。","Inspect true roles; from night two onward, an inspected werewolf dies after dawn."],
    medium:["灵媒","Medium","白天有人被放逐后，入夜时得知该玩家所属阵营。","After a player is exiled by day, learn that player's faction when night begins."],
    raven:["乌鸦","Raven","夜晚诅咒一人，使其翌日投票结算时多一票；至少有一般有效票时才生效。","Curse one player at night so they receive one extra vote at the next vote resolution, provided at least one normal valid vote exists."],
    queen_bee:["女王蜂","Queen Bee","原作范围状态改为辩论式：撒鳞粉使目标下一次主动技能失效；自己夜死时对标记者留下延迟毒刺。","Debate adaptation: pollen disables the target's next active ability; if the Queen Bee dies at night, the marked target receives a delayed sting."],
    bear_tamer:["驯熊师","Bear Tamer","原作距离熊系技能改为每晚选两人，得知两人中是否至少一名狼人。","Debate adaptation: choose two players each night and learn whether at least one of them is a werewolf."],
    physicist:["物理学家","Physicist","能额外承受一次狼人夜杀；第二次才真正死亡。","Can survive one additional werewolf night kill; the second one truly kills the Physicist."],
    pharmacist:["药剂师","Pharmacist","每晚对一人下药；同一目标第一剂保护狼刀，第二剂直接死亡。","Dose one player each night; the first dose on the same target protects from a wolf kill, while the second kills the target outright."],
    sacrifice:["祭品","Sacrifice","若被狼人夜杀，天亮时系统公开其中一名存活狼人的身份。","If killed by werewolves at night, the system reveals one surviving werewolf at dawn."],
    sniper:["狙击手","Sniper","白天一次性公开自己身份并指定最多两人直接死亡。","Once per game by day, reveal your identity and directly kill up to two chosen players."],
    scout:["侦查兵","Scout","白天一次性公开一名玩家的真实职业。","Once per game by day, publicly reveal one player's true role."],
    verifier:["验证者","Verifier","每早得知上一轮有投有效票的玩家中是否存在狼人。","Each morning, learn whether any player who cast a valid vote in the previous round was a werewolf."],
    confirmed_villager:["金水","Confirmed Villager","开局即由系统公开确认为好人阵营。","Publicly confirmed by the system as village-aligned at game start."],
    scapegoater:["嫁祸者","Scapegoater","第一次被票出时公开身份并把放逐结果转移给另一名玩家。","The first time you would be voted out, reveal your identity and redirect the exile to another player."],
    witness:["证人","Witness","第一次发生狼人夜杀时，秘密得知执行狼刀的其中一名狼人。","On the first werewolf night kill, secretly learn one werewolf who participated in the kill."],
    traitor_wolf:["叛狼","Traitor Wolf","好人阵营的危险卧底：查验呈狼人，每晚可独立杀一人。","A dangerous village-aligned infiltrator: appears werewolf to inspections and can independently kill one player each night."],
    bee:["蜜蜂","Bee","蜂巢死亡后解锁一次夜间带走一人的能力。","When the Hive dies, unlock a one-time night ability to take one player down."],
    hive:["蜂巢","Hive","与蜜蜂配套；辩论式中本身没有主动技能，死亡会唤醒蜜蜂。","Paired with Bee; has no active ability in debate mode, but its death awakens the Bee."],
    curse_caster:["咒术师","Curse Caster","整合两版提案：夜晚标记一人；可选择让目标下一次技能失效，或在自己夜死时代替自己死亡（一次）。","Combined proposal: mark one player at night; either disable the target's next ability, or once substitute that target for your own night death."],
    hacker:["骇客","Hacker","每局一次把目标改成同阵营的另一个职业。","Once per game, change the target into another role from the same faction."],
    precog:["预知者","Precog","投票阶段可秘密看见目前最高票玩家的真实职业。","During voting, secretly see the true role of the current top-voted player."],
    discriminator:["辨别者","Discriminator","投给好人阵营时自己的票视为无效。","Your vote has no effect when cast against a village-aligned player."],
    betrayer:["背叛者","Betrayer","死亡后胜利阵营改为狼人；生前仍按好人信息游玩。","After death, your winning faction changes to werewolf; while alive, you still play with village information."],
    fake_killer:["伪杀者","Fake Killer","每晚可制造一名假死者；天亮会显示死亡，但隔天早晨复活。","Each night, create one fake death; the player appears dead at dawn but revives the following morning."],
    substitute:["替死鬼","Substitute","每局一次牺牲自己并复活一名已死亡玩家。","Once per game, sacrifice yourself to revive one dead player."],
    village_chief:["村长","Village Chief","若启用警长玩法，可在警长选举前指定第一任警长。","If sheriff mode is enabled, appoint the first sheriff before the sheriff election."],
    captain:["船长","Captain","知道所有玩家真实职业，但不能进行正式辩论发言。","Knows every player's true role but cannot make formal debate speeches."],
    judge:["法官","Judge","白天一次性直接裁决一人出局并立即进夜晚。","Once per game by day, directly remove one player and immediately enter night."],
    gravekeeper:["守墓人","Gravekeeper","每早得知上一夜遭狼人杀害玩家的真实职业。","Each morning, learn the true role of the player killed by werewolves the previous night."],
    magician:["魔术师","Magician","每局一次选两人：若一死一活则交换生死；都活着则交换职业。","Once per game, choose two players: if one is dead and one alive, swap life and death; if both are alive, swap roles."],
    noble:["贵族","Noble","原作传送改为辩论式：每晚指定一人，在翌日其正式发言后获得一次强制回应权。","Debate adaptation: designate one player each night; after that player's formal speech the next day, gain one forced reply."],
    guardian:["守护者","Guardian","开局选择一名守护对象；守护者存活时该玩家免于一般夜杀。","Choose one protected player at game start; while the Guardian lives, that player is immune to ordinary night kills."],
    demon_hunter:["猎魔师","Demon Hunter","每晚狩猎一人；非好人目标死亡，好人目标则使猎魔师死亡。","Hunt one player each night; non-village targets die, while targeting a village player kills the Demon Hunter."],
    alchemist:["炼金术师","Alchemist","技能依序为黑化、白化、纯化：干扰、保护、击杀，必须按顺序使用。","Abilities proceed in order—blackening, whitening, purification—for disruption, protection, and killing, and must be used sequentially."],

    werewolf:["狼人","Werewolf","夜晚与狼队共同选择击杀目标。","Choose a kill target together with the wolf team at night."],
    black_wolf_king:["黑狼王","Black Wolf King","狼人中的猎人，死亡时可带走一名玩家。","A hunter among werewolves; when dying, may take one player down."],
    white_wolf_king:["白狼王","White Wolf King","白天可自爆并带走一名玩家，之后直接进夜晚。","May self-destruct by day and take one player down, then immediately enter night."],
    snow_wolf:["雪狼","Snow Wolf","预言家类阵营查验会把你视为好人。","Faction inspections such as the Seer's see you as village-aligned."],
    shapeshifter_wolf:["百变狼","Shapeshifter Wolf","夜晚伪装成一名玩家，使身份查验得到伪装目标信息。","Disguise as one player at night so identity inspections return the disguised target's information."],
    primordial_wolf:["原初狼","Primordial Wolf","狼群叛徒；普通狼人辨认队友时会受到干扰。","A traitor within the pack who interferes with ordinary werewolves identifying teammates."],
    berserker_wolf:["暴走狼","Berserker Wolf","原作速度成长改成辩论式：狼队成功刀人后累积一次白天额外票权。","Debate adaptation: after a successful wolf kill, accumulate an extra daytime vote bonus."],
    bomb_wolf:["炸弹狼","Bomb Wolf","白天把炸弹植入玩家；被标记者下一次投票会把炸弹传给投票目标，结算时持有者承受额外放逐票。","Plant a bomb on a player by day; when the holder next votes, the bomb passes to that target, and the final holder receives an extra exile vote at resolution."],
    blood_wolf:["血狼","Blood Wolf","白天自爆可取消当日投票并使下一夜好人主动技能失效；最后一狼被票出时可延后死亡一夜。","A daytime self-destruct can cancel that day's vote and disable village active abilities the next night; if voted out as the last wolf, death can be delayed one night."],
    vampire_wolf_copy:["吸血狼","Vampire Wolf","夜晚复制一名玩家的主动能力直到该玩家死亡，并使其下一次能力失灵。","Copy one player's active ability at night until that player dies, and make the target's next ability fail."],
    mimic_wolf:["模仿狼","Mimic Wolf","原作换头颅改为辩论式：选择一名玩家作为公开／查验伪装身份。","Debate adaptation: choose a player as your public and inspection disguise identity."],
    great_wolf:["大野狼","Great Wolf","每局一次使用强袭狼刀，无视普通守护。","Once per game, use a powerful wolf kill that ignores ordinary protection."],
    dream_wolf:["梦狼／噩梦","Dream Wolf / Nightmare","每晚恐惧一名玩家，使其该晚主动技能失效。","Frighten one player each night, disabling that player's active ability for the night."],
    persuader_wolf:["说服狼","Persuader Wolf","只剩自己为最后一狼时可一次把一名非狼人转为狼人。","When you are the last wolf, once convert one non-werewolf into a werewolf."],
    wolf_beauty:["狼美人","Wolf Beauty","每晚魅惑一人；狼美人出局时目前魅惑对象一同殉情。","Charm one player each night; when Wolf Beauty is eliminated, the currently charmed target dies with her."],
    devil:["恶魔","Devil","查验真实职业；第二晚起查到天使时使其天亮后死亡。","Inspect true roles; from night two onward, inspecting the Angel causes the Angel to die after dawn."],
    wolf_witch:["狼巫","Wolf Witch","第二晚起可使用一次穿透守卫的毒药；被此毒杀的猎人不能开枪。","From night two onward, may once use poison that pierces Guard protection; a Hunter killed this way cannot fire."],
    wealthy_wolf:["财狼","Wealthy Wolf","每局一次使一名非狼人玩家的主动技能永久失效。","Once per game, permanently disable one non-werewolf player's active ability."],
    vomit_wolf:["呕吐狼","Vomit Wolf","原作范围异常改成资源型辩论效果：累积层数后让目标下一次投票或技能失效。","Debate adaptation: build resource stacks, then spend them to invalidate a target's next vote or ability."],
    sun_wolf:["日狼","Sun Wolf","不参与普通夜刀；白天可在自己正式发言后一次刺杀一人。","Does not join the normal wolf kill; once by day, after your formal speech, assassinate one player."],
    medicine_wolf:["药狼","Medicine Wolf","免疫女巫／男巫毒药，并能辨识被解药救下的狼刀目标。","Immune to Witch and Warlock poison, and can identify a wolf-kill target saved by antidote."],
    young_wolf:["幼狼","Young Wolf","前三轮不能提交狼刀，且预言家阵营查验视为好人；之后恢复普通狼人。","Cannot submit wolf kills for the first three rounds and appears village to faction inspection; afterward becomes a normal werewolf."],
    vampire_wolf:["吸血鬼（狼人版）","Vampire (Wolf)","成功参与数次狼刀后获得一次夜间死亡护盾；放逐仍直接出局。","After participating in enough successful wolf kills, gain one night death shield; exile still removes you immediately."],
    secondary_snow_wolf:["次雪狼","Secondary Snow Wolf","第一次被预言家查验显示好人，之后显示狼人。","The first Seer inspection shows village; later inspections show werewolf."],
    wise_wolf:["慧狼","Wise Wolf","狼队名单会排除诈欺师等伪装成狼的好人，降低假队友干扰。","The wolf teammate list excludes village players disguised as wolves, reducing false-teammate interference."],
    confusing_wolf:["惑狼","Confusing Wolf","每局一次标记一人；若目标在当晚或隔日死亡，会以狼人身份复生。","Once per game, mark one player; if the target dies that night or the next day, the target revives as a werewolf."],
    shadow_wolf:["影狼","Shadow Wolf","原作距离条件改为辩论式：若目标同晚也被其他主动技能指向，影杀成功。","Debate adaptation: the shadow kill succeeds if the target is also targeted by another active ability that night."],
    law_wolf:["法狼","Law Wolf","每晚遮蔽一名玩家的查验结果，使该晚身份／阵营查验回传『被隐藏』。","Hide one player's inspection result each night so role or faction inspections return “hidden” for that night."],
    resentful_wolf:["怨狼","Resentful Wolf","杀死或放逐怨狼的玩家，接下来两夜主动技能失效。","A player who kills or exiles the Resentful Wolf has active abilities disabled for the next two nights."],
    debate_wolf:["辩狼","Debate Wolf","白天一次性把目前投给自己的票全部转移到指定玩家。","Once by day, redirect all current votes against yourself to a chosen player."],
    wolf_priest:["祭司","Wolf Priest","每局一次标记一人；该人死亡时额外带走一名好人。","Once per game, mark one player; when that player dies, an additional village player is taken down."],
    wind_wolf:["风狼","Wind Wolf","原作传送改为辩论式：每晚可把一名玩家的指向性技能重新导向另一合法目标。","Debate adaptation: each night, redirect one player's targeted ability to another legal target."],
    disguiser_wolf:["伪装者","Disguiser","原作空手杀人改为信息伪装：夜间不出现在普通狼队公开名单，查验预设视为村民。","Debate adaptation: hidden from the ordinary wolf team list at night and appears as a Villager to default inspections."],
    wolf_cop:["狼警","Wolf Cop","原作碰撞判定改为查验：每晚查一人是否为伪狼／叛狼；判断错误会使自己受反噬。","Debate adaptation: inspect one player each night for false-wolf or Traitor Wolf status; a wrong judgment backfires on you."],
    elder_wolf:["长老狼","Elder Wolf","第二晚起一次性指定一人强制死亡并立即天亮。","From night two onward, once designate one player to die immediately and force dawn."],
    sniper_eight_wolf:["狙八狼","Sniper Eight Wolf","不与狼队相认；每两晚可秘密狙杀一人。","Does not recognize the wolf team; every two nights may secretly snipe one player."],
    demon_wolf:["魔狼","Demon Wolf","每晚查验一人真实职业；第一次被好人指向性技能命中时免疫并反噬施术者。","Inspect one true role each night; the first village-targeted ability that hits you is negated and retaliates against its caster."],
    lurking_wolf:["潜伏狼","Lurking Wolf","第一只其他狼人出局前不与狼队相认且不被一般查验识破；之后可血祭一人解除潜伏。","Until another werewolf is eliminated, you neither recognize the pack nor show up to ordinary inspections; afterward sacrifice one player to end your lurking state."],

    wraith:["怨灵","Wraith","夜晚不会被一般狼刀杀死；狼人全灭且仍有怨灵存活时怨灵阵营可抢先胜利。","Cannot be killed by an ordinary wolf attack at night; if all werewolves are gone while a spirit survives, the spirit faction can claim victory first."],
    voodoo_girl:["巫毒女孩","Voodoo Girl","每晚诅咒玩家并累积层数，达门槛时目标死亡。","Curse a player each night and accumulate stacks; the target dies when the threshold is reached."],
    tempter:["蛊惑师","Tempter","每晚诅咒一名玩家；对查验职业会使其下一次技能失效。","Curse one player each night; if the target is an inspection role, its next ability fails."],
    necromancer:["死灵法师","Necromancer","依死亡比例解锁信息、护盾与咒杀能力。","Unlock information, a shield, and curse-kill abilities as the proportion of dead players rises."],
    poltergeist:["骚灵","Poltergeist","每晚监视一人的技能使用；可得知其有无技能与目标，并干扰其目标。","Monitor one player's ability use each night, learning whether an ability was used and its target, and interfere with that target."],
    ferry_spirit:["渡灵","Ferry Spirit","不会被一次查验直接超度，但白天只要收到任何有效票就会在投票结算时死亡。","Cannot be exorcised by a single inspection, but dies at vote resolution if it receives any valid daytime vote."],
    cursed_spirit:["咒灵","Cursed Spirit","预言家查验会使预言家的下次查验失灵；被票出时投票者也受到能力干扰。","A Seer inspection causes the Seer's next inspection to fail; when voted out, voters also suffer ability interference."],
    ancestral_spirit:["祖灵","Ancestral Spirit","需要被预言家类角色查验两次才会遭到超度。","Must be inspected twice by Seer-type roles before being exorcised."],
    purifying_spirit:["净灵","Purifying Spirit","原作强制隐形改为辩论式：夜晚让一名玩家的阵营查验结果暂时隐藏。","Debate adaptation: at night, temporarily hide one player's faction inspection result."],

    vampire:["吸血鬼","Vampire","每晚感染一名玩家加入血族；场上所有存活玩家都属血族时血族获胜。","Infect one player each night into the blood faction; the blood faction wins when every living player belongs to it."],

    spy:["间谍","Spy","开局秘密分配要协助的阵营，技能以谍报信息为主，胜负跟随指定阵营。","Secretly assigned a faction to support at game start; abilities focus on intelligence and victory follows the assigned faction."],
    ice_queen:["冰雪女王","Ice Queen","每晚冻结一人；可引爆所有被冻结者，若自己造成的死亡超过初始玩家半数则独赢。","Freeze one player each night; may detonate all frozen players, and wins alone if deaths caused exceed half the initial player count."],
    red_axe_madman:["赤斧狂魔","Red Axe Madman","狼人全灭后继承夜杀权，目标成为最后存活阵营。","After all werewolves are gone, inherit the night-kill power and aim to become the last surviving faction."],
    gambler:["赌徒","Gambler","首夜秘密选择要支持的阵营，最后跟该阵营一起计算胜利。","Secretly choose a faction to support on the first night and share that faction's final victory result."],
    burglar:["窃贼","Burglar","第二晚偷取一名玩家职业；若目标是狼人则目标死亡，否则目标变村民。","On night two, steal one player's role; if the target is a werewolf the target dies, otherwise the target becomes a Villager."],
    suicide_bomber:["自杀炸弹客","Suicide Bomber","原作范围爆炸改为白天公开自爆并指定最多两人同死；若因此场上只剩自己阵营则独赢。","Debate adaptation: publicly self-destruct by day and choose up to two players to die with you; if this leaves only your faction, you win alone."],
    coward:["懦夫","Coward","当场上刚好剩一名狼人、一名好人与懦夫时，懦夫独自获胜。","When exactly one werewolf, one village player, and the Coward remain, the Coward wins alone."],
    fist_brother:["击拳兄弟","Fist Brothers","每晚秘密选择自己认为的同伴；选错会自己死亡，最后一名兄弟转生成懦夫。","Each night, secretly choose who you think is your partner; a wrong choice kills you, and the last remaining brother becomes the Coward."]
  };

  const EXACT = {
    "原作":["原作","Original"],
    "辯論改寫":["辩论改写","Debate adaptation"],
    "討論角色":["讨论角色","Community role"],
    "數量":["数量","Count"],
    "系統":["系统","System"],
    "好人陣營":["好人阵营","Village faction"],
    "狼人陣營":["狼人阵营","Werewolf faction"],
    "怨靈陣營":["怨灵阵营","Spirit faction"],
    "血族陣營":["血族阵营","Blood faction"],
    "特殊／第三方":["特殊／第三方","Special / third party"],
    "翻譯中…":["翻译中…","Translating…"],
    "等待房主完成角色配置。":["等待房主完成角色配置。","Waiting for the host to finish role setup."],
    "AI 不是必需品。":["AI 不是必需品。","AI is optional."],
    "警長選舉進行中。":["警长选举进行中。","Sheriff election in progress."],
    "警長選舉":["警长选举","Sheriff election"],
    "退出候選":["退出候选","Withdraw"],
    "加入候選":["加入候选","Run for sheriff"],
    "投給候選人":["投给候选人","Vote for candidate"],
    "投警長票":["投警长票","Cast sheriff vote"],
    "你已投警長票。":["你已投警长票。","You have cast your sheriff vote."],
    "秘密技能階段":["秘密技能阶段","Secret ability phase"],
    "公開聊天室暫停。技能由伺服器統一結算，不靠距離、武器、追逐或 PvP。":["公开聊天室暂停。技能由服务器统一结算，不依赖距离、武器、追逐或 PvP。","Public chat is paused. Abilities are resolved by the server without distance, weapons, chasing, or PvP."],
    "你的身份本夜沒有必須操作的技能。":["你的身份本夜没有必须操作的技能。","Your role has no mandatory action tonight."],
    "等待其他玩家完成夜間行動。":["等待其他玩家完成夜间行动。","Waiting for other players to finish night actions."],
    "所有正式發言已完成，現在才開放放逐票。":["所有正式发言已完成，现在才开放放逐票。","All formal speeches are complete; exile voting is now open."],
    "確認投票":["确认投票","Confirm vote"],
    "你已投票，等待其他存活玩家。":["你已投票，等待其他存活玩家。","You have voted; waiting for the other living players."],
    "你目前是觀戰者。":["你目前是观战者。","You are currently a spectator."],
    "你已出局。":["你已出局。","You have been eliminated."],
    "身份已公開。房主可回大廳開始下一局。":["身份已公开。房主可回大厅开始下一局。","Roles are public. The host may return to the lobby for the next game."],
    "本階段不可聊天":["本阶段不可聊天","Chat unavailable in this phase"],
    "可自由聊天":["可自由聊天","Free chat available"]
  };

  const ADAPT = {
    "移除距離與隱形追蹤。":["移除距离与隐形追踪。","Removes distance and invisibility tracking."],
    "移除物理接觸，以秘密造訪紀錄取代。":["移除物理接触，以秘密造访记录取代。","Removes physical contact and replaces it with secret visit records."],
    "移除範圍虛弱與距離毒刺，改為技能封鎖與延遲死亡標記。":["移除范围虚弱与距离毒刺，改为技能封锁与延迟死亡标记。","Removes area weakness and distance stings, replacing them with ability blocking and delayed-death marks."],
    "移除 10 格距離與熊種移動效果，改為雙目標狼人存在性查驗。":["移除 10 格距离与熊种移动效果，改为双目标狼人存在性查验。","Removes 10-block distance and bear movement effects, replacing them with a two-target werewolf-presence check."],
    "移除傳送蜜蜂的物理互動，保留蜂巢死亡後喚醒蜜蜂的關係。":["移除传送蜜蜂的物理互动，保留蜂巢死亡后唤醒蜜蜂的关系。","Removes physical bee teleport interaction while retaining the Hive-death awakening relationship."],
    "移除傳送，改為對指定玩家正式發言後取得追加回應權。":["移除传送，改为对指定玩家正式发言后取得追加回应权。","Removes teleportation and grants an extra reply after the designated player's formal speech."],
    "移除距離與物理無敵，改為存活期間的夜殺保護連結。":["移除距离与物理无敌，改为存活期间的夜杀保护连结。","Removes distance and physical invulnerability, replacing them with a night-kill protection link while alive."],
    "移除移動速度，改為成功狼刀後累積投票影響力。":["移除移动速度，改为成功狼刀后累积投票影响力。","Removes movement speed and instead accumulates voting influence after successful wolf kills."],
    "移除裝備與皮膚變換。":["移除装备与皮肤变换。","Removes equipment and skin changes."],
    "移除範圍噁心、虛弱與移速狀態，改為可累積的技能封鎖資源。":["移除范围恶心、虚弱与移速状态，改为可累积的技能封锁资源。","Removes area nausea, weakness, and speed states, replacing them with a stackable ability-blocking resource."],
    "移除四格距離判定，改為同夜是否被其他指向技能鎖定。":["移除四格距离判定，改为同夜是否被其他指向技能锁定。","Removes the four-block distance check and instead checks whether another targeted ability selected the target that night."],
    "移除傳送，改為下一次指向技能的伺服器端重新導向。":["移除传送，改为下一次指向技能的服务器端重新导向。","Removes teleportation and instead redirects the next targeted ability on the server."],
    "移除裝備與空手擊殺，改為狼隊名單與查驗資訊偽裝。":["移除装备与空手击杀，改为狼队名单与查验信息伪装。","Removes equipment and bare-hand killing, replacing them with wolf-list and inspection-information disguise."],
    "移除碰撞／擊殺互動，改為偽狼資訊查驗與錯判反噬。":["移除碰撞／击杀互动，改为伪狼信息查验与错判反噬。","Removes collision and kill interaction, replacing it with false-wolf information checks and wrong-guess backlash."],
    "移除望遠鏡瞄準、煙火與移動限制，改為有冷卻的秘密狙殺。":["移除望远镜瞄准、烟火与移动限制，改为有冷却的秘密狙杀。","Removes scope aiming, fireworks, and movement limits, replacing them with a cooldown-based secret snipe."],
    "移除強制隱形，改為單晚查驗結果遮蔽。":["移除强制隐形，改为单晚查验结果遮蔽。","Removes forced invisibility and replaces it with one-night inspection-result hiding."],
    "移除爆炸半徑，改為白天公開自爆並指定最多兩名目標。":["移除爆炸半径，改为白天公开自爆并指定最多两名目标。","Removes blast radius and replaces it with a public daytime self-destruct selecting up to two targets."],
    "移除空手碰撞，改為夜間秘密辨認同伴；選錯自我出局。":["移除空手碰撞，改为夜间秘密辨认同伴；选错自我出局。","Removes bare-hand collision and replaces it with secret nighttime partner identification; a wrong choice eliminates yourself."]
  };

  const PATTERNS = [
    [/^房間 ([A-Z2-9]{6}) 已建立。人物密碼可用於重新登入；房內固定採辯論式流程。$/, m => [`房间 ${m[1]} 已建立。人物密码可用于重新登录；房内固定采用辩论式流程。`,`Room ${m[1]} was created. The player password can be used to sign back in; this room always uses the debate flow.`]],
    [/^(.+) 加入房間。$/, m => [`${m[1]} 加入房间。`,`${m[1]} joined the room.`]],
    [/^(.+) 以觀戰者身份重新加入；下一局可成為正式玩家。$/, m => [`${m[1]} 以观战者身份重新加入；下一局可成为正式玩家。`,`${m[1]} rejoined as a spectator and can become an active player next game.`]],
    [/^AI 玩家 (.+) 加入房間（(.+) \/ (.+)）。API Key 不會寫入房間狀態。$/, m => [`AI 玩家 ${m[1]} 加入房间（${m[2]} / ${m[3]}）。API Key 不会写入房间状态。`,`AI player ${m[1]} joined the room (${m[2]} / ${m[3]}). API keys are not written to room state.`]],
    [/^(.+) 已被房主踢出；這不是永久封鎖，可重新建立人物加入。$/, m => [`${m[1]} 已被房主踢出；这不是永久封禁，可重新建立人物加入。`,`${m[1]} was removed by the host. This is not a permanent ban; the player can create a new identity and rejoin.`]],
    [/^遊戲結束：(.+)。$/, m => [`游戏结束：${m[1]}。`,`Game over: ${m[1]}.`]],
    [/^(.+) 當選警長。$/, m => [`${m[1]} 当选警长。`,`${m[1]} was elected sheriff.`]],
    [/^(.+) 依候補順位繼任警長。$/, m => [`${m[1]} 依候补顺位继任警长。`,`${m[1]} became sheriff according to the succession order.`]],
    [/^第 (\d+) 夜開始。公開聊天暫停，所有技能由伺服器依固定結算順序處理。$/, m => [`第 ${m[1]} 夜开始。公开聊天暂停，所有技能由服务器依固定结算顺序处理。`,`Night ${m[1]} begins. Public chat is paused, and all abilities are resolved by the server in a fixed order.`]],
    [/^第 (\d+) 天早晨：昨夜是平安夜。$/, m => [`第 ${m[1]} 天早晨：昨夜是平安夜。`,`Morning ${m[1]}: nobody died last night.`]],
    [/^第 (\d+) 天早晨：昨夜有 (\d+) 名玩家死亡，房規隱藏死者與死因。$/, m => [`第 ${m[1]} 天早晨：昨夜有 ${m[2]} 名玩家死亡，房规隐藏死者与死因。`,`Morning ${m[1]}: ${m[2]} player(s) died last night; room rules hide the victims and causes.`]],
    [/^第 (\d+) 天早晨：(.+) 死亡；死因依房規隱藏。$/, m => [`第 ${m[1]} 天早晨：${m[2]} 死亡；死因依房规隐藏。`,`Morning ${m[1]}: ${m[2]} died; causes are hidden by room rules.`]],
    [/^(.+) 經辯論後被放逐出局。$/, m => [`${m[1]} 经辩论后被放逐出局。`,`${m[1]} was exiled after the debate.`]],
    [/^祭品效果公開：(.+) 是狼人陣營。$/, m => [`祭品效果公开：${m[1]} 是狼人阵营。`,`Sacrifice effect: ${m[1]} is publicly revealed as werewolf-aligned.`]],
    [/^(.+) 是系統公開確認的好人（金水）。$/, m => [`${m[1]} 是系统公开确认的好人（金水）。`,`${m[1]} is publicly confirmed by the system as village-aligned.`]],
    [/^(.+) 已完成舊房間人物密碼升級。$/, m => [`${m[1]} 已完成旧房间人物密码升级。`,`${m[1]} completed the legacy player-password upgrade.`]],
    [/^最高票平手：(.+)。依房規進行全場重投。$/, m => [`最高票平手：${m[1]}。依房规进行全场重投。`,`Top-vote tie: ${m[1]}. Room rules require a full revote.`]],
    [/^最高票平手：(.+)。依房規隨機抽中 (.+) 出局。$/, m => [`最高票平手：${m[1]}。依房规随机抽中 ${m[2]} 出局。`,`Top-vote tie: ${m[1]}. Under room rules, ${m[2]} was randomly selected for elimination.`]],
    [/^最高票平手，進入 PK 辯論：(.+)。平票者完成追加發言後，全場只可在這些候選人中重投。$/, m => [`最高票平手，进入 PK 辩论：${m[1]}。平票者完成追加发言后，全场只可在这些候选人中重投。`,`Top-vote tie. PK debate begins for ${m[1]}. After the tied players give extra speeches, everyone may revote only among these candidates.`]]
  ];

  const FIXED_SYSTEM = {
    "身份已由伺服器安全洗牌分配。遊戲只採辯論式，不含暴民/PvP 追殺機制。":["身份已由服务器安全洗牌分配。游戏只采用辩论式，不含暴民/PvP 追杀机制。","Roles were assigned by a secure server-side shuffle. The game uses debate mode only, with no mob/PvP chase mechanics."],
    "進入警長選舉。預設所有正式玩家都是候選人；玩家可退出候選，所有人投票後結算。平票會重選一次，再平票則本局無警長。 ":["进入警长选举。默认所有正式玩家都是候选人；玩家可退出候选，所有人投票后结算。平票会重选一次，再平票则本局无警长。","Sheriff election begins. All active players are candidates by default; players may withdraw. Results are resolved after everyone votes. A tie triggers one revote; a second tie means no sheriff this game."],
    "警長第一輪最高票平手，僅平票候選人進入第二輪重選。 ":["警长第一轮最高票平手，仅平票候选人进入第二轮重选。","The first sheriff vote tied; only the tied candidates advance to the second round."],
    "警長重選仍平票，本局不設警長。 ":["警长重选仍平票，本局不设警长。","The sheriff revote also tied; there will be no sheriff this game."],
    "現任警長出局，且已無存活候補，本局警長職位懸缺。 ":["现任警长出局，且已无存活候补，本局警长职位悬缺。","The current sheriff was eliminated and no living successor remains; the sheriff position is vacant."],
    "已回到大廳；上一局觀戰者已轉為下一局正式玩家。請重新設定角色配置。 ":["已回到大厅；上一局观战者已转为下一局正式玩家。请重新设置角色配置。","Returned to the lobby. Spectators from the previous game are now active players for the next game. Please configure roles again."],
    "炸彈在投票時被傳遞；目前持有者不公開。":["炸弹在投票时被传递；目前持有者不公开。","The bomb was passed during voting; the current holder remains hidden."],
    "重投後仍平票，或房規採平票無人出局；本日無人被放逐。 ":["重投后仍平票，或房规采用平票无人出局；本日无人被放逐。","The revote remained tied, or room rules specify no elimination on a tie; nobody is exiled today."],
    "本輪沒有形成有效最高票，無人出局。 ":["本轮没有形成有效最高票，无人出局。","No valid unique top vote was formed this round; nobody is eliminated."]
  };

  function targetIndex(locale) { return locale === "zh-CN" ? 0 : locale === "en" ? 1 : -1; }

  function role(roleId, field, locale, fallback) {
    if (locale === "zh-TW") return fallback;
    const row = ROLE[roleId];
    if (!row) return fallback;
    if (field === "name") return locale === "zh-CN" ? row[0] : row[1];
    if (field === "summary") return locale === "zh-CN" ? row[2] : row[3];
    return fallback;
  }

  function text(source, locale) {
    const raw = String(source ?? "");
    if (!raw || locale === "zh-TW") return raw;
    const index = targetIndex(locale);
    const exact = EXACT[raw] || FIXED_SYSTEM[raw];
    if (exact) return exact[index] || raw;
    if (raw.startsWith("辯論改寫：")) {
      const detail = raw.slice("辯論改寫：".length);
      const translated = ADAPT[detail];
      if (translated) return `${locale === "zh-CN" ? "辩论改写：" : "Debate adaptation: "}${translated[index]}`;
    }
    for (const [regex, build] of PATTERNS) {
      const match = raw.match(regex);
      if (match) return build(match)[index] || raw;
    }
    return raw;
  }

  function canTranslate(source) {
    const raw = String(source ?? "");
    if (EXACT[raw] || FIXED_SYSTEM[raw] || (raw.startsWith("辯論改寫：") && ADAPT[raw.slice("辯論改寫：".length)])) return true;
    return PATTERNS.some(([regex]) => regex.test(raw));
  }

  window.WerewolfGameI18n = { role, text, canTranslate };
})();