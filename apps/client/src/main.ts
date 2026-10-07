import type Phaser from "phaser";
import { Client, type Room } from "@colyseus/sdk";
import { MAX_PLAYERS, MIN_PLAYERS } from "@midnight/shared";
import type { HotelScene as HotelSceneType } from "./hotel-scene.js";
import "./style.css";

type Phase = "lobby" | "playing" | "won" | "lost";
type Notice = { text: string; tone?: string };
type ClueMessage = { id: string; text?: string };
type GameRoom = Room & {
  roomId: string;
  sessionId: string;
  state: {
    phase: Phase;
    hostSessionId: string;
    remainingSeconds: number;
    cluesFound: number;
    keyFound: boolean;
    exitUnlocked: boolean;
    players: Map<string, { name: string; x: number; y: number; color: number; escaped: boolean }>;
    interactables: Map<string, { found: boolean }>;
  };
  send(type: string, message?: unknown): void;
  onMessage(type: string, callback: (message: never) => void): void;
  leave(): Promise<void>;
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("The MIDNIGHT game container is missing.");

app.innerHTML = `
  <main class="shell">
    <header class="masthead">
      <a class="wordmark" href="#home" aria-label="Midnight home"><span class="wordmark-mark">M</span><span>MIDNIGHT<small>THE LAST TEN MINUTES</small></span></a>
      <div class="masthead-status"><span class="status-light"></span><span id="connection-label">AWAITING GUESTS</span></div>
    </header>

    <section id="landing-screen" class="landing-screen">
      <div class="hero-copy">
        <p class="eyebrow"><span>✦</span> A CO-OPERATIVE HOTEL MYSTERY</p>
        <h1>The night has<br /><em>only just begun.</em></h1>
        <p class="hero-lede">The Meridian Hotel has been closed for forty years. Tonight, its doors opened again. Gather your friends, follow the clues, and find a way out.</p>
        <div class="hero-rule"><span></span><span class="rule-star">✦</span><span></span></div>
        <div class="entry-grid">
          <label class="field-label" for="player-name">YOUR NAME</label>
          <input id="player-name" class="text-field name-field" maxlength="18" autocomplete="nickname" placeholder="A name to remember" value="" />
          <button id="create-button" class="button button-primary"><span>CREATE A ROOM</span><span class="button-arrow">↗</span></button>
          <div class="join-divider"><span>OR ENTER A ROOM CODE</span></div>
          <div class="join-row">
            <input id="room-code-input" class="text-field code-field" maxlength="6" autocapitalize="characters" autocomplete="off" placeholder="••••••" aria-label="Six-character room code" />
            <button id="join-button" class="button button-secondary">JOIN</button>
          </div>
          <p id="entry-error" class="form-error" role="alert" aria-live="polite"></p>
        </div>
      </div>
      <aside class="hero-side" aria-label="Game details">
        <div class="moon-scene"><div class="moon"></div><div class="moon-halo"></div><div class="silhouette silhouette-one"></div><div class="silhouette silhouette-two"></div><div class="hotel-sign">THE<br /><b>MERIDIAN</b><br />EST. 1891</div><div class="scene-window window-one"></div><div class="scene-window window-two"></div><div class="scene-window window-three"></div><div class="scene-stars">✦　·　✦<br />　·　✦</div></div>
        <div class="side-caption"><span>01 — 08 PLAYERS</span><span>✧</span><span>ONE SHARED NIGHT</span></div>
        <div class="briefing-card"><span class="card-kicker">TONIGHT'S OBJECTIVE</span><p>Find the clues.<br />Find the key.<br />Make it out together.</p><div class="briefing-footer"><span>10 MINUTES</span><span>NO ONE LEFT BEHIND</span></div></div>
      </aside>
    </section>

    <section id="lobby-screen" class="lobby-screen hidden" aria-labelledby="lobby-heading">
      <div class="section-heading"><div><p class="eyebrow">THE FRONT DESK</p><h2 id="lobby-heading">Gather your party.</h2></div><button id="leave-lobby" class="text-button">LEAVE ROOM <span>↗</span></button></div>
      <div class="lobby-layout">
        <div class="lobby-card guests-card"><div class="card-heading"><div><span class="card-kicker">GUEST REGISTER</span><h3>In the lobby <span id="player-count">0 / 8</span></h3></div><span class="register-icon">✧</span></div><ul id="player-list" class="player-list"></ul><p id="lobby-hint" class="lobby-hint">Waiting for another guest to arrive…</p></div>
        <div class="lobby-card room-card"><span class="card-kicker">INVITE YOUR FRIENDS</span><p class="room-code-label">ROOM CODE</p><div class="room-code" id="room-code-display">——————</div><button id="copy-code" class="copy-button">COPY CODE</button><div class="lobby-divider"></div><div class="ready-row"><span class="ready-lamp"></span><span id="host-note">Only the host can begin</span></div><button id="start-button" class="button button-primary start-button" disabled><span>START THE NIGHT</span><span class="button-arrow">✦</span></button><p class="minimum-note">At least 2 guests · Up to 8</p></div>
      </div>
      <div class="rules-strip"><span class="rules-emblem">✧</span><div><strong>A word before you enter</strong><p>Stay together, search the guest rooms for three clues, then retrieve the key from security. Only then will the emergency exit open.</p></div></div>
    </section>

    <section id="game-screen" class="game-screen hidden" aria-label="Hotel game">
      <div class="game-topbar">
        <div class="game-brand"><span class="mini-moon">☾</span><span>THE MERIDIAN <small>AFTER HOURS</small></span></div>
        <div class="objective-pill"><span class="objective-spark">✦</span><span>Find the clues. Find the key. Unlock the emergency exit. Escape before midnight.</span></div>
        <div class="timer-card" aria-live="polite"><span class="timer-label">UNTIL MIDNIGHT</span><strong id="timer">10:00</strong></div>
        <button id="leave-game" class="icon-button" aria-label="Leave game" title="Leave game">↗</button>
      </div>
      <div class="game-layout">
        <div class="scene-column">
          <div class="map-frame"><div class="map-topline"><span>✦ FLOOR 01</span><span>MERIDIAN HOTEL · 12:01 AM</span><span>✦</span></div><div id="game-canvas" class="game-canvas"></div><div class="map-bottomline"><span><i class="legend-dot yours"></i> YOU</span><span><i class="legend-dot friend"></i> YOUR PARTY</span><span><i class="legend-dot searchable"></i> SEARCH HERE</span></div></div>
          <div class="touch-controls" aria-label="Movement controls"><span class="control-hint">MOVE</span><div class="direction-pad"><button class="direction-button up" data-direction="up" aria-label="Move up">▲</button><button class="direction-button left" data-direction="left" aria-label="Move left">◀</button><button class="direction-button down" data-direction="down" aria-label="Move down">▼</button><button class="direction-button right" data-direction="right" aria-label="Move right">▶</button></div><span class="control-hint">WASD / ARROWS</span><button id="action-button" class="button action-button" disabled>WALK TO A GLOWING OBJECT</button></div>
          <div id="toast" class="toast" role="status" aria-live="polite"></div>
        </div>
        <aside class="game-sidebar">
          <div class="sidebar-section"><div class="sidebar-heading"><span>THE PLAN</span><span>01</span></div><p class="objective-copy">Find the clues.<br />Find the key.<br />Unlock the emergency exit.<br />Escape before midnight.</p><div class="objective-progress"><div class="progress-head"><span>CLUES UNCOVERED</span><strong id="clue-count">0 / 3</strong></div><div class="progress-track"><span id="progress-fill"></span></div></div></div>
          <div class="sidebar-section clues-section"><div class="sidebar-heading"><span>WHAT WE KNOW</span><span>02</span></div><ul id="clue-list" class="clue-list"><li class="clue-empty">The hotel keeps its secrets.</li></ul></div>
          <div class="sidebar-section escape-section"><div class="sidebar-heading"><span>THE WAY OUT</span><span>03</span></div><div class="escape-status"><span id="key-status-icon" class="escape-icon">◇</span><div><strong id="key-status">Brass key</strong><small id="exit-status">Still locked</small></div></div><div class="escape-status"><span id="exit-status-icon" class="escape-icon">⌑</span><div><strong>Emergency exit</strong><small id="exit-detail">Down the main hall</small></div></div></div>
          <div class="party-section"><div class="sidebar-heading"><span>YOUR PARTY</span><span id="game-player-count">0 / 8</span></div><ul id="game-player-list" class="game-player-list"></ul></div>
        </aside>
      </div>
      <footer class="game-footer"><span>WASD OR ARROW KEYS TO MOVE</span><span>SEARCH WHEN YOU SEE A PROMPT</span><span>EVERY DISCOVERY IS SHARED</span></footer>
    </section>

    <div id="result-overlay" class="result-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="result-title">
      <div class="result-card"><div id="result-symbol" class="result-symbol">✦</div><p id="result-kicker" class="eyebrow">THE NIGHT IS YOURS</p><h2 id="result-title">YOU ESCAPED</h2><p id="result-copy">Together, you made it out before midnight.</p><div class="result-rule"><span></span>✧<span></span></div><button id="return-home" class="button button-primary"><span>RETURN TO THE LOBBY</span><span class="button-arrow">↗</span></button></div>
    </div>
  </main>
`;

const client = new Client(serverAddress());
const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing game element: ${id}`);
  return element as T;
};

const landingScreen = byId<HTMLElement>("landing-screen");
const lobbyScreen = byId<HTMLElement>("lobby-screen");
const gameScreen = byId<HTMLElement>("game-screen");
const connectionLabel = byId<HTMLElement>("connection-label");
const entryError = byId<HTMLElement>("entry-error");
const roomCodeInput = byId<HTMLInputElement>("room-code-input");
const roomCodeDisplay = byId<HTMLElement>("room-code-display");
const startButton = byId<HTMLButtonElement>("start-button");
const playerList = byId<HTMLUListElement>("player-list");
const gamePlayerList = byId<HTMLUListElement>("game-player-list");
const actionButton = byId<HTMLButtonElement>("action-button");
const timer = byId<HTMLElement>("timer");
const resultOverlay = byId<HTMLElement>("result-overlay");
const clueList = byId<HTMLUListElement>("clue-list");

let activeRoom: GameRoom | null = null;
let game: Phaser.Game | null = null;
let scene: HotelSceneType | null = null;
let toastTimer = 0;
let lastPhase: Phase | null = null;
const receivedClues = new Map<string, string>();

byId<HTMLInputElement>("player-name").value = localStorage.getItem("midnight-player-name") ?? "";

byId<HTMLButtonElement>("create-button").addEventListener("click", () => void createRoom());
byId<HTMLButtonElement>("join-button").addEventListener("click", () => void joinRoom());
roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
});
roomCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void joinRoom();
});
byId<HTMLButtonElement>("copy-code").addEventListener("click", () => void copyRoomCode());
startButton.addEventListener("click", () => activeRoom?.send("start-game"));
byId<HTMLButtonElement>("leave-lobby").addEventListener("click", () => void leaveRoom());
byId<HTMLButtonElement>("leave-game").addEventListener("click", () => void leaveRoom());
byId<HTMLButtonElement>("return-home").addEventListener("click", () => void leaveRoom());
actionButton.addEventListener("click", () => {
  const target = scene?.getNearbyTarget();
  if (target && activeRoom) activeRoom.send("interact", { id: target.id });
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-direction]")) {
  const direction = button.dataset.direction;
  if (!direction) continue;
  const release = () => scene?.setTouchDirection(direction, false);
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    scene?.setTouchDirection(direction, true);
  });
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
  button.addEventListener("contextmenu", (event) => event.preventDefault());
}

function serverAddress(): string {
  const configured = import.meta.env.VITE_SERVER_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  if (import.meta.env.PROD) return `${protocol}//${window.location.host}`;
  return `${protocol}//${window.location.hostname || "127.0.0.1"}:2567`;
}

function currentPlayerName(): string {
  const field = byId<HTMLInputElement>("player-name");
  const name = field.value.replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, 18);
  if (!name) {
    field.focus();
    showEntryError("Choose a name before entering the hotel.");
    return "";
  }
  localStorage.setItem("midnight-player-name", name);
  return name;
}

async function createRoom(): Promise<void> {
  const name = currentPlayerName();
  if (!name) return;
  setEntryBusy(true);
  try {
    const room = await client.create("midnight", { name });
    enterRoom(room as GameRoom);
  } catch (error) {
    showEntryError(readError(error, "The front desk could not open a room. Is the hotel server running?"));
  } finally {
    setEntryBusy(false);
  }
}

async function joinRoom(): Promise<void> {
  const name = currentPlayerName();
  if (!name) return;
  const code = roomCodeInput.value.trim().toUpperCase();
  if (code.length < 4 || code.length > 6) {
    showEntryError("Enter the 4–6 character code shared by your host.");
    roomCodeInput.focus();
    return;
  }
  setEntryBusy(true);
  try {
    const room = await client.joinById(code, { name });
    enterRoom(room as GameRoom);
  } catch (error) {
    showEntryError(readError(error, "That room could not be found. Check the code and try again."));
  } finally {
    setEntryBusy(false);
  }
}

function enterRoom(room: GameRoom): void {
  activeRoom = room;
  lastPhase = null;
  receivedClues.clear();
  showEntryError("");
  roomCodeDisplay.textContent = room.roomId;
  room.onStateChange((state) => syncRoomState(state));
  room.onMessage("notice", (message: Notice) => showToast(message.text, message.tone));
  room.onMessage("clue", (message: ClueMessage) => {
    if (message.text) receivedClues.set(message.id, message.text);
    renderClues();
  });
  connectionLabel.textContent = "CONNECTED TO THE MERIDIAN";
  connectionLabel.parentElement?.classList.add("is-connected");
  showScreen("lobby");
  syncRoomState(room.state);
}

function syncRoomState(state: GameRoom["state"]): void {
  if (!activeRoom) return;
  const isHost = activeRoom.sessionId === state.hostSessionId;
  const players = state.players;
  const count = players?.size ?? 0;
  byId<HTMLElement>("player-count").textContent = `${count} / ${MAX_PLAYERS}`;
  byId<HTMLElement>("game-player-count").textContent = `${count} / ${MAX_PLAYERS}`;
  roomCodeDisplay.textContent = activeRoom.roomId;
  byId<HTMLElement>("host-note").textContent = isHost ? "You are the host" : "Waiting for the host to begin";
  byId<HTMLElement>("lobby-hint").textContent = count < MIN_PLAYERS
    ? "Waiting for another guest to arrive…"
    : isHost
      ? "Everyone is here. The night is yours to begin."
      : "The host can start whenever the group is ready.";
  startButton.classList.toggle("hidden", !isHost);
  startButton.disabled = !isHost || count < MIN_PLAYERS || state.phase !== "lobby";
  renderPlayers(players, activeRoom.sessionId);
  renderGameStatus(state);

  if (state.phase !== lastPhase) {
    lastPhase = state.phase;
    if (state.phase === "playing" || state.phase === "won" || state.phase === "lost") {
      showScreen("game");
      mountGame();
    }
    if (state.phase === "won" || state.phase === "lost") showResult(state.phase);
  }
}

function renderPlayers(players: GameRoom["state"]["players"] | undefined, localSessionId: string): void {
  const entries = [...(players?.entries() ?? [])];
  playerList.replaceChildren(...entries.map(([sessionId, player], index) => {
    const item = document.createElement("li");
    item.className = "player-row";
    const avatar = document.createElement("span");
    avatar.className = `player-avatar avatar-${index % 5}`;
    avatar.textContent = initials(player.name);
    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = player.name;
    const badge = document.createElement("span");
    badge.className = "player-badge";
    badge.textContent = sessionId === activeRoom?.state.hostSessionId ? "HOST" : sessionId === localSessionId ? "YOU" : "GUEST";
    item.append(avatar, name, badge);
    return item;
  }));
  gamePlayerList.replaceChildren(...entries.map(([sessionId, player], index) => {
    const item = document.createElement("li");
    item.className = "game-player-row";
    const avatar = document.createElement("span");
    avatar.className = `player-avatar avatar-${index % 5}`;
    avatar.textContent = initials(player.name);
    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = player.name;
    const status = document.createElement("span");
    status.className = `party-state${player.escaped ? " escaped" : ""}`;
    status.textContent = player.escaped ? "OUT" : sessionId === localSessionId ? "YOU" : "IN";
    item.append(avatar, name, status);
    return item;
  }));
}

function renderGameStatus(state: GameRoom["state"]): void {
  timer.textContent = formatTime(Math.max(0, state.remainingSeconds));
  byId<HTMLElement>("clue-count").textContent = `${state.cluesFound} / 3`;
  byId<HTMLElement>("progress-fill").style.width = `${Math.min(100, state.cluesFound / 3 * 100)}%`;
  byId<HTMLElement>("key-status").textContent = state.keyFound ? "Brass key found" : "Brass key";
  byId<HTMLElement>("exit-status").textContent = state.keyFound ? "The way is open" : "Still locked";
  byId<HTMLElement>("exit-detail").textContent = state.exitUnlocked ? "Unlocked — make your escape" : "Down the main hall";
  byId<HTMLElement>("key-status-icon").classList.toggle("complete", state.keyFound);
  byId<HTMLElement>("exit-status-icon").classList.toggle("complete", state.exitUnlocked);
  renderClues();
  if (scene) scene.setRoom(activeRoom, activeRoom?.sessionId ?? "");
}

function renderClues(): void {
  const found = [...receivedClues.values()];
  if (found.length === 0) {
    const empty = document.createElement("li");
    empty.className = "clue-empty";
    empty.textContent = "The hotel keeps its secrets.";
    clueList.replaceChildren(empty);
    return;
  }
  clueList.replaceChildren(...found.map((clue) => {
    const item = document.createElement("li");
    item.className = "clue-item";
    const marker = document.createElement("span");
    marker.className = "clue-marker";
    marker.textContent = "✦";
    const text = document.createElement("span");
    text.textContent = clue;
    item.append(marker, text);
    return item;
  }));
}

async function mountGame(): Promise<void> {
  if (game || !activeRoom) return;
  const [{ default: Phaser }, { HotelScene }] = await Promise.all([
    import("phaser"),
    import("./hotel-scene.js"),
  ]);
  if (game || !activeRoom) return;
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game-canvas",
    width: 1120,
    height: 640,
    backgroundColor: "#080b17",
    render: { antialias: true, roundPixels: true },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: 1120,
      height: 640,
    },
    scene: [],
  });
  scene = new HotelScene(activeRoom, activeRoom.sessionId);
  game.scene.add("HotelScene", scene, true);
  scene.onNearbyTargetChange((target) => {
    actionButton.disabled = !target || activeRoom?.state.phase !== "playing";
    actionButton.textContent = target ? `${target.verb} · ${target.label}` : "WALK TO A GLOWING OBJECT";
    actionButton.classList.toggle("is-ready", Boolean(target));
  });
}

function showScreen(screen: "landing" | "lobby" | "game"): void {
  landingScreen.classList.toggle("hidden", screen !== "landing");
  lobbyScreen.classList.toggle("hidden", screen !== "lobby");
  gameScreen.classList.toggle("hidden", screen !== "game");
}

async function leaveRoom(): Promise<void> {
  const oldRoom = activeRoom;
  activeRoom = null;
  scene = null;
  lastPhase = null;
  receivedClues.clear();
  resultOverlay.classList.add("hidden");
  actionButton.disabled = true;
  if (game) {
    game.destroy(true);
    game = null;
  }
  if (oldRoom) await oldRoom.leave();
  connectionLabel.textContent = "AWAITING GUESTS";
  connectionLabel.parentElement?.classList.remove("is-connected");
  showEntryError("");
  showScreen("landing");
}

function showResult(phase: "won" | "lost"): void {
  const won = phase === "won";
  byId<HTMLElement>("result-symbol").textContent = won ? "✦" : "☾";
  byId<HTMLElement>("result-kicker").textContent = won ? "THE NIGHT IS YOURS" : "THE HOTEL HAS CLAIMED THE HOUR";
  byId<HTMLElement>("result-title").textContent = won ? "YOU ESCAPED" : "TIME'S UP";
  byId<HTMLElement>("result-copy").textContent = won
    ? "Together, you made it out before midnight."
    : "The clock reached twelve. The hotel doors have closed.";
  resultOverlay.classList.remove("hidden");
  resultOverlay.classList.toggle("result-loss", !won);
}

function showToast(text: string, tone = "story"): void {
  const toast = byId<HTMLElement>("toast");
  toast.textContent = text;
  toast.dataset.tone = tone;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3600);
}

function showEntryError(message: string): void {
  entryError.textContent = message;
}

function setEntryBusy(busy: boolean): void {
  const create = byId<HTMLButtonElement>("create-button");
  const join = byId<HTMLButtonElement>("join-button");
  create.disabled = busy;
  join.disabled = busy;
  create.classList.toggle("is-loading", busy);
  if (busy) showEntryError("The front desk is finding a room…");
}

async function copyRoomCode(): Promise<void> {
  if (!activeRoom) return;
  try {
    await navigator.clipboard.writeText(activeRoom.roomId);
    showToast("Room code copied. Send it to your party.", "success");
  } catch {
    roomCodeInput.value = activeRoom.roomId;
    roomCodeInput.select();
    showToast("Your room code is selected. Copy it to invite your party.", "story");
  }
}

function readError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "G";
}

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, "0")}:${String(safeSeconds % 60).padStart(2, "0")}`;
}
