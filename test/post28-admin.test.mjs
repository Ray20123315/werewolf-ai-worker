import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { installPost28FullRepairRules } from "../.test-build/core-post28-repair.js";
import { installPost28FinalizeRules } from "../.test-build/core-post28-finalize.js";

function player(id, role, extra = {}) {
  return { id, token: `t-${id}`, name: id.toUpperCase(), nameKey: id, alive: true, isAI: false, isSpectator: false, role, joinedAt: 0, ...extra };
}

function state(players, phase = "night") {
  return {
    roomId: "ABC234", hostPlayerId: players[0]?.id ?? "a", phase, round: 1, players, roleSetup: {},
    settings: { sheriffEnabled: false, deathInfo: "names", tieRule: "random_elimination", autoRoleSetup: false, winCondition: "slaughter_edge", dayDurationSeconds: 120, nightDurationSeconds: 120 },
    sheriff: { enabled: false, electionRound: 1, candidates: [], votes: {}, successors: [] }, messages: [], votes: {},
    nightActions: { wolfVotes: {}, seerTargets: {}, guardTargets: {}, witchActions: {}, roleActions: {} }, roleMemory: {}, seerResults: {}, roleResults: {},
    witchHealAvailable: true, witchPoisonAvailable: true, guardLastTargets: {}, debateOrder: [], debateIndex: 0, debateCompleted: [], lastNightDeaths: [], deathReasons: {},
    moderatorIds: [], initialPlayerCount: players.length, createdAt: 0, updatedAt: 0
  };
}

function Base() {
  return class {
    mem(st, id) { st.roleMemory[id] ??= {}; return st.roleMemory[id]; }
    systemMem(st) { return this.mem(st, "__system"); }
    saveBroadcast() {}
    touchAndSave() {}
    broadcast() {}
    addSystemMessage() {}
  };
}

function install(Room) {
  installPost28FullRepairRules(Room);
  installPost28FinalizeRules(Room);
  return Room;
}

test("admin snapshot reveals true role/faction/allegiance only after game start", async () => {
  class Room extends Base() {
    constructor(st) { super(); this.current = st; }
    requireState() { return this.current; }
    async adminSnapshot() {
      return { phase: this.current.phase, players: this.current.players.map((p) => ({ id: p.id, name: p.name, alive: p.alive })) };
    }
  }
  install(Room);
  const spy = player("s", "spy");
  const wolf = player("w", "werewolf");
  const st = state([spy, wolf], "night");
  st.roleMemory.s = { winningAllegiance: "village" };
  const room = new Room(st);
  const snapshot = await room.adminSnapshot();
  assert.equal(snapshot.players[0].role, "spy");
  assert.equal(snapshot.players[0].roleName, "間諜");
  assert.equal(snapshot.players[0].mechanicalFaction, "neutral");
  assert.equal(snapshot.players[0].winningAllegiance, "village");

  st.phase = "lobby";
  const lobby = await room.adminSnapshot();
  assert.equal(lobby.players[0].role, undefined);
  assert.equal(lobby.players[0].mechanicalFaction, undefined);
});

test("manual admin disband deletes Durable Object state and unregisters room directory", async () => {
  class Room extends Base() {
    constructor(st) {
      super();
      this.current = st;
      this.deleted = 0;
      this.unregistered = [];
      this.ctx = {
        storage: { deleteAll: async () => { this.deleted += 1; }, setAlarm() {} },
        getWebSockets: () => []
      };
      this.env = { ROOM_DIRECTORY: { getByName: () => ({ unregisterRoom: async (id) => this.unregistered.push(id) }) } };
    }
    requireState() { return this.current; }
    async adminKick() { this.baseKick = true; }
  }
  install(Room);
  const st = state([player("a", "villager")]);
  const room = new Room(st);
  await room.adminKick("__disband_room__");
  assert.equal(room.baseKick, undefined);
  assert.equal(room.deleted, 1);
  assert.deepEqual(room.unregistered, [st.roomId]);
});

test("manual admin disband rejects a missing room instead of creating a ghost directory entry", async () => {
  class Room extends Base() {
    constructor() {
      super();
      this.deleted = 0;
      this.ctx = {
        storage: { deleteAll: async () => { this.deleted += 1; }, setAlarm() {} },
        getWebSockets: () => []
      };
    }
    requireState() { throw new Error("房間不存在"); }
    async adminKick() { this.baseKick = true; }
  }
  install(Room);
  const room = new Room();
  await assert.rejects(room.adminKick("__disband_room__"), /房間不存在/);
  assert.equal(room.deleted, 0);
  assert.equal(room.baseKick, undefined);
});

test("expired empty-room cleanup alarm disbands only when no WebSocket remains", async () => {
  class Room extends Base() {
    constructor(st, sockets = []) {
      super();
      this.current = st;
      this.sockets = sockets;
      this.deleted = 0;
      this.unregistered = [];
      this.alarmTimes = [];
      this.deletedAlarms = 0;
      this.ctx = {
        storage: {
          deleteAll: async () => { this.deleted += 1; },
          setAlarm: (time) => { this.alarmTimes.push(time); },
          deleteAlarm: () => { this.deletedAlarms += 1; }
        },
        getWebSockets: () => this.sockets
      };
      this.env = { ROOM_DIRECTORY: { getByName: () => ({ unregisterRoom: async (id) => this.unregistered.push(id) }) } };
    }
    requireState() { return this.current; }
    async alarm() { this.baseAlarm = true; }
  }
  install(Room);

  const emptyState = state([player("a", "villager")]);
  emptyState.roleMemory.__system = { roomEmptyDisposeAt: Date.now() - 1 };
  const empty = new Room(emptyState);
  await empty.alarm();
  assert.equal(empty.baseAlarm, undefined);
  assert.equal(empty.deleted, 1);
  assert.deepEqual(empty.unregistered, [emptyState.roomId]);

  const connectedState = state([player("a", "villager")]);
  connectedState.roleMemory.__system = { roomEmptyDisposeAt: Date.now() - 1 };
  const connected = new Room(connectedState, [{ readyState: 1 }]);
  await connected.alarm();
  assert.equal(connected.deleted, 0);
  assert.equal(connected.baseAlarm, true);
  assert.deepEqual(connected.alarmTimes, []);
  assert.equal(connected.deletedAlarms, 1);
});

test("join and login wrappers do not arm empty-room cleanup while another socket is open", async () => {
  class Room extends Base() {
    constructor(st) {
      super();
      this.current = st;
      this.ctx = {
        storage: { setAlarm() {}, deleteAlarm() {} },
        getWebSockets: () => [{ readyState: 1 }]
      };
    }
    requireState() { return this.current; }
    async joinHuman() { return { playerId: "b", token: "t-b", spectator: false }; }
    async loginHuman() { return { playerId: "a", token: "t-a", spectator: false }; }
  }
  install(Room);
  const st = state([player("a", "villager")], "lobby");
  const room = new Room(st);
  await room.joinHuman("B", "1234");
  assert.equal(st.roleMemory.__system?.roomEmptyDisposeAt, undefined);
  await room.loginHuman("A", "1234");
  assert.equal(st.roleMemory.__system?.roomEmptyDisposeAt, undefined);
});

test("admin page has page-level vertical scroll, omniscient role decoration and disband control", () => {
  const css = fs.readFileSync("public/admin-toolkit.css", "utf8");
  const js = fs.readFileSync("public/admin-full-repair.js", "utf8");
  const html = fs.readFileSync("public/admin.html", "utf8");
  assert.match(css, /overflow-y:\s*auto\s*!important/);
  assert.match(css, /\.admin-shell, \.admin-dashboard[\s\S]*overflow:\s*visible\s*!important/);
  assert.match(js, /__disband_room__/);
  assert.match(js, /mechanicalFaction/);
  assert.match(js, /winningAllegiance/);
  assert.match(js, /roleName/);
  assert.match(html, /admin-full-repair\.js/);
});

test("RoomDirectory supports hard unregister and blocks stale heartbeats from reviving rooms", () => {
  const source = fs.readFileSync("src/room-directory.ts", "utf8");
  assert.match(source, /CREATE TABLE IF NOT EXISTS room_tombstones/);
  assert.match(source, /async unregisterRoom\(roomId: string, removedAt = Date\.now\(\)\)/);
  assert.match(source, /DELETE FROM rooms WHERE room_id = \?/);
  assert.match(source, /removed_at >= \?/);
  assert.match(source, /MAX\(rooms\.last_seen_at, excluded\.last_seen_at\)/);
  assert.match(source, /MAX\(room_tombstones\.removed_at, excluded\.removed_at\)/);
});

test("ordinary public state path does not receive admin omniscient player projection", () => {
  const repair = fs.readFileSync("src/core-post28-repair.ts", "utf8");
  const adminStart = repair.indexOf("proto.adminSnapshot");
  const adminEnd = repair.indexOf("if (typeof originalAdminKick", adminStart);
  assert.ok(adminStart >= 0 && adminEnd > adminStart);
  const adminBlock = repair.slice(adminStart, adminEnd);
  assert.match(adminBlock, /roleName/);
  assert.match(adminBlock, /mechanicalFaction/);
  assert.equal(/snapshot\.players/.test(repair.slice(0, adminStart)), false);
});
