export const ROLE_IDS = [
  "werewolf",
  "black_wolf_king",
  "white_wolf_king",
  "snow_wolf",
  "shapeshifter_wolf",
  "primordial_wolf",
  "berserker_wolf",
  "bomb_wolf",
  "blood_wolf",
  "cupid",
  "seer",
  "apprentice_seer",
  "witch",
  "hunter",
  "ninja",
  "fraudster",
  "masochist_cultist",
  "sadist_leader",
  "mermaid",
  "gravedigger",
  "knight",
  "guard",
  "detective",
  "lecher",
  "thief",
  "villager",
  "wraith",
  "voodoo_girl",
  "tempter",
  "vampire_wolf_copy",
  "priest",
  "mimic_wolf",
  "observer",
  "great_wolf",
  "dream_wolf",
  "dream_guide",
  "spy",
  "trapper",
  "persuader_wolf",
  "ghost_hunter",
  "ice_queen",
  "red_axe_madman",
  "necromancer",
  "warlock",
  "diviner",
  "wolf_beauty",
  "yin_yang_master",
  "angel",
  "devil",
  "wolf_witch",
  "medium",
  "raven",
  "poltergeist",
  "wealthy_wolf",
  "queen_bee",
  "bear_tamer",
  "vomit_wolf",
  "physicist",
  "pharmacist",
  "sacrifice",
  "sniper",
  "scout",
  "verifier",
  "confirmed_villager",
  "scapegoater",
  "witness",
  "traitor_wolf",
  "bee",
  "hive",
  "curse_caster",
  "hacker",
  "precog",
  "discriminator",
  "betrayer",
  "fake_killer",
  "substitute",
  "village_chief",
  "captain",
  "judge",
  "gravekeeper",
  "magician",
  "noble",
  "guardian",
  "sun_wolf",
  "medicine_wolf",
  "young_wolf",
  "vampire_wolf",
  "secondary_snow_wolf",
  "wise_wolf",
  "confusing_wolf",
  "shadow_wolf",
  "law_wolf",
  "resentful_wolf",
  "debate_wolf",
  "wolf_priest",
  "wind_wolf",
  "disguiser_wolf",
  "wolf_cop",
  "elder_wolf",
  "ferry_spirit",
  "cursed_spirit",
  "ancestral_spirit",
  "purifying_spirit",
  "gambler",
  "burglar",
  "suicide_bomber",
  "coward",
  "sniper_eight_wolf",
  "demon_hunter",
  "fist_brother",
  "alchemist",
  "demon_wolf",
  "lurking_wolf",
  "vampire",
] as const;

export type Role = typeof ROLE_IDS[number];
export type Phase = "lobby" | "sheriff" | "night" | "debate" | "vote" | "reaction" | "ended";
export type Faction = "village" | "werewolf" | "spirit" | "neutral" | "blood";
export type Team = Faction;
export type AIProvider = "openai" | "gemini" | "deepseek" | "openai-compatible";
export type AIOperation = "night_action" | "debate_speech" | "vote" | "role_action";
export type RoleActionTiming = "setup" | "sheriff" | "night" | "day" | "vote" | "reaction" | "passive";
export type RoleTargetMode =
  | "none"
  | "one_alive_any"
  | "one_alive_other"
  | "one_alive_non_wolf"
  | "one_dead"
  | "optional_alive_other"
  | "two_alive_any"
  | "two_alive_other"
  | "two_any";
export type RoleActionEffect =
  | "wolf_kill"
  | "death_shot"
  | "self_destruct_kill"
  | "disguise_as_target"
  | "plant_bomb"
  | "blood_moon"
  | "link_lovers"
  | "inspect_team"
  | "witch_choice"
  | "set_scapegoat"
  | "set_bodyguard"
  | "redirect_wolf_kill"
  | "copy_dead_role"
  | "duel"
  | "protect"
  | "inspect_action"
  | "visit_target"
  | "steal_role_delayed"
  | "add_curse_stack"
  | "disable_next_action"
  | "copy_ability_and_block"
  | "priest_check"
  | "inspect_true_role"
  | "strong_kill"
  | "disable_current_action"
  | "set_dreamwalker"
  | "trap_next_vote"
  | "convert_to_werewolf_if_last"
  | "hunt_non_village"
  | "freeze_or_detonate"
  | "kill_if_no_wolves"
  | "necromancer_milestone"
  | "warlock_choice"
  | "charm_target"
  | "yin_yang_bless"
  | "angel_check"
  | "devil_check"
  | "piercing_poison"
  | "raven_vote_curse"
  | "observe_and_redirect"
  | "disable_permanently"
  | "pollen_block"
  | "inspect_pair_for_wolf"
  | "spend_stacks_to_disable"
  | "dose_target"
  | "sniper_two_kills"
  | "public_reveal_role"
  | "redirect_exile"
  | "kill_target"
  | "kill_if_hive_dead"
  | "curse_caster_mark"
  | "reroll_same_faction_role"
  | "fake_kill"
  | "sacrifice_revive"
  | "appoint_sheriff"
  | "force_exile"
  | "magician_swap"
  | "mark_for_reply"
  | "set_permanent_guard"
  | "day_assassinate"
  | "mark_convert_on_death"
  | "kill_if_targeted_by_other"
  | "hide_inspection_result"
  | "redirect_votes_from_self"
  | "mark_chain_kill_village"
  | "redirect_targeted_action"
  | "wolf_cop_check"
  | "choose_allegiance"
  | "burglar_steal"
  | "suicide_bomb"
  | "cooldown_kill"
  | "identify_partner"
  | "alchemist_sequence"
  | "awaken_if_wolf_dead"
  | "infect_blood";

export type RoleSetup = Partial<Record<Role, number>>;

export interface PasswordVerifier {
  salt: string;
  hash: string;
  iterations: number;
}

export interface AIConfig {
  provider: AIProvider;
  model: string;
  baseUrl?: string;
}

export interface Player {
  id: string;
  token: string;
  name: string;
  nameKey: string;
  password?: PasswordVerifier;
  alive: boolean;
  isAI: boolean;
  isSpectator: boolean;
  kickedAt?: number;
  ai?: AIConfig;
  role?: Role;
  factionOverride?: Faction;
  joinedAt: number;
}

export interface ChatMessage {
  id: string;
  playerId?: string;
  playerName: string;
  content: string;
  kind: "chat" | "speech" | "system" | "role";
  createdAt: number;
  round: number;
  phase: Phase;
}

export interface RoleActionSubmission {
  effect: RoleActionEffect;
  targetIds: string[];
  option?: string;
  submittedAt: number;
}

export interface NightActions {
  wolfVotes: Record<string, string>;
  seerTargets: Record<string, string>;
  guardTargets: Record<string, string>;
  witchActions: Record<string, WitchAction>;
  roleActions: Record<string, RoleActionSubmission>;
}

export type WitchAction =
  | { type: "pass" }
  | { type: "heal" }
  | { type: "poison"; targetId: string };

export type DeathInfoMode = "hidden" | "names" | "full";
export type TieRule = "no_elimination" | "revote" | "pk_revote";

export interface GameSettings {
  sheriffEnabled: boolean;
  deathInfo: DeathInfoMode;
  tieRule: TieRule;
}

export interface SheriffState {
  enabled: boolean;
  electionRound: number;
  candidates: string[];
  votes: Record<string, string>;
  sheriffId?: string;
  successors: string[];
}

export interface PendingReaction {
  actorId: string;
  effect: "death_shot" | "redirect_exile";
  reason: string;
  resumePhase: "night" | "debate" | "vote" | "ended";
}

export type RoleMemoryValue = string | number | boolean | string[] | number[] | null;
export type RoleMemory = Record<string, Record<string, RoleMemoryValue>>;

export interface GameState {
  roomId: string;
  roomPassword?: PasswordVerifier;
  hostPlayerId: string;
  phase: Phase;
  round: number;
  players: Player[];
  roleSetup: RoleSetup;
  settings: GameSettings;
  sheriff: SheriffState;
  messages: ChatMessage[];
  votes: Record<string, string>;
  nightActions: NightActions;
  roleMemory: RoleMemory;
  seerResults: Record<string, Record<string, Faction | "hidden">>;
  roleResults: Record<string, Record<string, string>>;
  witchHealAvailable: boolean;
  witchPoisonAvailable: boolean;
  guardLastTargets: Record<string, string>;
  debateOrder: string[];
  debateIndex: number;
  debateCompleted: string[];
  lastNightDeaths: string[];
  deathReasons: Record<string, string>;
  lastVoteEliminated?: string;
  winner?: Faction;
  winnerPlayerIds?: string[];
  winnerLabel?: string;
  pendingReaction?: PendingReaction;
  initialPlayerCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface PublicPlayer {
  id: string;
  name: string;
  alive: boolean;
  isAI: boolean;
  isSpectator: boolean;
  ai?: AIConfig;
  isHost: boolean;
  isSheriff: boolean;
  role?: Role;
}

export interface PendingAITask {
  playerId: string;
  operation: AIOperation;
}

export interface RoleActionPrompt {
  role: Role;
  timing: RoleActionTiming;
  effect: RoleActionEffect;
  targetMode: RoleTargetMode;
  options?: readonly string[];
  oncePerGame?: boolean;
  label: string;
  description: string;
}

export interface PrivateView {
  roomId: string;
  phase: Phase;
  round: number;
  players: PublicPlayer[];
  roleSetup: RoleSetup;
  roleSetupError?: string;
  settings: GameSettings;
  sheriff: SheriffState;
  canStart: boolean;
  messages: ChatMessage[];
  me: {
    id: string;
    name: string;
    alive: boolean;
    isHost: boolean;
    isSpectator: boolean;
    hasPassword: boolean;
    role?: Role;
    faction?: Faction;
    wolfTeammates?: string[];
    seerResults?: Record<string, Faction | "hidden">;
    roleResults?: Record<string, string>;
    witchHealAvailable?: boolean;
    witchPoisonAvailable?: boolean;
    witchKnownVictim?: string;
    witchCanHealKnownVictim?: boolean;
    guardLastTarget?: string;
  };
  roleAction?: RoleActionPrompt;
  roleActionSubmitted: boolean;
  canSubmitWolfVote: boolean;
  wolfVoteSubmitted: boolean;
  votesCast: string[];
  voteCandidateIds?: string[];
  nightSubmitted: string[];
  debateOrder: string[];
  debateIndex: number;
  debateCompleted: string[];
  currentSpeakerId?: string;
  aiVotingUnlocked: boolean;
  pendingAI?: PendingAITask;
  lastNightDeaths: string[];
  deathReasons?: Record<string, string>;
  lastVoteEliminated?: string;
  winner?: Faction;
  winnerPlayerIds?: string[];
  winnerLabel?: string;
}

export type ClientMessage =
  | { type: "start" }
  | { type: "reset" }
  | { type: "set_password"; password: string }
  | { type: "chat"; content: string }
  | { type: "configure_roles"; roles: RoleSetup }
  | { type: "configure_settings"; settings: Partial<GameSettings> }
  | { type: "kick"; targetId: string }
  | { type: "sheriff_candidate"; running: boolean }
  | { type: "sheriff_vote"; targetId: string }
  | { type: "debate_speech"; content: string }
  | { type: "vote"; targetId: string }
  | { type: "night_action"; action: NightClientAction }
  | { type: "role_action"; effect: RoleActionEffect; targetIds?: string[]; option?: string };

export type NightClientAction =
  | { kind: "werewolf"; targetId: string }
  | { kind: "seer"; targetId: string }
  | { kind: "guard"; targetId: string }
  | { kind: "witch"; action: WitchAction };

export type ServerMessage =
  | { type: "state"; state: PrivateView }
  | { type: "error"; message: string }
  | { type: "notice"; message: string };
