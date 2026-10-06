import { randomInt } from "node:crypto";
import { Room, type Client } from "@colyseus/core";
import {
  DEFAULT_GAME_DURATION_SECONDS,
  EXIT,
  INTERACTION_RADIUS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  SEARCHABLE_OBJECTS,
  SPAWN,
  WALKABLE_ZONES,
  type SearchableObject,
} from "@midnight/shared";
import { InteractableState, MidnightState, PlayerState } from "./state.js";

const ROOM_CODE_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PLAYER_COLORS = [0xe6c987, 0x87cbd0, 0xc4a1df, 0xefa492, 0x9dc78e, 0xd49cb9, 0x91a8df, 0xd3c28d];
const WALK_SPEED = 190;
const ROOM_CODE_CHANNEL = "$midnight-room-codes";

interface MoveInput {
  up?: boolean;
  down?: boolean;
  left?: boolean;
  right?: boolean;
}

interface InteractInput {
  id?: string;
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x1 - x2, y1 - y2);
}

function isWalkable(x: number, y: number): boolean {
  return WALKABLE_ZONES.some(
    (zone) => x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height,
  );
}

function makePlayerName(value: unknown): string {
  if (typeof value !== "string") return "Guest";
  const cleaned = value.replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, 18);
  return cleaned || "Guest";
}

function gameDurationSeconds(): number {
  const configured = Number(process.env.GAME_DURATION_SECONDS);
  return Number.isInteger(configured) && configured >= 1 && configured <= 3600
    ? configured
    : DEFAULT_GAME_DURATION_SECONDS;
}

export class MidnightRoom extends Room<{ state: MidnightState }> {
  maxClients = MAX_PLAYERS;
  maxMessagesPerSecond = 40;
  private readonly movement = new Map<string, MoveInput>();
  private deadline = 0;
  private durationSeconds = DEFAULT_GAME_DURATION_SECONDS;

  async onCreate(): Promise<void> {
    this.durationSeconds = gameDurationSeconds();
    this.setState(new MidnightState());

    for (const object of SEARCHABLE_OBJECTS) {
      this.state.interactables.set(object.id, new InteractableState());
    }
    this.state.interactables.set(EXIT.id, new InteractableState());
    this.state.remainingSeconds = this.durationSeconds;

    this.roomId = await this.generateRoomCode();
    this.setSimulationInterval((deltaTime) => this.updateGame(deltaTime), 50);

    this.onMessage<MoveInput>("move", (client, input) => this.receiveMovement(client, input));
    this.onMessage<InteractInput>("interact", (client, input) => this.interact(client, input));
    this.onMessage("start-game", (client) => this.startGame(client));
  }

  onJoin(client: Client, options: { name?: unknown }): void {
    const player = new PlayerState();
    player.name = makePlayerName(options?.name);
    player.x = SPAWN.x + Math.min(this.state.players.size, 4) * 18;
    player.y = SPAWN.y + Math.floor(this.state.players.size / 5) * 26;
    player.color = PLAYER_COLORS[this.state.players.size % PLAYER_COLORS.length];
    this.state.players.set(client.sessionId, player);
    this.movement.set(client.sessionId, {});

    if (!this.state.hostSessionId) {
      this.state.hostSessionId = client.sessionId;
    }

    client.send("notice", { text: `Welcome to the hotel, ${player.name}.`, tone: "story" });
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.movement.delete(client.sessionId);

    if (this.state.hostSessionId === client.sessionId) {
      const nextHost = this.state.players.keys().next().value ?? "";
      this.state.hostSessionId = nextHost;
      if (nextHost) {
        this.broadcast("notice", {
          text: `${this.state.players.get(nextHost)?.name ?? "A guest"} is now the host.`,
          tone: "story",
        });
      }
    }

    this.finishIfEveryoneEscaped();
  }

  async onDispose(): Promise<void> {
    await this.presence.srem(ROOM_CODE_CHANNEL, this.roomId);
  }

  private async generateRoomCode(): Promise<string> {
    const currentCodes = await this.presence.smembers(ROOM_CODE_CHANNEL);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      let code = "";
      for (let index = 0; index < 6; index += 1) {
        code += ROOM_CODE_CHARACTERS[randomInt(ROOM_CODE_CHARACTERS.length)];
      }
      if (!currentCodes.includes(code)) {
        await this.presence.sadd(ROOM_CODE_CHANNEL, code);
        return code;
      }
    }
    throw new Error("Could not reserve a room code. Please try creating a room again.");
  }

  private receiveMovement(client: Client, input: MoveInput): void {
    if (this.state.phase !== "playing") return;
    const player = this.state.players.get(client.sessionId);
    if (!player || player.escaped || !input || typeof input !== "object") return;

    this.movement.set(client.sessionId, {
      up: input.up === true,
      down: input.down === true,
      left: input.left === true,
      right: input.right === true,
    });
  }

  private updateGame(deltaTime: number): void {
    if (this.state.phase !== "playing") return;

    const now = Date.now();
    const seconds = Math.max(0, Math.ceil((this.deadline - now) / 1000));
    if (seconds !== this.state.remainingSeconds) {
      this.state.remainingSeconds = seconds;
    }
    if (now >= this.deadline) {
      this.state.remainingSeconds = 0;
      this.state.phase = "lost";
      this.movement.clear();
      this.broadcast("notice", { text: "The hotel clock strikes midnight.", tone: "danger" });
      return;
    }

    const secondsElapsed = Math.max(0, Math.min(deltaTime / 1000, 0.1));
    const distanceThisTick = WALK_SPEED * secondsElapsed;

    for (const [sessionId, player] of this.state.players) {
      if (player.escaped) continue;
      const input = this.movement.get(sessionId);
      if (!input) continue;

      let horizontal = Number(input.right) - Number(input.left);
      let vertical = Number(input.down) - Number(input.up);
      if (horizontal === 0 && vertical === 0) continue;
      const magnitude = Math.hypot(horizontal, vertical);
      horizontal /= magnitude;
      vertical /= magnitude;

      const nextX = player.x + horizontal * distanceThisTick;
      const nextY = player.y + vertical * distanceThisTick;
      if (horizontal !== 0 && isWalkable(nextX, player.y)) player.x = nextX;
      if (vertical !== 0 && isWalkable(player.x, nextY)) player.y = nextY;
    }
  }

  private startGame(client: Client): void {
    if (client.sessionId !== this.state.hostSessionId) {
      this.sendNotice(client, "Only the host can begin the night.", "warning");
      return;
    }
    if (this.state.phase !== "lobby") {
      this.sendNotice(client, "This night has already begun.", "warning");
      return;
    }
    if (this.state.players.size < MIN_PLAYERS) {
      this.sendNotice(client, "At least two guests must be in the lobby.", "warning");
      return;
    }

    this.deadline = Date.now() + this.durationSeconds * 1000;
    this.state.remainingSeconds = this.durationSeconds;
    this.state.phase = "playing";
    this.lock();
    this.broadcast("notice", { text: "The elevator doors close. Ten minutes until midnight.", tone: "story" });
  }

  private interact(client: Client, input: InteractInput): void {
    if (this.state.phase !== "playing") {
      this.sendNotice(client, "Wait until the host starts the night.", "warning");
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player || player.escaped) return;
    const id = typeof input?.id === "string" ? input.id : "";

    if (id === EXIT.id) {
      if (distance(player.x, player.y, EXIT.x, EXIT.y) > INTERACTION_RADIUS) {
        this.sendNotice(client, "Move closer to the emergency exit.", "warning");
        return;
      }
      if (!this.state.exitUnlocked && !this.state.keyFound) {
        this.sendNotice(client, "The emergency exit is locked. Find the security key.", "warning");
        return;
      }
      if (!this.state.exitUnlocked) {
        this.state.exitUnlocked = true;
        this.state.interactables.get(EXIT.id)!.found = true;
        this.broadcast("notice", { text: `${player.name} unlocks the emergency exit!`, tone: "success" });
      }
      player.escaped = true;
      this.broadcast("notice", { text: `${player.name} escapes into the night.`, tone: "success" });
      this.finishIfEveryoneEscaped();
      return;
    }

    const object: SearchableObject | undefined = SEARCHABLE_OBJECTS.find((item) => item.id === id);
    if (!object) {
      this.sendNotice(client, "There is nothing to search here.", "warning");
      return;
    }
    if (distance(player.x, player.y, object.x, object.y) > INTERACTION_RADIUS) {
      this.sendNotice(client, `Move closer to ${object.label.toLowerCase()} to search it.`, "warning");
      return;
    }

    const itemState = this.state.interactables.get(object.id);
    if (!itemState || itemState.found) {
      this.sendNotice(client, "Your group has already searched this.", "warning");
      return;
    }

    if (object.kind === "clue") {
      itemState.found = true;
      this.state.cluesFound += 1;
      this.broadcast("notice", { text: `${player.name} finds a clue in ${object.room}.`, tone: "success" });
      this.broadcast("clue", { id: object.id, text: object.clue });
      if (this.state.cluesFound === SEARCHABLE_OBJECTS.filter((item) => item.kind === "clue").length) {
        this.broadcast("notice", { text: "All three records are found. The security key cabinet is ready.", tone: "success" });
      }
      return;
    }

    const clueCount = SEARCHABLE_OBJECTS.filter((item) => item.kind === "clue").length;
    if (this.state.cluesFound < clueCount) {
      this.sendNotice(client, `The cabinet will not open. Find all ${clueCount} clues first.`, "warning");
      return;
    }

    itemState.found = true;
    this.state.keyFound = true;
    this.broadcast("notice", { text: `${player.name} finds the brass emergency key.`, tone: "success" });
  }

  private finishIfEveryoneEscaped(): void {
    if (this.state.phase !== "playing" || this.state.players.size === 0) return;
    const allEscaped = [...this.state.players.values()].every((player) => player.escaped);
    if (!allEscaped) return;
    this.state.phase = "won";
    this.movement.clear();
    this.broadcast("notice", { text: "The whole group makes it out before midnight.", tone: "success" });
  }

  private sendNotice(client: Client, text: string, tone: "warning" | "success" | "story"): void {
    client.send("notice", { text, tone });
  }
}
