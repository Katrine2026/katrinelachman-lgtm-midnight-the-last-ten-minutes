import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@colyseus/sdk";

const gameUrl = process.env.GAME_SERVER_URL ?? "http://127.0.0.1:2567";
const timeoutUrl = process.env.TIMEOUT_SERVER_URL ?? "http://127.0.0.1:2568";

function clientAt(url) {
  return new Client(url);
}

function consumeRoomNotices(room) {
  room.onMessage("notice", () => {});
  room.onMessage("clue", () => {});
}

async function waitUntil(description, predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await delay(30);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function walkTo(room, sessionId, waypoints) {
  for (const point of waypoints) {
    const deadline = Date.now() + 18000;
    while (Date.now() < deadline) {
      const player = room.state.players.get(sessionId);
      assert.ok(player, `Player ${sessionId} remains in the room`);
      const dx = point.x - player.x;
      const dy = point.y - player.y;
      if (Math.hypot(dx, dy) <= 18) break;

      let input = { up: false, down: false, left: false, right: false };
      if (Math.abs(dx) > Math.abs(dy)) {
        input = { ...input, left: dx < 0, right: dx > 0 };
      } else {
        input = { ...input, up: dy < 0, down: dy > 0 };
      }
      room.send("move", input);
      await delay(45);
    }
    const player = room.state.players.get(sessionId);
    assert.ok(player && Math.hypot(point.x - player.x, point.y - player.y) <= 28,
      `Server moved player to (${point.x}, ${point.y}); received (${player?.x}, ${player?.y})`);
    room.send("move", { up: false, down: false, left: false, right: false });
    await delay(70);
  }
}

async function leaveAll(rooms) {
  await Promise.all(rooms.filter(Boolean).map((room) => room.leave().catch(() => undefined)));
}

async function checkCapacity() {
  const clients = Array.from({ length: 9 }, () => clientAt(gameUrl));
  const rooms = [];
  try {
    const hostRoom = await clients[0].create("midnight", { name: "Capacity Host" });
    rooms.push(hostRoom);
    consumeRoomNotices(hostRoom);
    const code = hostRoom.roomId;
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/u, "Room code is six easy-to-read characters");

    for (let index = 1; index < 8; index += 1) {
      const room = await clients[index].joinById(code, { name: `Guest ${index}` });
      consumeRoomNotices(room);
      rooms.push(room);
    }
    await waitUntil("all eight seats to synchronize", () => hostRoom.state.players.size === 8);
    assert.equal(hostRoom.state.players.size, 8, "Eight players can share one room");

    let ninthPlayerJoined = false;
    try {
      await clients[8].joinById(code, { name: "Guest Nine" });
      ninthPlayerJoined = true;
    } catch {
      // The full-room join is expected to fail.
    }
    assert.equal(ninthPlayerJoined, false, "A ninth guest cannot join a full room");
  } finally {
    await leaveAll(rooms);
  }
}

async function checkWinFlow() {
  const hostClient = clientAt(gameUrl);
  const guestClient = clientAt(gameUrl);
  let hostRoom;
  let guestRoom;

  try {
    hostRoom = await hostClient.create("midnight", { name: "Ada" });
    consumeRoomNotices(hostRoom);
    const code = hostRoom.roomId;
    guestRoom = await guestClient.joinById(code, { name: "Bryn" });
    consumeRoomNotices(guestRoom);
    await waitUntil("both players to appear in the lobby", () => hostRoom.state.players.size === 2);
    assert.equal(guestRoom.roomId, code, "A guest can join from the shared six-character room code");
    assert.equal(hostRoom.state.players.size, 2, "Room membership synchronizes to both clients");
    assert.equal(guestRoom.state.players.size, 2, "The second client receives the full room state");
    assert.equal(hostRoom.state.players.get(hostRoom.sessionId).name, "Ada");
    assert.equal(hostRoom.state.players.get(guestRoom.sessionId).name, "Bryn");

    guestRoom.send("start-game");
    await delay(180);
    assert.equal(hostRoom.state.phase, "lobby", "Non-host start request is rejected");
    hostRoom.send("start-game");
    await waitUntil("the host to start the round", () => hostRoom.state.phase === "playing");
    const initialSeconds = hostRoom.state.remainingSeconds;
    assert.ok(initialSeconds > 500 && initialSeconds <= 600, "Normal game starts with a ten-minute server timer");

    const guestStartX = guestRoom.state.players.get(hostRoom.sessionId).x;
    hostRoom.send("move", { x: 1080, y: 600 });
    await delay(300);
    assert.equal(hostRoom.state.players.get(hostRoom.sessionId).x, guestStartX,
      "A client cannot teleport by sending coordinates instead of movement input");
    guestRoom.send("interact", { id: "guest-ledger" });
    await delay(180);
    assert.equal(hostRoom.state.cluesFound, 0, "A distant player cannot search an object remotely");

    await walkTo(hostRoom, hostRoom.sessionId, [{ x: 220, y: 470 }, { x: 220, y: 360 }, { x: 890, y: 320 }, { x: 890, y: 165 }]);
    hostRoom.send("interact", { id: "security-cabinet" });
    await delay(150);
    assert.equal(hostRoom.state.keyFound, false, "The security cabinet stays locked until all clues are found");

    await walkTo(hostRoom, hostRoom.sessionId, [{ x: 890, y: 320 }, { x: 290, y: 320 }, { x: 290, y: 165 }]);
    hostRoom.send("interact", { id: "guest-ledger" });
    await waitUntil("the first clue to synchronize", () => guestRoom.state.cluesFound === 1);
    assert.equal(guestRoom.state.interactables.get("guest-ledger").found, true,
      "The clue search is visible to the other client");

    await walkTo(hostRoom, hostRoom.sessionId, [{ x: 290, y: 320 }, { x: 490, y: 320 }, { x: 490, y: 165 }]);
    hostRoom.send("interact", { id: "dusty-portrait" });
    await waitUntil("the second clue to synchronize", () => hostRoom.state.cluesFound === 2);

    await walkTo(hostRoom, hostRoom.sessionId, [{ x: 490, y: 320 }, { x: 690, y: 320 }, { x: 690, y: 165 }]);
    hostRoom.send("interact", { id: "maintenance-note" });
    await waitUntil("all three clues to synchronize", () => guestRoom.state.cluesFound === 3);

    await walkTo(hostRoom, hostRoom.sessionId, [{ x: 690, y: 320 }, { x: 890, y: 320 }, { x: 890, y: 165 }]);
    hostRoom.send("interact", { id: "security-cabinet" });
    await waitUntil("the security key to synchronize", () => guestRoom.state.keyFound);
    assert.equal(guestRoom.state.keyFound, true, "Key objective is shared room state");

    await walkTo(hostRoom, hostRoom.sessionId, [{ x: 890, y: 320 }, { x: 1035, y: 350 }]);
    hostRoom.send("interact", { id: "emergency-exit" });
    await waitUntil("the emergency exit to unlock", () => guestRoom.state.exitUnlocked);
    assert.equal(guestRoom.state.exitUnlocked, true, "Exit unlock is synchronized to both clients");
    assert.equal(hostRoom.state.players.get(hostRoom.sessionId).escaped, true, "The unlocking player escapes");

    await walkTo(guestRoom, guestRoom.sessionId, [{ x: 220, y: 470 }, { x: 220, y: 360 }, { x: 1035, y: 350 }]);
    guestRoom.send("interact", { id: "emergency-exit" });
    await waitUntil("the full party to win", () => hostRoom.state.phase === "won");
    assert.equal(guestRoom.state.phase, "won", "The win state is broadcast to every player");
    return { code, duration: initialSeconds };
  } finally {
    await leaveAll([hostRoom, guestRoom]);
  }
}

async function checkTimeoutFlow() {
  const response = await fetch(`${timeoutUrl}/health`).catch(() => null);
  assert.ok(response?.ok, `Short-timer test server is available at ${timeoutUrl}`);
  const hostClient = clientAt(timeoutUrl);
  const guestClient = clientAt(timeoutUrl);
  let hostRoom;
  let guestRoom;
  try {
    hostRoom = await hostClient.create("midnight", { name: "Timer Host" });
    consumeRoomNotices(hostRoom);
    guestRoom = await guestClient.joinById(hostRoom.roomId, { name: "Timer Guest" });
    consumeRoomNotices(guestRoom);
    await waitUntil("timeout test players to join", () => hostRoom.state.players.size === 2);
    hostRoom.send("start-game");
    await waitUntil("timeout test round to start", () => hostRoom.state.phase === "playing");
    const initialSeconds = hostRoom.state.remainingSeconds;
    assert.ok(initialSeconds >= 1 && initialSeconds <= 10, "Test server uses its short timer override");
    await waitUntil("server-authoritative timeout", () => guestRoom.state.phase === "lost", 14000);
    assert.equal(hostRoom.state.remainingSeconds, 0, "Timeout ends the shared clock at zero");
    assert.equal(hostRoom.state.phase, "lost", "TIME'S UP is synchronized to the host");
  } finally {
    await leaveAll([hostRoom, guestRoom]);
  }
}

await checkCapacity();
console.log("✓ Room code, eight-player capacity, and ninth-player rejection");
const win = await checkWinFlow();
console.log(`✓ Two-client lobby, timer, movement, searches, key, exit, and WIN (${win.code}; ${win.duration}s timer)`);
await checkTimeoutFlow();
console.log("✓ Short test-only timer and synchronized TIME'S UP state");
