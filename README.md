# MIDNIGHT: THE LAST TEN MINUTES

A small co-operative browser mystery for 2–8 players. The local version uses Phaser for the 2D hotel, Vite for the browser client, and a Node.js/Colyseus server for shared rooms and authoritative game state.

## Run locally

Requirements: Node.js 22 or newer and pnpm 11.

From this folder, install the packages once, then start both the room server and browser client:

```powershell
pnpm install
pnpm dev
```

Open the local address printed by Vite, usually `http://localhost:5173`. Create a room in one tab, then open another tab or browser on the same computer, enter a different name and the room code, and join. A shared network can also use the Vite address from another device; the server binds to the network interface and the browser derives its WebSocket address from the page host. The computer firewall may need to allow local connections on ports 5173 and 2567.

Use **WASD** or the arrow keys to move on desktop. On a narrow screen, use the touch pad. Walk to a glowing object and press its Search or Interact button. Room discoveries and the exit state are shared with the whole party.

## Game flow

Search the guest ledger in room 101, the portrait in room 102, and the maintenance note in room 103. With all three clues, the key cabinet in Security can be searched. Take the brass key to the emergency exit; the player who unlocks it escapes, and each other player can then interact with the open exit. The group wins when everyone still in the room has escaped. The server ends the round as a loss when its ten-minute countdown reaches zero.

## Repeat the multiplayer checks

Start the normal game with `pnpm dev`. In a second PowerShell window, start a temporary server with a six-second timer:

```powershell
$env:PORT = "2568"
$env:GAME_DURATION_SECONDS = "6"
pnpm --filter @midnight/server start
```

In a third window, run the two-client smoke checks:

```powershell
$env:TIMEOUT_SERVER_URL = "http://127.0.0.1:2568"
pnpm smoke
```

The checks cover room codes, the eight-player limit, host-only starting, movement and search validation, clue/key/exit synchronization, the win state, and timeout. The short timer is only for this test server; ordinary rooms use ten minutes.

## Render deployment

`render.yaml` prepares a single Render Web Service. The build command installs from the lockfile and builds the shared package, client, and server. The production server serves the built client and Colyseus matchmaker/WebSocket traffic from the same origin. In production, the client automatically uses that origin, so `VITE_SERVER_URL` and cross-origin CORS configuration are not required. Render provides `PORT`; `/health` is the health check. `pnpm start` runs the compiled server.

The service is pinned to one instance because room state is kept in server memory. The Blueprint uses Render's Free plan, which can sleep after inactivity and lose active rooms on a restart or sleep cycle. To deploy, connect this repository to Render and create a Blueprint from `render.yaml`.

## First-version limits

- Rooms and matches exist only in server memory. Restarting the server ends active rooms.
- A player who disconnects is removed; reconnect/rejoin during a round is not implemented.
- The map uses original geometric art and one fixed hotel floor.
- The Render service configuration is prepared, but a public deployment still requires a Git repository connected to a Render account.
