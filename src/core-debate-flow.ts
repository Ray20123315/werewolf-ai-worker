import type { AppLocale, GameState, RoleMemoryValue } from "./types.js";

type AlarmStorage = { deleteAlarm?: () => unknown };
type RuntimeMemory = Record<string, RoleMemoryValue | undefined>;
type RoomPrototype = Record<string, any> & { __debateFlowRulesInstalled?: boolean };

type RuntimeRoom = {
  ctx?: { storage?: AlarmStorage };
  requireState(): GameState;
  systemMem(state: GameState): RuntimeMemory;
  touchAndSave(state: GameState): void;
};

export function installDebateFlowRules(GameRoomCtor: { prototype: RoomPrototype }): void {
  const proto = GameRoomCtor.prototype;
  if (proto.__debateFlowRulesInstalled) return;
  proto.__debateFlowRulesInstalled = true;

  const originalRequireState = proto.requireState;
  const originalSaveBroadcast = proto.saveBroadcast;
  const originalProjectState = proto.projectState;
  const originalSendChat = proto.sendChat;

  if (typeof originalRequireState === "function") {
    proto.requireState = function (this: RuntimeRoom): GameState {
      const state = originalRequireState.call(this) as GameState;
      if (clearDebateDeadline(this, state)) this.touchAndSave(state);
      return state;
    };
  }

  if (typeof originalSaveBroadcast === "function") {
    proto.saveBroadcast = function (this: RuntimeRoom, state: GameState): void {
      const result = originalSaveBroadcast.call(this, state);
      // core-audit-hardening historically treats debate + vote as one `day`
      // deadline. Clear the just-created debate deadline after the composed save;
      // entering vote will then create a brand-new full day/vote deadline.
      if (clearDebateDeadline(this, state)) this.touchAndSave(state);
      return result;
    };
  }

  if (typeof originalProjectState === "function") {
    proto.projectState = function (this: RuntimeRoom, state: GameState, token: string): any {
      const view = originalProjectState.call(this, state, token);
      if (state.phase === "debate" && view) {
        delete view.phaseDeadlineAt;
        delete view.phaseDeadlineKind;
        view.phaseTimerPaused = true;
      }
      return view;
    };
  }

  if (typeof originalSendChat === "function") {
    proto.sendChat = function (this: RuntimeRoom, token: string, content: string, locale?: AppLocale): void {
      const state = this.requireState();
      if (state.phase === "debate") {
        throw new Error("正式發言依序進行中：一般聊天已暫停；請等待輪到你，並使用正式發言框送出。 ");
      }
      return originalSendChat.call(this, token, content, locale);
    };
  }
}

export function clearDebateDeadline(room: Pick<RuntimeRoom, "ctx" | "systemMem">, state: GameState): boolean {
  if (state.phase !== "debate") return false;
  const system = room.systemMem(state);
  const hadDeadline = system.phaseDeadlineAt !== undefined
    || system.phaseDeadlineKind !== undefined
    || system.phaseDeadlinePersistedAt !== undefined;
  if (!hadDeadline) return false;
  delete system.phaseDeadlineAt;
  delete system.phaseDeadlineKind;
  delete system.phaseDeadlinePersistedAt;
  void room.ctx?.storage?.deleteAlarm?.();
  return true;
}
