import type Phaser from "phaser";
import { HotelAudio } from "./hotel-audio.js";
import { Client, type Room } from "@colyseus/sdk";
import { MAX_PLAYERS, MIN_PLAYERS } from "@midnight/shared";
import type { HotelScene as HotelSceneType, NearbyTarget } from "./hotel-scene.js";
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

const CASE_CLUES = [
  {
    id: "guest-ledger",
    title: "The Guest Ledger",
    location: "ROOM 101 · BLUE SUITE",
    story: "A late-night entry appears forty years after the hotel sealed its doors. Its margin points to the portrait.",
    inspection: "The final guest is marked as checked out. A second line, in the same hand, records no departure time.",
  },
  {
    id: "dusty-portrait",
    title: "The Portrait Inscription",
    location: "ROOM 102 · VIOLET SUITE",
    story: "The inscription sends the search east, toward what the mirror cannot show.",
    inspection: "Dust clouds the sitter's face, but the eyes remain clear. They seem fixed on something beyond the eastern wall.",
  },
  {
    id: "maintenance-note",
    title: "The Maintenance Note",
    location: "ROOM 103 · ORCHID SUITE",
    story: "Three records are needed to release the brass key from Security.",
    inspection: "A pencilled warning runs below the repair log: 'Security keeps the brass key until the records agree.'",
  },
] as const;
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("The MIDNIGHT game container is missing.");

app.innerHTML = `
  <main class="shell">
    <header class="masthead">
      <a class="wordmark" href="#home" aria-label="Midnight home"><span class="wordmark-mark">M</span><span>MIDNIGHT<small>THE LAST TEN MINUTES</small></span></a>
      <div class="masthead-tools"><button id="audio-toggle" class="audio-toggle" type="button" aria-label="Mute game audio" aria-pressed="true">♫ SOUND ON</button><div class="masthead-status"><span class="status-light"></span><span id="connection-label">AWAITING GUESTS</span></div></div>
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
      <aside id="opening-prologue" class="prologue-panel hidden" aria-labelledby="prologue-title"><div class="prologue-seal" aria-hidden="true">M</div><div class="prologue-copy"><p class="card-kicker">THE MERIDIAN · 12:01 AM</p><h3 id="prologue-title">Forty years since the doors closed.</h3><p>Tonight, the elevator opened onto an empty lobby. The guest ledger contradicts the portrait; the portrait points east; a maintenance note warns that three records release the brass key.</p><p>Find what the hotel hid, reach the emergency exit, and leave together before midnight.</p></div><button id="skip-prologue" class="prologue-skip" type="button">SKIP OPENING <span aria-hidden="true">↗</span></button></aside>
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
        <div id="timer-card" class="timer-card" aria-live="polite"><span class="timer-label">UNTIL MIDNIGHT</span><strong id="timer">10:00</strong></div>
        <button id="leave-game" class="icon-button" aria-label="Leave game" title="Leave game">↗</button>
      </div>
      <div class="game-layout">
        <div class="scene-column">
          <div class="map-frame"><div class="map-topline"><span>✦ FLOOR 01</span><span>MERIDIAN HOTEL · 12:01 AM</span><span>✦</span></div><div id="game-canvas" class="game-canvas"></div><div class="map-bottomline"><span><i class="legend-dot yours"></i> YOU</span><span><i class="legend-dot friend"></i> YOUR PARTY</span><span><i class="legend-dot searchable"></i> SEARCH HERE</span></div></div>
          <aside id="investigation-panel" class="investigation-panel hidden" aria-label="New investigation evidence" aria-live="polite" aria-atomic="true">
            <button id="dismiss-investigation" class="investigation-dismiss" type="button" aria-label="Dismiss investigation panel">×</button>
            <div class="investigation-meta"><span id="investigation-index">NEW EVIDENCE</span><span id="investigation-location"></span></div>
            <h3 id="investigation-title"></h3>
            <p id="investigation-story" class="investigation-story"></p>
            <div class="investigation-proof"><span>RECOVERED NOTE</span><p id="investigation-evidence"></p></div>
            <span class="investigation-filed">ADDED TO THE SHARED CASE FILE</span>
          </aside>
          <aside id="clue-inspection-panel" class="clue-inspection-panel hidden" aria-label="On-site clue inspection" aria-live="polite" aria-atomic="true">
            <button id="dismiss-clue-inspection" class="inspection-dismiss" type="button" aria-label="Close clue inspection">×</button>
            <div class="inspection-heading"><span>ON-SITE INSPECTION</span><span id="clue-inspection-location"></span></div>
            <span class="inspection-seal" aria-hidden="true">⌕</span>
            <h3 id="clue-inspection-title"></h3>
            <p id="clue-inspection-observation" class="inspection-observation"></p>
            <div class="inspection-rule"><span>PRELIMINARY OBSERVATION · NOT YET FILED</span></div>
            <p class="inspection-guidance">Record this evidence to add it to your party's shared Case File.</p>
            <button id="record-clue-button" class="button inspection-record" type="button">RECORD EVIDENCE <span aria-hidden="true">↗</span></button>
          </aside>
          <div class="touch-controls" aria-label="Movement controls"><span class="control-hint">MOVE</span><div class="direction-pad"><button class="direction-button up" data-direction="up" aria-label="Move up">▲</button><button class="direction-button left" data-direction="left" aria-label="Move left">◀</button><button class="direction-button down" data-direction="down" aria-label="Move down">▼</button><button class="direction-button right" data-direction="right" aria-label="Move right">▶</button></div><span class="control-hint">WASD / ARROWS</span><button id="action-button" class="button action-button" disabled>WALK TO A GLOWING OBJECT</button></div>
          <div id="toast" class="toast" role="status" aria-live="polite"></div>
        </div>
        <aside class="game-sidebar">
          <div class="sidebar-section"><div class="sidebar-heading"><span>THE PLAN</span><span>01</span></div><p class="objective-copy">Find the clues.<br />Find the key.<br />Unlock the emergency exit.<br />Escape before midnight.</p><div class="objective-progress"><div class="progress-head"><span>CLUES UNCOVERED</span><strong id="clue-count">0 / 3</strong></div><div class="progress-track"><span id="progress-fill"></span></div></div></div>
          <div id="case-file-section" class="sidebar-section clues-section case-file-section">
            <div class="sidebar-heading"><span>CASE FILE</span><span id="case-file-count">0 / 3 FOUND</span></div>
            <p class="case-file-intro">Three records. One truth the Meridian tried to bury.</p>
            <ul id="clue-list" class="clue-list case-file-list" aria-label="Three shared case-file clues"></ul>
            <div id="case-file-complete" class="case-file-complete hidden" role="status" aria-live="polite">
              <span class="case-complete-seal" aria-hidden="true">✧</span>
              <div><strong>CASE FILE COMPLETE</strong><p>The records reveal the Meridian hid a guest in the east wing. Security can now release the brass key, making the emergency exit accessible—retrieve it to open the way out.</p></div>
            </div>
          </div>
          <div class="sidebar-section escape-section"><div class="sidebar-heading"><span>THE WAY OUT</span><span>03</span></div><div class="escape-status"><span id="key-status-icon" class="escape-icon">◇</span><div><strong id="key-status">Brass key</strong><small id="exit-status">Still locked</small></div></div><div class="escape-status"><span id="exit-status-icon" class="escape-icon">⌑</span><div><strong>Emergency exit</strong><small id="exit-detail">Down the main hall</small></div></div></div>
          <div class="party-section"><div class="sidebar-heading"><span>YOUR PARTY</span><span id="game-player-count">0 / 8</span></div><ul id="game-player-list" class="game-player-list"></ul></div>
        </aside>
      </div>
      <footer class="game-footer"><span>WASD OR ARROW KEYS TO MOVE</span><span>SEARCH WHEN YOU SEE A PROMPT</span><span>EVERY DISCOVERY IS SHARED</span></footer>
    </section>

    <div id="result-overlay" class="result-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="result-title">
      <div class="result-card"><div id="result-symbol" class="result-symbol">✦</div><p id="result-kicker" class="eyebrow">THE NIGHT IS YOURS</p><h2 id="result-title">YOU ESCAPED</h2><p id="result-copy">Together, you made it out before midnight.</p><div class="result-rule"><span></span>✧<span></span></div><button id="return-home" class="button button-primary"><span>RETURN TO THE LOBBY</span><span class="button-arrow">↗</span></button></div>
    </div>
    <div id="moment-overlay" class="moment-overlay" aria-hidden="true"></div>
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
const caseFileCount = byId<HTMLElement>("case-file-count");
const caseFileSection = byId<HTMLElement>("case-file-section");
const caseFileComplete = byId<HTMLElement>("case-file-complete");
const investigationPanel = byId<HTMLElement>("investigation-panel");
const investigationIndex = byId<HTMLElement>("investigation-index");
const investigationLocation = byId<HTMLElement>("investigation-location");
const investigationTitle = byId<HTMLElement>("investigation-title");
const investigationStory = byId<HTMLElement>("investigation-story");
const investigationEvidence = byId<HTMLElement>("investigation-evidence");
const clueInspectionPanel = byId<HTMLElement>("clue-inspection-panel");
const clueInspectionLocation = byId<HTMLElement>("clue-inspection-location");
const clueInspectionTitle = byId<HTMLElement>("clue-inspection-title");
const clueInspectionObservation = byId<HTMLElement>("clue-inspection-observation");
const recordClueButton = byId<HTMLButtonElement>("record-clue-button");
const audio = new HotelAudio();
const audioToggle = byId<HTMLButtonElement>("audio-toggle");
const openingPrologue = byId<HTMLElement>("opening-prologue");
let momentTimer = 0;
let investigationTimer = 0;
let inspectingClueId: string | null = null;
let presentationSnapshot: PresentationSnapshot | null = null;

let activeRoom: GameRoom | null = null;
let game: Phaser.Game | null = null;
let scene: HotelSceneType | null = null;
let toastTimer = 0;
let deferredNoticeTimer = 0;
let clueToastVisibleUntil = 0;
let pendingClueDiscoverer: string | null = null;
let lastPhase: Phase | null = null;


renderAudioControl();
audioToggle.addEventListener("click", () => {
  audio.setMuted(!audio.isMuted);
  if (!audio.isMuted && activeRoom) audio.unlockFromGesture();
  renderAudioControl();
});
byId<HTMLButtonElement>("skip-prologue").addEventListener("click", hidePrologue);
byId<HTMLButtonElement>("dismiss-investigation").addEventListener("click", hideInvestigation);
byId<HTMLButtonElement>("dismiss-clue-inspection").addEventListener("click", () => closeClueInspection());
recordClueButton.addEventListener("click", fileInspectedClue);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !clueInspectionPanel.classList.contains("hidden")) {
    event.preventDefault();
    closeClueInspection();
  }
});
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
actionButton.addEventListener("click", handleNearbyInteraction);

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
  audio.unlockFromGesture();
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
  audio.unlockFromGesture();
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
  pendingClueDiscoverer = null;
  clueToastVisibleUntil = 0;
  window.clearTimeout(deferredNoticeTimer);
  presentationSnapshot = capturePresentation(room.state);
  showPrologue();
  showEntryError("");
  roomCodeDisplay.textContent = room.roomId;
  room.onStateChange((state) => syncRoomState(state));
  room.onMessage("notice", (message: Notice) => {
    const discovery = message.text.match(/^(.+?) finds a clue in .+\.$/u);
    pendingClueDiscoverer = discovery?.[1] ?? null;
    window.clearTimeout(deferredNoticeTimer);

    const followsThirdClue = message.text === "All three records are found. The security key cabinet is ready.";
    const discoveryTimeRemaining = clueToastVisibleUntil - Date.now();
    if (followsThirdClue && discoveryTimeRemaining > 0) {
      deferredNoticeTimer = window.setTimeout(
        () => showToast(message.text, message.tone),
        discoveryTimeRemaining,
      );
      return;
    }
    showToast(message.text, message.tone);
  });
  room.onMessage("clue", (message: ClueMessage) => {
    if (message.text) {
      closeClueInspection();
      const discoverer = pendingClueDiscoverer;
      pendingClueDiscoverer = null;
      const clue = CASE_CLUES.find((entry) => entry.id === message.id);
      if (clue) {
        const localPlayerName = activeRoom?.state.players?.get(activeRoom.sessionId)?.name ?? byId<HTMLInputElement>("player-name").value.trim();
        const notification = discoverer === localPlayerName && localPlayerName
          ? `You discovered: ${clue.title}`
          : `${discoverer ?? "A player"} discovered: ${clue.title}`;
        showToast(notification, "success");
        clueToastVisibleUntil = Date.now() + 3600;
      }
      showInvestigation(message.id, message.text);
      audio.playClueFound();
      pulseMoment("clue");
      const newEntry = clue ? clueList.querySelector<HTMLElement>('[data-clue-id="' + clue.id + '"]') : null;
      newEntry?.classList.add("clue-arrival");
      window.setTimeout(() => newEntry?.classList.remove("clue-arrival"), 1500);
    }
  });
  connectionLabel.textContent = "CONNECTED TO THE MERIDIAN";
  connectionLabel.parentElement?.classList.add("is-connected");
  showScreen("lobby");
  syncRoomState(room.state);
}

function syncRoomState(state: GameRoom["state"]): void {
  if (!activeRoom) return;
  presentRoomChanges(state);
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
  const secondsRemaining = Math.max(0, state.remainingSeconds);
  timer.textContent = formatTime(secondsRemaining);
  const timerCard = byId<HTMLElement>("timer-card");
  const finalCountdown = state.phase === "playing" && secondsRemaining > 0 && secondsRemaining <= 10;
  timerCard.classList.toggle("is-warning", secondsRemaining > 60 && secondsRemaining <= 120);
  timerCard.classList.toggle("is-critical", secondsRemaining > 0 && secondsRemaining <= 60);
  timerCard.classList.toggle("is-final", finalCountdown);
  gameScreen.classList.toggle("is-final-countdown", finalCountdown);
  audio.setCountdownPressure(state.phase === "playing" ? secondsRemaining : 600);
  byId<HTMLElement>("clue-count").textContent = `${state.cluesFound} / 3`;
  const progressFill = byId<HTMLElement>("progress-fill");
  progressFill.style.width = `${Math.min(100, state.cluesFound / 3 * 100)}%`;
  progressFill.closest(".objective-progress")?.classList.toggle("is-complete", state.cluesFound >= 3);
  byId<HTMLElement>("key-status").textContent = state.keyFound ? "Brass key found" : "Brass key";
  byId<HTMLElement>("exit-status").textContent = state.keyFound ? "The way is open" : "Still locked";
  byId<HTMLElement>("exit-detail").textContent = state.exitUnlocked ? "Unlocked — make your escape" : "Down the main hall";
  byId<HTMLElement>("key-status-icon").classList.toggle("complete", state.keyFound);
  byId<HTMLElement>("exit-status-icon").classList.toggle("complete", state.exitUnlocked);
  byId<HTMLElement>("key-status-icon").closest(".escape-status")?.classList.toggle("is-complete", state.keyFound);
  byId<HTMLElement>("exit-status-icon").closest(".escape-status")?.classList.toggle("is-complete", state.exitUnlocked);
  renderClues(state);
  if (scene) scene.setRoom(activeRoom, activeRoom?.sessionId ?? "");
}

function renderClues(state: GameRoom["state"]): void {
  let foundCount = 0;
  const entries = CASE_CLUES.map((clue, index) => {
    const found = state.interactables?.get(clue.id)?.found ?? false;
    if (found) foundCount += 1;

    const item = document.createElement("li");
    item.className = "clue-item case-entry" + (found ? " is-found" : "");
    item.dataset.clueId = clue.id;
    item.setAttribute("aria-label", clue.title + ": " + (found ? "recovered" : "not yet recovered"));

    const marker = document.createElement("span");
    marker.className = "clue-marker case-entry-marker";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = found ? "✓" : String(index + 1).padStart(2, "0");

    const copy = document.createElement("div");
    copy.className = "case-entry-copy";
    const heading = document.createElement("div");
    heading.className = "case-entry-heading";

    const title = document.createElement("strong");
    title.textContent = found ? clue.title : "RECORD " + String(index + 1).padStart(2, "0");
    const status = document.createElement("span");
    status.className = "case-entry-status";
    status.textContent = found ? "RECOVERED" : "SEALED";
    heading.append(title, status);

    const detail = document.createElement("p");
    detail.textContent = found ? clue.story : "Evidence not yet recovered.";
    copy.append(heading, detail);
    item.append(marker, copy);
    return item;
  });

  const complete = foundCount === CASE_CLUES.length;
  caseFileCount.textContent = foundCount + " / " + CASE_CLUES.length + " FOUND";
  caseFileSection.classList.toggle("is-complete", complete);
  caseFileComplete.classList.toggle("hidden", !complete);
  clueList.replaceChildren(...entries);
}

function renderNearbyAction(target: NearbyTarget | null): void {
  const clue = target && CASE_CLUES.find((entry) => entry.id === target.id);
  const found = clue ? activeRoom?.state.interactables?.get(clue.id)?.found ?? false : false;
  const verb = clue && !found
    ? inspectingClueId === clue.id ? "RECORD EVIDENCE" : "INSPECT"
    : target?.verb ?? "SEARCH";
  actionButton.disabled = !target || activeRoom?.state.phase !== "playing";
  actionButton.textContent = target ? `${verb} · ${target.label}` : "WALK TO A GLOWING OBJECT";
  actionButton.classList.toggle("is-ready", Boolean(target));
}

function handleNearbyInteraction(): void {
  const target = scene?.getNearbyTarget();
  if (!target || !activeRoom) return;

  const clue = CASE_CLUES.find((entry) => entry.id === target.id);
  const found = clue ? activeRoom.state.interactables?.get(clue.id)?.found ?? false : false;
  if (!clue || found) {
    activeRoom.send("interact", { id: target.id });
    return;
  }

  if (inspectingClueId === clue.id) {
    fileInspectedClue();
    return;
  }

  inspectingClueId = clue.id;
  showClueInspection(clue);
  renderNearbyAction(target);
}

function showClueInspection(clue: (typeof CASE_CLUES)[number]): void {
  clueInspectionLocation.textContent = clue.location;
  clueInspectionTitle.textContent = clue.title;
  clueInspectionObservation.textContent = clue.inspection;
  clueInspectionPanel.classList.remove("hidden");
  clueInspectionPanel.classList.remove("is-visible");
  void clueInspectionPanel.offsetWidth;
  clueInspectionPanel.classList.add("is-visible");
  recordClueButton.focus();
}

function fileInspectedClue(): void {
  const clue = CASE_CLUES.find((entry) => entry.id === inspectingClueId);
  const target = scene?.getNearbyTarget();
  if (!clue || !activeRoom || target?.id !== clue.id) {
    closeClueInspection();
    return;
  }

  if (activeRoom.state.interactables?.get(clue.id)?.found) {
    closeClueInspection();
    return;
  }

  const room = activeRoom;
  closeClueInspection();
  room.send("interact", { id: clue.id });
}

function closeClueInspection(): void {
  const hadFocus = clueInspectionPanel.contains(document.activeElement);
  inspectingClueId = null;
  clueInspectionPanel.classList.remove("is-visible");
  clueInspectionPanel.classList.add("hidden");
  if (hadFocus) actionButton.focus();
  renderNearbyAction(scene?.getNearbyTarget() ?? null);
}

function showInvestigation(clueId: string, evidence: string): void {
  const clue = CASE_CLUES.find((entry) => entry.id === clueId);
  if (!clue) return;

  investigationIndex.textContent = "EVIDENCE " + String(CASE_CLUES.indexOf(clue) + 1).padStart(2, "0") + " / 03";
  investigationLocation.textContent = clue.location;
  investigationTitle.textContent = clue.title;
  investigationStory.textContent = clue.story;
  investigationEvidence.textContent = evidence;
  investigationPanel.classList.remove("hidden");
  investigationPanel.classList.remove("is-visible");
  void investigationPanel.offsetWidth;
  investigationPanel.classList.add("is-visible");

  window.clearTimeout(investigationTimer);
  investigationTimer = window.setTimeout(hideInvestigation, 7000);
}

function hideInvestigation(): void {
  window.clearTimeout(investigationTimer);
  investigationPanel.classList.remove("is-visible");
  investigationPanel.classList.add("hidden");
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
  scene.setFootstepCallback(() => audio.playFootstep());
  game.scene.add("HotelScene", scene, true);
  scene.onNearbyTargetChange((target) => {
    if (inspectingClueId && target?.id !== inspectingClueId) closeClueInspection();
    renderNearbyAction(target);
  });
}

function renderAudioControl(): void {
  audioToggle.textContent = audio.isMuted ? "♫ SOUND OFF" : "♫ SOUND ON";
  audioToggle.setAttribute("aria-pressed", String(!audio.isMuted));
  audioToggle.setAttribute("aria-label", audio.isMuted ? "Unmute game audio" : "Mute game audio");
  audioToggle.title = audio.isMuted ? "Turn hotel sounds on" : "Turn hotel sounds off";
}

function showPrologue(): void {
  openingPrologue.classList.remove("hidden");
  openingPrologue.classList.remove("is-arriving");
  void openingPrologue.offsetWidth;
  openingPrologue.classList.add("is-arriving");
}

function hidePrologue(): void {
  openingPrologue.classList.add("hidden");
  openingPrologue.classList.remove("is-arriving");
}

function pulseMoment(moment: "start" | "clue" | "key" | "exit" | "escape" | "win" | "loss"): void {
  const overlay = byId<HTMLElement>("moment-overlay");
  overlay.className = "moment-overlay";
  void overlay.offsetWidth;
  overlay.classList.add("moment-" + moment);
  overlay.classList.add("is-active");
  window.clearTimeout(momentTimer);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  momentTimer = window.setTimeout(() => { overlay.className = "moment-overlay"; }, reducedMotion ? 180 : 1050);
}

interface PresentationSnapshot {
  phase: Phase;
  cluesFound: number;
  keyFound: boolean;
  exitUnlocked: boolean;
  escapedPlayers: Set<string>;
}

function capturePresentation(state: GameRoom["state"]): PresentationSnapshot {
  return {
    phase: state.phase,
    cluesFound: state.cluesFound,
    keyFound: state.keyFound,
    exitUnlocked: state.exitUnlocked,
    escapedPlayers: new Set([...(state.players?.entries() ?? [])].filter(([, player]) => player.escaped).map(([id]) => id)),
  };
}

function presentRoomChanges(state: GameRoom["state"]): void {
  const previous = presentationSnapshot;
  presentationSnapshot = capturePresentation(state);
  if (!previous) return;

  if (previous.phase === "lobby" && state.phase === "playing") {
    hidePrologue();
    audio.playElevatorClose();
    pulseMoment("start");
  }
  if (!previous.keyFound && state.keyFound) {
    audio.playKeyFound();
    pulseMoment("key");
  }
  if (!previous.exitUnlocked && state.exitUnlocked) {
    audio.playExitUnlocked();
    pulseMoment("exit");
  }
  if (state.phase === "lost" && previous.phase !== "lost") {
    audio.playTimeout();
    pulseMoment("loss");
  } else if (state.phase === "won" && previous.phase !== "won") {
    audio.playWin();
    pulseMoment("win");
  } else {
    const newEscape = [...(state.players?.entries() ?? [])].some(([id, player]) => player.escaped && !previous.escapedPlayers.has(id));
    if (newEscape) {
      audio.playEscape();
      pulseMoment("escape");
    }
  }
}

function showScreen(screen: "landing" | "lobby" | "game"): void {
  landingScreen.classList.toggle("hidden", screen !== "landing");
  lobbyScreen.classList.toggle("hidden", screen !== "lobby");
  gameScreen.classList.toggle("hidden", screen !== "game");
}

async function leaveRoom(): Promise<void> {
  const oldRoom = activeRoom;
  activeRoom = null;
  pendingClueDiscoverer = null;
  clueToastVisibleUntil = 0;
  inspectingClueId = null;
  window.clearTimeout(deferredNoticeTimer);
  clueInspectionPanel.classList.remove("is-visible");
  clueInspectionPanel.classList.add("hidden");
  scene = null;
  lastPhase = null;
  presentationSnapshot = null;
  hidePrologue();
  hideInvestigation();
  audio.stopAmbience();
  gameScreen.classList.remove("is-final-countdown");
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
  resultOverlay.classList.toggle("result-win", won);
  resultOverlay.classList.toggle("result-loss", !won);
}

function showToast(text: string, tone = "story"): void {
  const toast = byId<HTMLElement>("toast");
  toast.classList.remove("visible");
  void toast.offsetWidth;
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
