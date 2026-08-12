import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installCoreDebateFlowRules } from "../.test-build/core-debate-flow.js";

function stateFor(phase) {
  return { phase, roleMemory: { __system: {} } };
}

class FakeRoom {
  constructor(state) {
    this.state = state;
    this.saved = 0;
    this.innerSaves = 0;
    this.deletedAlarms = 0;
    this.chatCalls = 0;
    this.ctx = { storage: { deleteAlarm: () => { this.deletedAlarms += 1; } } };
  }

  systemMem(state) {
    state.roleMemory.__system ??= {};
    return state.roleMemory.__system;
  }

  touchAndSave() { this.saved += 1; }
  requireState() { return this.state; }

  // Simulate the inner audit layer: it historically creates the same `day`
  // deadline for debate and vote before the outer debate-flow rule returns.
  saveBroadcast(state) {
    this.innerSaves += 1;
    const system = this.systemMem(state);
    if ((state.phase === "debate" || state.phase === "vote") && !system.phaseDeadlineAt) {
      system.phaseDeadlineAt = Date.now() + 120_000;
      system.phaseDeadlineKind = "day";
      system.phaseDeadlinePersistedAt = system.phaseDeadlineAt;
    }
  }

  projectState(state) {
    const system = this.systemMem(state);
    return {
      phase: state.phase,
      phaseDeadlineAt: system.phaseDeadlineAt,
      phaseDeadlineKind: system.phaseDeadlineKind
    };
  }

  sendChat() {
    this.chatCalls += 1;
    return "sent";
  }
}

installCoreDebateFlowRules(FakeRoom);

test("sequential debate clears the shared day deadline and projects a paused timer", () => {
  const state = stateFor("debate");
  const room = new FakeRoom(state);
  room.saveBroadcast(state);

  assert.equal(room.innerSaves, 1);
  assert.equal(room.saved, 1);
  assert.equal(room.deletedAlarms, 1);
  assert.equal(state.roleMemory.__system.phaseDeadlineAt, undefined);
  assert.equal(state.roleMemory.__system.phaseDeadlineKind, undefined);
  assert.equal(state.roleMemory.__system.phaseDeadlinePersistedAt, undefined);

  const view = room.projectState(state);
  assert.equal(view.phaseDeadlineAt, undefined);
  assert.equal(view.phaseDeadlineKind, undefined);
  assert.equal(view.phaseTimerPaused, true);
});

test("vote receives and keeps a fresh full day deadline after debate completes", () => {
  const state = stateFor("debate");
  const room = new FakeRoom(state);
  room.saveBroadcast(state);
  assert.equal(state.roleMemory.__system.phaseDeadlineAt, undefined);

  state.phase = "vote";
  const started = Date.now();
  room.saveBroadcast(state);
  const deadline = state.roleMemory.__system.phaseDeadlineAt;
  assert.equal(state.roleMemory.__system.phaseDeadlineKind, "day");
  assert.ok(deadline >= started + 119_000, `expected a fresh vote deadline, got ${deadline - started}ms`);
  assert.equal(room.deletedAlarms, 1, "vote deadline must not be cleared");
});

test("general chat is server-authoritatively blocked during debate but works after debate", () => {
  const state = stateFor("debate");
  const room = new FakeRoom(state);
  assert.throws(() => room.sendChat("token", "插話"), /一般聊天已暫停/);
  assert.equal(room.chatCalls, 0);

  state.phase = "vote";
  assert.equal(room.sendChat("token", "投票階段訊息"), "sent");
  assert.equal(room.chatCalls, 1);
});

test("debate-flow invariant is installed after audit/post28 composition", () => {
  const coreRules = readFileSync(new URL("../src/core-rules.ts", import.meta.url), "utf8");
  const audit = coreRules.indexOf("installCoreAuditHardeningRules");
  const post28 = coreRules.lastIndexOf("installPost28FinalizeRules");
  const debate = coreRules.lastIndexOf("installCoreDebateFlowRules");
  assert.ok(audit >= 0 && post28 > audit && debate > post28);
});

test("browser flow only exposes formal speech to the current speaker and locks general chat", () => {
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const repair = readFileSync(new URL("../public/ui-runtime-repair.js", import.meta.url), "utf8");
  const room = readFileSync(new URL("../src/room.ts", import.meta.url), "utf8");

  assert.match(app, /if \(current !== state\.me\.id\)/);
  assert.match(app, /textarea id="debateSpeech"/);
  assert.match(room, /currentDebaterId\(state\.debateOrder, state\.debateIndex\) !== actor\.id/);
  assert.match(room, /if \(isDebateComplete\(state\.debateOrder, state\.debateIndex\)\) this\.enterVote\(state\)/);

  assert.match(repair, /Boolean\(area\.querySelector\("\.speech-order"\)\)/);
  assert.match(repair, /input\.disabled = true/);
  assert.match(repair, /button\.disabled = true/);
  assert.match(repair, /投票倒數已暫停/);
  assert.match(repair, /一般聊天已暫停/);
});

test("night action copy separates submitted choices from resolved outcomes", () => {
  const repair = readFileSync(new URL("../public/ui-runtime-repair.js", import.meta.url), "utf8");
  assert.match(repair, /技能提交只代表送出選擇/);
  assert.match(repair, /送出目標不等於已經擊殺/);
  assert.match(repair, /提交目標（尚未結算）/);
  assert.match(repair, /狼隊目標已提交，等待夜間結算/);
  assert.match(repair, /提交技能選擇（尚未結算）/);
});
