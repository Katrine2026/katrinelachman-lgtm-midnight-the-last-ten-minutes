import Phaser from "phaser";
import {
  EXIT,
  INTERACTION_RADIUS,
  MAP_ROOMS,
  SEARCHABLE_OBJECTS,
  WORLD,
} from "@midnight/shared";

interface PlayerView {
  name: string;
  x: number;
  y: number;
  color: number;
  escaped: boolean;
}

interface SceneRoom {
  state: {
    phase: string;
    exitUnlocked: boolean;
    players: Map<string, PlayerView>;
    interactables: Map<string, { found: boolean }>;
  };
  send(type: string, message?: unknown): void;
}

interface Avatar {
  container: Phaser.GameObjects.Container;
  name: string;
  color: number;
  targetX: number;
  targetY: number;
  escaped: boolean;
}

export interface NearbyTarget {
  id: string;
  label: string;
  verb: string;
}

const FLOOR_COLORS = {
  lobby: 0x242238,
  guest: 0x1d2033,
  security: 0x232035,
  hallway: 0x222338,
  exit: 0x252139,
};

export class HotelScene extends Phaser.Scene {
  private room: SceneRoom;
  private readonly sessionId: string;
  private readonly avatars = new Map<string, Avatar>();
  private readonly touchInput = new Set<string>();
  private readonly markers = new Map<string, { glow: Phaser.GameObjects.Arc; icon: Phaser.GameObjects.Container; label: Phaser.GameObjects.Text }>();
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private lastInput = "";
  private lastSentAt = 0;
  private nearbyTarget: NearbyTarget | null = null;
  private nearbyTargetChanged: ((target: NearbyTarget | null) => void) | null = null;

  constructor(room: SceneRoom, sessionId: string) {
    super({ key: "HotelScene" });
    this.room = room;
    this.sessionId = sessionId;
  }

  create(): void {
    this.drawHotel();
    this.drawDecor();
    this.drawSearchables();
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keyW = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyA = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyS = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyD = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height);
    this.syncAvatars();
    this.syncSearchables();
  }

  update(time: number): void {
    this.syncAvatars();
    this.syncSearchables();
    this.updateMovement(time);
    this.updateNearbyTarget();
  }

  setRoom(room: SceneRoom | null, _sessionId: string): void {
    if (!room) return;
    this.room = room;
    this.syncAvatars();
    this.syncSearchables();
  }

  setTouchDirection(direction: string, active: boolean): void {
    if (!["up", "down", "left", "right"].includes(direction)) return;
    if (active) this.touchInput.add(direction);
    else this.touchInput.delete(direction);
  }

  getNearbyTarget(): NearbyTarget | null {
    return this.nearbyTarget;
  }

  onNearbyTargetChange(callback: (target: NearbyTarget | null) => void): void {
    this.nearbyTargetChanged = callback;
    callback(this.nearbyTarget);
  }

  private drawHotel(): void {
    const graphics = this.add.graphics();
    graphics.fillStyle(0x090c18, 1);
    graphics.fillRect(0, 0, WORLD.width, WORLD.height);

    for (let y = 24; y < WORLD.height; y += 40) {
      for (let x = 24; x < WORLD.width; x += 40) {
        graphics.fillStyle((x + y) % 3 === 0 ? 0x14182a : 0x111526, 0.56);
        graphics.fillCircle(x, y, 1.1);
      }
    }

    graphics.fillStyle(FLOOR_COLORS.lobby, 1);
    graphics.fillRoundedRect(40, 360, 220, 220, 8);
    graphics.fillStyle(FLOOR_COLORS.hallway, 1);
    graphics.fillRoundedRect(180, 294, 820, 110, 5);

    for (const room of MAP_ROOMS) {
      const color = room.kind === "lobby" ? FLOOR_COLORS.lobby : room.kind === "security" ? FLOOR_COLORS.security : FLOOR_COLORS.guest;
      graphics.fillStyle(color, 1);
      graphics.fillRoundedRect(room.x, room.y, room.width, room.height, 5);
      graphics.fillStyle(0x7780a8, 0.08);
      for (let x = room.x + 18; x < room.x + room.width - 8; x += 28) {
        graphics.fillRect(x, room.y + 42, 1, room.height - 55);
      }
      for (let y = room.y + 53; y < room.y + room.height - 8; y += 28) {
        graphics.fillRect(room.x + 12, y, room.width - 24, 1);
      }
      graphics.lineStyle(2, 0x626987, 0.72);
      graphics.strokeRoundedRect(room.x, room.y, room.width, room.height, 5);
    }

    graphics.fillStyle(FLOOR_COLORS.exit, 1);
    graphics.fillRoundedRect(970, 310, 100, 82, 5);
    graphics.lineStyle(2, 0x81749c, 0.72);
    graphics.strokeRoundedRect(970, 310, 100, 82, 5);

    graphics.lineStyle(2, 0x6c718f, 0.74);
    graphics.beginPath();
    graphics.moveTo(40, 360); graphics.lineTo(180, 360);
    graphics.moveTo(260, 360); graphics.lineTo(260, 580);
    graphics.moveTo(40, 580); graphics.lineTo(260, 580);
    graphics.moveTo(40, 360); graphics.lineTo(40, 580);
    graphics.moveTo(180, 294); graphics.lineTo(255, 294);
    graphics.moveTo(327, 294); graphics.lineTo(455, 294);
    graphics.moveTo(527, 294); graphics.lineTo(655, 294);
    graphics.moveTo(727, 294); graphics.lineTo(855, 294);
    graphics.moveTo(927, 294); graphics.lineTo(1000, 294);
    graphics.moveTo(180, 404); graphics.lineTo(1000, 404);
    graphics.moveTo(180, 294); graphics.lineTo(180, 404);
    graphics.moveTo(1000, 294); graphics.lineTo(1000, 310);
    graphics.moveTo(1000, 392); graphics.lineTo(1000, 404);
    graphics.strokePath();

    for (const door of [
      { x: 255, y: 294, width: 72 },
      { x: 455, y: 294, width: 72 },
      { x: 655, y: 294, width: 72 },
      { x: 855, y: 294, width: 72 },
    ]) {
      graphics.lineStyle(1, 0xd8bc82, 0.62);
      graphics.beginPath();
      graphics.moveTo(door.x, door.y + 4);
      graphics.lineTo(door.x, door.y + door.width);
      graphics.moveTo(door.x + door.width, door.y + 4);
      graphics.lineTo(door.x + door.width, door.y + door.width);
      graphics.strokePath();
      graphics.fillStyle(0xd8bc82, 0.16);
      graphics.fillRect(door.x + 2, door.y + 5, door.width - 4, 4);
    }

    const labels = [
      { text: "LOBBY / RECEPTION", x: 61, y: 379, color: "#d4c5a2" },
      { text: "MAIN HALL", x: 448, y: 328, color: "#9da0ba" },
      { text: "EMERGENCY EXIT", x: 987, y: 321, color: "#e2cb97" },
    ];
    for (const label of labels) {
      this.add.text(label.x, label.y, label.text, {
        fontFamily: "Arial, sans-serif",
        fontSize: "9px",
        color: label.color,
        fontStyle: "bold",
        letterSpacing: 2,
      }).setDepth(2);
    }

    for (const room of MAP_ROOMS) {
      if (room.kind === "lobby") continue;
      this.add.text(room.x + 13, room.y + 12, room.label, {
        fontFamily: "Georgia, serif",
        fontSize: room.kind === "security" ? "12px" : "16px",
        color: room.kind === "security" ? "#c7b1dc" : "#d8d0e4",
        fontStyle: "bold",
        letterSpacing: 2,
      }).setDepth(2);
      this.add.text(room.x + 14, room.y + 31, room.subtitle, {
        fontFamily: "Arial, sans-serif",
        fontSize: "7px",
        color: "#868aa7",
        letterSpacing: 1.4,
      }).setDepth(2);
    }
  }

  private drawDecor(): void {
    const decor = this.add.graphics().setDepth(3);
    decor.fillStyle(0x111528, 0.96);
    decor.fillRoundedRect(72, 420, 78, 29, 4);
    decor.fillStyle(0x665e78, 0.9);
    decor.fillRoundedRect(78, 424, 66, 9, 3);
    decor.lineStyle(1, 0xcbb783, 0.5);
    decor.strokeRoundedRect(70, 417, 82, 35, 4);

    for (const [x, y] of [[220, 122], [420, 122], [620, 122]] as const) {
      decor.fillStyle(0x29253a, 1);
      decor.fillRoundedRect(x, y, 87, 28, 5);
      decor.fillStyle(0x5a536d, 0.85);
      decor.fillRoundedRect(x + 5, y + 4, 77, 9, 3);
      decor.lineStyle(1, 0x77708a, 0.52);
      decor.strokeRoundedRect(x - 4, y - 4, 95, 36, 6);
      decor.fillStyle(0x8f819f, 0.36);
      decor.fillCircle(x + 17, y + 21, 2);
      decor.fillCircle(x + 70, y + 21, 2);
    }

    decor.fillStyle(0x24263c, 1);
    decor.fillRoundedRect(817, 101, 42, 86, 3);
    decor.lineStyle(1, 0x817495, 0.8);
    decor.strokeRoundedRect(817, 101, 42, 86, 3);
    for (let drawer = 0; drawer < 3; drawer += 1) {
      decor.lineBetween(823, 128 + drawer * 22, 853, 128 + drawer * 22);
      decor.fillStyle(0xdfc48d, 0.76);
      decor.fillCircle(838, 117 + drawer * 22, 1.5);
    }

    for (const [x, y] of [[60, 520], [230, 520], [312, 353], [742, 352], [948, 344]] as const) {
      decor.fillStyle(0x17222b, 1);
      decor.fillRoundedRect(x, y, 18, 24, 4);
      decor.fillStyle(0x385348, 0.82);
      decor.fillCircle(x + 9, y + 6, 11);
      decor.fillStyle(0x54705b, 0.8);
      decor.fillCircle(x + 4, y + 13, 7);
      decor.fillCircle(x + 14, y + 13, 7);
    }

    decor.fillStyle(0x6a5b72, 0.62);
    decor.fillRoundedRect(58, 464, 48, 14, 3);
    decor.fillStyle(0xd8bc82, 0.75);
    decor.fillCircle(82, 457, 4);
    decor.fillStyle(0x604e68, 0.45);
    decor.fillRoundedRect(174, 457, 27, 10, 3);
    decor.fillStyle(0xd8bc82, 0.65);
    decor.fillCircle(186, 450, 3);

    for (const x of [292, 490, 690, 890]) {
      decor.fillStyle(0xd8bc82, 0.48);
      decor.fillCircle(x, 238, 3);
      decor.fillStyle(0xd8bc82, 0.08);
      decor.fillCircle(x, 238, 15);
    }

    this.add.text(1002, 366, "KEEP OUT", {
      fontFamily: "Arial, sans-serif",
      fontSize: "6px",
      color: "#7f7991",
      letterSpacing: 1.4,
    }).setDepth(4);
  }

  private drawSearchables(): void {
    const points = [
      ...SEARCHABLE_OBJECTS.map((object) => ({ id: object.id, label: object.label, x: object.x, y: object.y, kind: object.kind })),
      { id: EXIT.id, label: EXIT.label, x: EXIT.x, y: EXIT.y, kind: "exit" },
    ];

    for (const point of points) {
      const color = point.kind === "key" ? 0xe2c17e : point.kind === "exit" ? 0xd89391 : 0xb6a2db;
      const glow = this.add.circle(point.x, point.y, 21, color, 0.08).setDepth(6);
      const ring = this.add.circle(point.x, point.y, 14, color, 0.1).setStrokeStyle(1, color, 0.8).setDepth(7);
      const icon = this.makeObjectIcon(point.kind, color).setPosition(point.x, point.y).setDepth(8);
      const label = this.add.text(point.x, point.y + 22, point.label.toUpperCase(), {
        fontFamily: "Arial, sans-serif",
        fontSize: "7px",
        color: "#d0c9de",
        fontStyle: "bold",
        letterSpacing: 1.2,
        backgroundColor: "#111426cc",
        padding: { x: 4, y: 3 },
      }).setOrigin(0.5, 0).setDepth(8);
      this.markers.set(point.id, { glow, icon, label });
      this.tweens.add({ targets: [glow, ring], alpha: { from: 0.42, to: 0.9 }, duration: 1250, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
  }

  private makeObjectIcon(kind: string, color: number): Phaser.GameObjects.Container {
    const icon = this.add.container(0, 0);
    const graphics = this.add.graphics();
    graphics.fillStyle(0x121528, 1);
    graphics.lineStyle(1.5, color, 0.95);

    if (kind === "clue") {
      graphics.fillRoundedRect(-7, -9, 14, 18, 2);
      graphics.strokeRoundedRect(-7, -9, 14, 18, 2);
      graphics.lineBetween(-3, -4, 3, -4);
      graphics.lineBetween(-3, 0, 3, 0);
      graphics.lineBetween(-3, 4, 2, 4);
    } else if (kind === "key") {
      graphics.fillCircle(-2, -2, 5);
      graphics.strokeCircle(-2, -2, 5);
      graphics.lineBetween(2, 2, 9, 9);
      graphics.lineBetween(6, 6, 9, 3);
      graphics.lineBetween(8, 8, 11, 5);
    } else if (kind === "exit") {
      graphics.fillRoundedRect(-7, -10, 14, 20, 2);
      graphics.strokeRoundedRect(-7, -10, 14, 20, 2);
      graphics.fillCircle(3, 0, 1.3);
      graphics.lineStyle(1, color, 0.95);
      graphics.lineBetween(-12, 0, -5, 0);
      graphics.lineBetween(-9, -3, -12, 0);
      graphics.lineBetween(-9, 3, -12, 0);
    }

    icon.add(graphics);
    return icon;
  }

  private syncAvatars(): void {
    const players = this.room.state.players;
    for (const [sessionId, player] of players) {
      let avatar = this.avatars.get(sessionId);
      if (!avatar) {
        avatar = this.createAvatar(player, sessionId === this.sessionId);
        this.avatars.set(sessionId, avatar);
      }
      avatar.name = player.name;
      avatar.color = player.color;
      avatar.targetX = player.x;
      avatar.targetY = player.y;
      avatar.escaped = player.escaped;
      avatar.container.setAlpha(player.escaped ? 0.45 : 1);
    }

    for (const [sessionId, avatar] of this.avatars) {
      if (players.has(sessionId)) continue;
      avatar.container.destroy(true);
      this.avatars.delete(sessionId);
    }
  }

  private createAvatar(player: PlayerView, local: boolean): Avatar {
    const container = this.add.container(player.x, player.y).setDepth(30);
    const halo = this.add.circle(0, 0, local ? 18 : 16, player.color, local ? 0.14 : 0.08);
    const shadow = this.add.ellipse(0, 13, 25, 10, 0x02030a, 0.55);
    const body = this.add.circle(0, 0, 10, player.color, 1).setStrokeStyle(2, local ? 0xffe9b7 : 0xc9e7ee, 0.95);
    const face = this.add.circle(0, -2, 3.4, 0x1a1925, 0.82);
    const name = this.add.text(0, 17, local ? `${player.name} · YOU` : player.name, {
      fontFamily: "Arial, sans-serif",
      fontSize: local ? "8px" : "8px",
      color: local ? "#f2d9a5" : "#d9eef0",
      fontStyle: "bold",
      letterSpacing: 0.7,
      backgroundColor: "#0a0d19cc",
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5, 0);
    container.add([halo, shadow, body, face, name]);
    const avatar: Avatar = {
      container,
      name: player.name,
      color: player.color,
      targetX: player.x,
      targetY: player.y,
      escaped: player.escaped,
    };
    this.tweens.add({ targets: halo, alpha: { from: 0.12, to: 0.28 }, duration: 1000, yoyo: true, repeat: -1 });
    return avatar;
  }

  private syncSearchables(): void {
    for (const [id, marker] of this.markers) {
      const found = this.room.state.interactables.get(id)?.found ?? false;
      const isExit = id === EXIT.id;
      const unlocked = isExit && this.room.state.exitUnlocked;
      marker.glow.setVisible(!found || unlocked);
      marker.icon.setAlpha(found && !unlocked ? 0.25 : 1);
      marker.label.setAlpha(found && !unlocked ? 0.42 : 1);
      if (unlocked) marker.label.setText("EXIT · UNLOCKED");
      else if (isExit) marker.label.setText("EMERGENCY EXIT");
    }
  }

  private updateMovement(time: number): void {
    const isPlaying = this.room.state.phase === "playing";
    const input = {
      up: isPlaying && (this.cursors.up.isDown || this.keyW.isDown || this.touchInput.has("up")),
      down: isPlaying && (this.cursors.down.isDown || this.keyS.isDown || this.touchInput.has("down")),
      left: isPlaying && (this.cursors.left.isDown || this.keyA.isDown || this.touchInput.has("left")),
      right: isPlaying && (this.cursors.right.isDown || this.keyD.isDown || this.touchInput.has("right")),
    };
    const signature = `${Number(input.up)}${Number(input.down)}${Number(input.left)}${Number(input.right)}`;
    if (signature !== this.lastInput || (signature !== "0000" && time - this.lastSentAt > 75)) {
      this.room.send("move", input);
      this.lastInput = signature;
      this.lastSentAt = time;
    }

    for (const avatar of this.avatars.values()) {
      avatar.container.x = Phaser.Math.Linear(avatar.container.x, avatar.targetX, 0.44);
      avatar.container.y = Phaser.Math.Linear(avatar.container.y, avatar.targetY, 0.44);
    }
  }

  private updateNearbyTarget(): void {
    const player = this.room.state.players.get(this.sessionId);
    if (!player || player.escaped || this.room.state.phase !== "playing") {
      this.setNearby(null);
      return;
    }

    let closest: NearbyTarget | null = null;
    let closestDistance = INTERACTION_RADIUS;
    for (const object of SEARCHABLE_OBJECTS) {
      if (this.room.state.interactables.get(object.id)?.found) continue;
      const objectDistance = Phaser.Math.Distance.Between(player.x, player.y, object.x, object.y);
      if (objectDistance < closestDistance) {
        closestDistance = objectDistance;
        closest = {
          id: object.id,
          label: object.label,
          verb: object.kind === "key" ? "SEARCH" : "SEARCH",
        };
      }
    }

    const exitDistance = Phaser.Math.Distance.Between(player.x, player.y, EXIT.x, EXIT.y);
    if (exitDistance < closestDistance) {
      closest = {
        id: EXIT.id,
        label: this.room.state.exitUnlocked ? "Emergency Exit" : "Emergency Exit",
        verb: this.room.state.exitUnlocked ? "ESCAPE" : "TRY EXIT",
      };
    }
    this.setNearby(closest);
  }

  private setNearby(target: NearbyTarget | null): void {
    if (target?.id === this.nearbyTarget?.id) return;
    this.nearbyTarget = target;
    this.nearbyTargetChanged?.(target);
  }
}
