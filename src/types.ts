export type Phase = "lobby" | "night" | "debate" | "vote" | "ended";
export type Role = "werewolf" | "villager" | "seer" | "witch" | "guard";
export type Team = "werewolf" | "village";
export type AIProvider = "openai" | "gemini" | "deepseek" | "openai-compatible";

export interface AIConfig {
  provider: AIProvider;
  model: string;
}

export interface Player {
  id: string;
  token: string;
  name: string;
  alive: boolean;
  isAI: boolean;
  ai?: AIConfig;
  role?: Role;
  joinedAt: number;
}

export interface ChatMessage {
  id: string;
  playerId?: string;
  playerName: string;
  content: string;
  kind: "speech" | "system";
  createdAt: number;
  round: number;
  phase: Phase;
}

export interface NightActions {
  wolfVotes: Record<string, string>;
  seerTargets: Record<string, string>;
  guardTargets: Record<string, string>;
  witchActions: Record<string, WitchAction>;
}

export type WitchAction =
  | { type: "pass" }
  | { type: "heal" }
  | { type: "poison"; targetId: string };

export interface GameState {
  roomId: string;
  hostPlayerId: string;
  maxPlayers: number;
  phase: Phase;
  round: number;
  players: Player[];
  messages: ChatMessage[];
  votes: Record<string, string>;
  nightActions: NightActions;
  seerResults: Record<string, Record<string, Team>>;
  witchHealAvailable: boolean;
  witchPoisonAvailable: boolean;
  guardLastTargets: Record<string, string>;
  debateOrder: string[];
  debateIndex: number;
  debateCompleted: string[];
  lastNightDeaths: string[];
  lastVoteEliminated?: string;
  winner?: Team;
  createdAt: number;
  updatedAt: number;
}

export interface PublicPlayer {
  id: string;
  name: string;
  alive: boolean;
  isAI: boolean;
  ai?: AIConfig;
  isHost: boolean;
  role?: Role;
}

export interface PrivateView {
  roomId: string;
  phase: Phase;
  round: number;
  maxPlayers: number;
  players: PublicPlayer[];
  messages: ChatMessage[];
  me: {
    id: string;
    name: string;
    alive: boolean;
    isHost: boolean;
    role?: Role;
    wolfTeammates?: string[];
    seerResults?: Record<string, Team>;
    witchHealAvailable?: boolean;
    witchPoisonAvailable?: boolean;
    witchKnownVictim?: string;
    witchCanHealKnownVictim?: boolean;
    guardLastTarget?: string;
  };
  votesCast: string[];
  nightSubmitted: string[];
  debateOrder: string[];
  debateIndex: number;
  debateCompleted: string[];
  currentSpeakerId?: string;
  aiVotingUnlocked: boolean;
  lastNightDeaths: string[];
  lastVoteEliminated?: string;
  winner?: Team;
}

export type ClientMessage =
  | { type: "start" }
  | { type: "debate_speech"; content: string }
  | { type: "vote"; targetId: string }
  | { type: "night_action"; action: NightClientAction };

export type NightClientAction =
  | { kind: "werewolf"; targetId: string }
  | { kind: "seer"; targetId: string }
  | { kind: "guard"; targetId: string }
  | { kind: "witch"; action: WitchAction };

export type ServerMessage =
  | { type: "state"; state: PrivateView }
  | { type: "error"; message: string }
  | { type: "notice"; message: string };
