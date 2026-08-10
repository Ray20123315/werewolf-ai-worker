(() => {
  const base = window.WerewolfGameI18n;
  if (!base) return;
  const N = {
    "邱比特":["丘比特","Cupid"],"預言家":["预言家","Seer"],"見習預言家":["见习预言家","Apprentice Seer"],"女巫":["女巫","Witch"],"獵人":["猎人","Hunter"],"忍者":["忍者","Ninja"],"詐欺師":["诈欺师","Fraudster"],"抖M教徒":["抖M教徒","Masochist Cultist"],"抖S教主":["抖S教主","Sadist Leader"],"人魚":["人鱼","Mermaid"],"掘墓者":["掘墓者","Gravedigger"],"騎士":["骑士","Knight"],"守衛":["守卫","Guard"],"偵探":["侦探","Detective"],"色狼":["色狼","Lecher"],"盜賊":["盗贼","Thief"],"村民":["村民","Villager"],"牧師":["牧师","Priest"],"觀察家":["观察家","Observer"],"引夢人":["引梦人","Dream Guide"],"陷阱師":["陷阱师","Trapper"],"獵鬼人":["猎鬼人","Ghost Hunter"],"男巫":["男巫","Warlock"],"占卜師":["占卜师","Diviner"],"陰陽師":["阴阳师","Yin-Yang Master"],"天使":["天使","Angel"],"靈媒":["灵媒","Medium"],"烏鴉":["乌鸦","Raven"],"女王蜂":["女王蜂","Queen Bee"],"馴熊師":["驯熊师","Bear Tamer"],"物理學家":["物理学家","Physicist"],"藥劑師":["药剂师","Pharmacist"],"祭品":["祭品","Sacrifice"],"狙擊手":["狙击手","Sniper"],"偵查兵":["侦查兵","Scout"],"驗證者":["验证者","Verifier"],"金水":["金水","Confirmed Villager"],"嫁禍者":["嫁祸者","Scapegoater"],"證人":["证人","Witness"],"叛狼":["叛狼","Traitor Wolf"],"蜜蜂":["蜜蜂","Bee"],"蜂巢":["蜂巢","Hive"],"咒術師":["咒术师","Curse Caster"],"駭客":["骇客","Hacker"],"預知者":["预知者","Precog"],"辨別者":["辨别者","Discriminator"],"背叛者":["背叛者","Betrayer"],"偽殺者":["伪杀者","Fake Killer"],"替死鬼":["替死鬼","Substitute"],"村長":["村长","Village Chief"],"船長":["船长","Captain"],"法官":["法官","Judge"],"守墓人":["守墓人","Gravekeeper"],"魔術師":["魔术师","Magician"],"貴族":["贵族","Noble"],"守護者":["守护者","Guardian"],"獵魔師":["猎魔师","Demon Hunter"],"煉金術師":["炼金术师","Alchemist"],
    "狼人":["狼人","Werewolf"],"黑狼王":["黑狼王","Black Wolf King"],"白狼王":["白狼王","White Wolf King"],"雪狼":["雪狼","Snow Wolf"],"百變狼":["百变狼","Shapeshifter Wolf"],"原初狼":["原初狼","Primordial Wolf"],"暴走狼":["暴走狼","Berserker Wolf"],"炸彈狼":["炸弹狼","Bomb Wolf"],"血狼":["血狼","Blood Wolf"],"吸血狼":["吸血狼","Vampire Wolf"],"模仿狼":["模仿狼","Mimic Wolf"],"大野狼":["大野狼","Great Wolf"],"夢狼／噩夢":["梦狼／噩梦","Dream Wolf / Nightmare"],"說服狼":["说服狼","Persuader Wolf"],"狼美人":["狼美人","Wolf Beauty"],"惡魔":["恶魔","Devil"],"狼巫":["狼巫","Wolf Witch"],"財狼":["财狼","Wealthy Wolf"],"嘔吐狼":["呕吐狼","Vomit Wolf"],"日狼":["日狼","Sun Wolf"],"藥狼":["药狼","Medicine Wolf"],"幼狼":["幼狼","Young Wolf"],"吸血鬼（狼人版）":["吸血鬼（狼人版）","Vampire (Wolf)"],"次雪狼":["次雪狼","Secondary Snow Wolf"],"慧狼":["慧狼","Wise Wolf"],"惑狼":["惑狼","Confusing Wolf"],"影狼":["影狼","Shadow Wolf"],"法狼":["法狼","Law Wolf"],"怨狼":["怨狼","Resentful Wolf"],"辯狼":["辩狼","Debate Wolf"],"祭司":["祭司","Wolf Priest"],"風狼":["风狼","Wind Wolf"],"偽裝者":["伪装者","Disguiser"],"狼警":["狼警","Wolf Cop"],"長老狼":["长老狼","Elder Wolf"],"狙八狼":["狙八狼","Sniper Eight Wolf"],"魔狼":["魔狼","Demon Wolf"],"潛伏狼":["潜伏狼","Lurking Wolf"],
    "怨靈":["怨灵","Wraith"],"巫毒女孩":["巫毒女孩","Voodoo Girl"],"蠱惑師":["蛊惑师","Tempter"],"死靈法師":["死灵法师","Necromancer"],"騷靈":["骚灵","Poltergeist"],"渡靈":["渡灵","Ferry Spirit"],"咒靈":["咒灵","Cursed Spirit"],"祖靈":["祖灵","Ancestral Spirit"],"淨靈":["净灵","Purifying Spirit"],
    "吸血鬼":["吸血鬼","Vampire"],"間諜":["间谍","Spy"],"冰雪女王":["冰雪女王","Ice Queen"],"赤斧狂魔":["赤斧狂魔","Red Axe Madman"],"賭徒":["赌徒","Gambler"],"竊賊":["窃贼","Burglar"],"自殺炸彈客":["自杀炸弹客","Suicide Bomber"],"懦夫":["懦夫","Coward"],"擊拳兄弟":["击拳兄弟","Fist Brothers"]
  };
  const oldText = base.text.bind(base);
  const oldCan = base.canTranslate.bind(base);
  base.text = (source, locale) => {
    const raw = String(source ?? "");
    if (locale === "zh-TW") return raw;
    const row = N[raw];
    if (row) return locale === "zh-CN" ? row[0] : row[1];
    return oldText(raw, locale);
  };
  base.canTranslate = (source) => Boolean(N[String(source ?? "")]) || oldCan(source);
})();