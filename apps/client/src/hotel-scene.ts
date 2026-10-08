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
    cluesFound: number;
    deductionSolved: boolean;
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

interface SearchableMarker {
  glow: Phaser.GameObjects.Arc;
  ring: Phaser.GameObjects.Arc;
  icon: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  color: number;
  baseLabel: string;
}

export interface NearbyTarget {
  id: string;
  label: string;
  verb: string;
}

const FLOOR_COLORS = {
  lobby: 0x28232a,
  guest: 0x1b252b,
  security: 0x242522,
  hallway: 0x1d2829,
  exit: 0x182729,
};

export class HotelScene extends Phaser.Scene {
  private room: SceneRoom;
  private readonly sessionId: string;
  private readonly avatars = new Map<string, Avatar>();
  private readonly touchInput = new Set<string>();
  private readonly markers = new Map<string, SearchableMarker>();
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private lastInput = "";
  private lastSentAt = 0;
  private nearbyTarget: NearbyTarget | null = null;
  private nearbyTargetChanged: ((target: NearbyTarget | null) => void) | null = null;
  private footstepCallback: (() => void) | null = null;
  private lastFootstepAt = 0;

  constructor(room: SceneRoom, sessionId: string) {
    super({ key: "HotelScene" });
    this.room = room;
    this.sessionId = sessionId;
  }

  create(): void {
    this.drawHotel();
    this.drawLighting();
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

  setFootstepCallback(callback: () => void): void {
    this.footstepCallback = callback;
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
    const graphics = this.add.graphics().setDepth(0);
    graphics.fillStyle(0x080d10, 1);
    graphics.fillRect(0, 0, WORLD.width, WORLD.height);

    for (let y = 24; y < WORLD.height; y += 40) {
      for (let x = 24; x < WORLD.width; x += 40) {
        graphics.fillStyle((x + y) % 3 === 0 ? 0x202a2b : 0x11191c, 0.46);
        graphics.fillCircle(x, y, 1.1);
      }
    }

    graphics.fillStyle(FLOOR_COLORS.lobby, 1);
    graphics.fillRoundedRect(40, 360, 220, 220, 8);
    graphics.fillStyle(FLOOR_COLORS.hallway, 1);
    graphics.fillRoundedRect(180, 294, 820, 110, 4);

    graphics.fillStyle(0x392b2b, 0.84);
    graphics.fillRoundedRect(190, 320, 794, 58, 7);
    graphics.lineStyle(1, 0xc3a36c, 0.48);
    graphics.strokeRoundedRect(194, 324, 786, 50, 5);
    graphics.lineStyle(1, 0xdbc18b, 0.16);
    graphics.lineBetween(200, 330, 974, 330);
    graphics.lineBetween(200, 368, 974, 368);
    for (let x = 218; x < 965; x += 36) {
      graphics.lineStyle(1, 0x120f13, 0.26);
      graphics.lineBetween(x, 333, x, 365);
    }

    const rugColors: Record<string, number> = {
      lobby: 0x35282b,
      "room-101": 0x254047,
      "room-102": 0x3a3046,
      "room-103": 0x493339,
      security: 0x343326,
    };

    for (const room of MAP_ROOMS) {
      const color = room.kind === "lobby" ? FLOOR_COLORS.lobby : room.kind === "security" ? FLOOR_COLORS.security : FLOOR_COLORS.guest;
      graphics.fillStyle(color, 1);
      graphics.fillRoundedRect(room.x, room.y, room.width, room.height, 5);
      graphics.fillStyle(0xc3b282, 0.055);
      for (let x = room.x + 18; x < room.x + room.width - 8; x += 28) {
        graphics.fillRect(x, room.y + 44, 1, room.height - 58);
      }
      for (let y = room.y + 52; y < room.y + room.height - 9; y += 28) {
        graphics.fillRect(room.x + 10, y, room.width - 20, 1);
      }

      graphics.fillStyle(rugColors[room.id] ?? rugColors.lobby, 0.76);
      graphics.fillRoundedRect(room.x + 12, room.y + 50, room.width - 24, room.height - 62, 4);
      graphics.lineStyle(1, 0xd1b777, 0.42);
      graphics.strokeRoundedRect(room.x + 17, room.y + 55, room.width - 34, room.height - 72, 3);
      graphics.lineStyle(1, 0xe5d1a0, 0.11);
      for (let x = room.x + 31; x < room.x + room.width - 25; x += 24) {
        graphics.lineBetween(x, room.y + 60, x, room.y + room.height - 18);
      }

      graphics.lineStyle(5, 0x090e11, 0.94);
      graphics.strokeRoundedRect(room.x, room.y, room.width, room.height, 5);
      graphics.lineStyle(2, 0x9a815b, 0.74);
      graphics.strokeRoundedRect(room.x, room.y, room.width, room.height, 5);
      graphics.lineStyle(1, 0xe0c68b, 0.24);
      graphics.strokeRoundedRect(room.x + 4, room.y + 4, room.width - 8, room.height - 8, 3);
    }

    graphics.fillStyle(FLOOR_COLORS.exit, 1);
    graphics.fillRoundedRect(970, 310, 100, 82, 4);
    graphics.fillStyle(0x27413f, 0.7);
    graphics.fillRoundedRect(978, 316, 84, 70, 3);
    graphics.lineStyle(5, 0x080d10, 0.95);
    graphics.strokeRoundedRect(970, 310, 100, 82, 4);
    graphics.lineStyle(2, 0x91b6a5, 0.7);
    graphics.strokeRoundedRect(970, 310, 100, 82, 4);

    graphics.lineStyle(8, 0x090e11, 0.96);
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

    graphics.lineStyle(2, 0xa88f65, 0.72);
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
      graphics.fillStyle(0xd8bc82, 0.2);
      graphics.fillRect(door.x + 2, door.y + 5, door.width - 4, 5);
      graphics.fillStyle(0x111719, 0.96);
      graphics.fillRoundedRect(door.x + 19, 281, 34, 12, 2);
      graphics.lineStyle(1, 0xb79b66, 0.64);
      graphics.strokeRoundedRect(door.x + 19, 281, 34, 12, 2);
    }

    const labels = [
      { text: "THE LOBBY · RECEPTION", x: 59, y: 379, color: "#e4c98c" },
      { text: "THE MERIDIAN · MAIN HALL", x: 446, y: 328, color: "#c4c6b6" },
      { text: "NORTH EXIT", x: 987, y: 321, color: "#a4d3c2" },
    ];
    for (const label of labels) {
      this.add.text(label.x, label.y, label.text, {
        fontFamily: "Arial, sans-serif",
        fontSize: "9px",
        color: label.color,
        fontStyle: "bold",
        letterSpacing: 1.6,
      }).setDepth(2);
    }

    for (const room of MAP_ROOMS) {
      if (room.kind === "lobby") continue;
      this.add.text(room.x + 13, room.y + 12, room.label, {
        fontFamily: "Georgia, serif",
        fontSize: room.kind === "security" ? "13px" : "19px",
        color: room.kind === "security" ? "#dfc886" : "#e5e1d2",
        fontStyle: "bold",
        letterSpacing: 1.7,
      }).setDepth(2);
      this.add.text(room.x + 14, room.y + 31, room.subtitle, {
        fontFamily: "Arial, sans-serif",
        fontSize: "8px",
        color: "#b2b4a7",
        letterSpacing: 1.25,
      }).setDepth(2);
    }
  }

  private drawLighting(): void {
    const lighting = this.add.graphics().setDepth(1);
    const pools = [
      { x: 118, y: 430, color: 0xd0a15f },
      { x: 292, y: 116, color: 0x79aab0 },
      { x: 490, y: 116, color: 0xa18aba },
      { x: 690, y: 116, color: 0xc48a70 },
      { x: 886, y: 116, color: 0xc4a763 },
      { x: 492, y: 350, color: 0x6ca49a },
      { x: 1025, y: 351, color: 0x79b9a1 },
    ];
    const layers = [
      { radius: 112, alpha: 0.012 },
      { radius: 84, alpha: 0.014 },
      { radius: 58, alpha: 0.017 },
      { radius: 34, alpha: 0.021 },
      { radius: 16, alpha: 0.025 },
    ];

    for (const pool of pools) {
      for (const layer of layers) {
        lighting.fillStyle(pool.color, layer.alpha);
        lighting.fillCircle(pool.x, pool.y, layer.radius);
      }
    }
  }

  private drawDecor(): void {
    const decor = this.add.graphics().setDepth(3);
    decor.fillStyle(0x090f11, 0.88);
    decor.fillRoundedRect(64, 416, 94, 39, 5);
    decor.fillStyle(0x473735, 1);
    decor.fillRoundedRect(70, 417, 82, 31, 4);
    decor.fillStyle(0x92704c, 0.9);
    decor.fillRoundedRect(75, 420, 72, 7, 2);
    decor.fillStyle(0x1a2020, 0.98);
    decor.fillRoundedRect(78, 429, 66, 13, 2);
    decor.lineStyle(1, 0xd4b476, 0.62);
    decor.strokeRoundedRect(70, 417, 82, 35, 4);
    decor.lineBetween(83, 444, 139, 444);

    for (const [x, y] of [[220, 122], [420, 122], [620, 122]] as const) {
      decor.fillStyle(0x090e10, 0.78);
      decor.fillRoundedRect(x - 4, y - 5, 96, 42, 5);
      decor.fillStyle(0x40363a, 1);
      decor.fillRoundedRect(x - 2, y - 2, 91, 36, 4);
      decor.fillStyle(0x201f22, 1);
      decor.fillRoundedRect(x + 3, y + 3, 81, 27, 3);
      decor.fillStyle(0x77706a, 0.95);
      decor.fillRoundedRect(x + 8, y + 4, 27, 9, 3);
      decor.fillRoundedRect(x + 55, y + 4, 27, 9, 3);
      decor.fillStyle(0x76534c, 0.9);
      decor.fillRoundedRect(x + 7, y + 15, 73, 11, 2);
      decor.fillStyle(0xd1b478, 0.22);
      decor.fillRect(x + 9, y + 14, 69, 2);
      decor.lineStyle(1, 0xd0b171, 0.56);
      decor.strokeRoundedRect(x - 5, y - 6, 98, 44, 6);
      decor.fillStyle(0xd8bd80, 0.56);
      decor.fillCircle(x + 9, y + 32, 1.4);
      decor.fillCircle(x + 79, y + 32, 1.4);
    }

    decor.fillStyle(0x0a0f10, 0.94);
    decor.fillRoundedRect(812, 96, 53, 98, 3);
    decor.fillStyle(0x292a24, 1);
    decor.fillRoundedRect(817, 101, 42, 86, 3);
    decor.fillStyle(0x171c1b, 1);
    decor.fillRoundedRect(822, 107, 32, 73, 2);
    decor.lineStyle(1, 0xc0a36d, 0.88);
    decor.strokeRoundedRect(817, 101, 42, 86, 3);
    for (let drawer = 0; drawer < 3; drawer += 1) {
      decor.lineStyle(1, 0x8f815e, 0.72);
      decor.strokeRoundedRect(823, 109 + drawer * 22, 30, 19, 2);
      decor.fillStyle(0xe2c587, 0.84);
      decor.fillCircle(838, 118 + drawer * 22, 1.7);
    }
    decor.fillStyle(0xd0ac65, 0.78);
    decor.fillCircle(838, 92, 3);
    decor.fillStyle(0x111718, 0.94);
    decor.fillRoundedRect(824, 83, 28, 9, 2);
    decor.lineStyle(1, 0xc7aa72, 0.62);
    decor.strokeRoundedRect(824, 83, 28, 9, 2);

    for (const [x, y] of [[60, 520], [230, 520], [312, 353], [742, 352], [948, 344]] as const) {
      decor.fillStyle(0x101718, 1);
      decor.fillRoundedRect(x, y, 18, 24, 4);
      decor.fillStyle(0x334f43, 0.84);
      decor.fillCircle(x + 9, y + 6, 11);
      decor.fillStyle(0x60735a, 0.82);
      decor.fillCircle(x + 4, y + 13, 7);
      decor.fillCircle(x + 14, y + 13, 7);
      decor.lineStyle(1, 0xb39867, 0.36);
      decor.strokeRoundedRect(x, y, 18, 24, 4);
    }

    decor.fillStyle(0x493b39, 0.82);
    decor.fillRoundedRect(58, 464, 48, 14, 3);
    decor.fillStyle(0xb7915e, 0.9);
    decor.fillCircle(82, 457, 4);
    decor.fillStyle(0xd5b777, 0.36);
    decor.fillCircle(82, 457, 9);
    decor.fillStyle(0x3d3532, 0.72);
    decor.fillRoundedRect(174, 457, 27, 10, 3);
    decor.fillStyle(0xd8bc82, 0.82);
    decor.fillCircle(186, 450, 3);
    decor.fillStyle(0xd5b777, 0.3);
    decor.fillCircle(186, 450, 7);

    for (const x of [292, 490, 690, 890]) {
      decor.fillStyle(0x101516, 0.96);
      decor.fillRoundedRect(x - 8, 230, 16, 19, 3);
      decor.fillStyle(0xd5b777, 0.9);
      decor.fillRoundedRect(x - 4, 233, 8, 5, 2);
      decor.fillStyle(0xe2c783, 0.08);
      decor.fillCircle(x, 238, 19);
      decor.lineStyle(1, 0xb39966, 0.42);
      decor.lineBetween(x - 10, 250, x + 10, 250);
    }

    decor.fillStyle(0x12201e, 0.94);
    decor.fillRoundedRect(1006, 317, 30, 52, 3);
    decor.lineStyle(1, 0x9cc9b0, 0.72);
    decor.strokeRoundedRect(1006, 317, 30, 52, 3);
    decor.lineBetween(1021, 321, 1021, 365);
    decor.fillStyle(0xd4b877, 0.84);
    decor.fillCircle(1028, 344, 1.8);

  }

  private drawSearchables(): void {
    const points = [
      ...SEARCHABLE_OBJECTS.map((object) => ({ id: object.id, label: object.label, x: object.x, y: object.y, kind: object.kind })),
      { id: EXIT.id, label: EXIT.label, x: EXIT.x, y: EXIT.y, kind: "exit" },
    ];

    for (const point of points) {
      const color = point.kind === "key" ? 0xe8bb70 : point.kind === "exit" ? 0x8bc8ae : 0xe0cb96;
      const glow = this.add.circle(point.x, point.y, 31, color, 0.1).setDepth(6);
      const ring = this.add.circle(point.x, point.y, 19, color, 0.08).setStrokeStyle(1.5, color, 0.84).setDepth(7);
      const icon = this.makeObjectIcon(point.kind, color).setPosition(point.x, point.y).setDepth(8);
      const label = this.add.text(point.x, point.y + 22, point.label.toUpperCase(), {
        fontFamily: "Arial, sans-serif",
        fontSize: "8px",
        color: "#f0e8d4",
        fontStyle: "bold",
        letterSpacing: 1.05,
        backgroundColor: "#0c1314e8",
        padding: { x: 6, y: 4 },
      }).setOrigin(0.5, 0).setDepth(8);
      this.markers.set(point.id, { glow, ring, icon, label, color, baseLabel: point.label.toUpperCase() });
      this.tweens.add({ targets: [glow, ring], alpha: { from: 0.38, to: 0.92 }, duration: 1550, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
  }

  private makeObjectIcon(kind: string, color: number): Phaser.GameObjects.Container {
    const icon = this.add.container(0, 0);
    const graphics = this.add.graphics();
    graphics.fillStyle(0x091011, 0.98);
    graphics.fillCircle(0, 0, 13);
    graphics.lineStyle(1.5, color, 0.92);
    graphics.strokeCircle(0, 0, 12);

    if (kind === "clue") {
      graphics.fillStyle(0xd8c99f, 0.98);
      graphics.fillRoundedRect(-6.5, -8.5, 13, 17, 1.5);
      graphics.lineStyle(1, color, 1);
      graphics.strokeRoundedRect(-6.5, -8.5, 13, 17, 1.5);
      graphics.lineStyle(1, 0x5c5240, 0.92);
      graphics.lineBetween(-3.5, -3.5, 3.5, -3.5);
      graphics.lineBetween(-3.5, 0, 3.5, 0);
      graphics.lineBetween(-3.5, 3.5, 1.5, 3.5);
    } else if (kind === "key") {
      graphics.lineStyle(2.4, color, 1);
      graphics.strokeCircle(-3, -3, 4.7);
      graphics.lineBetween(0, 0, 7.5, 7.5);
      graphics.lineBetween(4.8, 4.8, 8, 1.5);
      graphics.lineBetween(6.6, 6.6, 9.8, 3.4);
    } else if (kind === "exit") {
      graphics.fillStyle(0x244136, 1);
      graphics.fillRoundedRect(-6, -9, 12, 18, 1.5);
      graphics.lineStyle(1.4, color, 1);
      graphics.strokeRoundedRect(-6, -9, 12, 18, 1.5);
      graphics.fillCircle(2.8, 0, 1.3);
      graphics.lineStyle(1, color, 0.95);
      graphics.lineBetween(-12, 0, -5, 0);
      graphics.lineBetween(-8, -3.5, -12, 0);
      graphics.lineBetween(-8, 3.5, -12, 0);
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
      const keyLocked = id === "security-cabinet" && !this.room.state.deductionSolved && !found;
      const visible = !found || unlocked;
      marker.glow.setVisible(visible);
      marker.ring.setVisible(visible);
      marker.glow.setAlpha(keyLocked ? 0.4 : 1);
      marker.ring.setAlpha(keyLocked ? 0.52 : 1);
      marker.icon.setAlpha(found && !unlocked ? 0.25 : keyLocked ? 0.65 : 1);
      marker.label.setAlpha(found && !unlocked ? 0.42 : 1);
      const label = unlocked ? "EXIT · UNLOCKED" : isExit ? "EMERGENCY EXIT" : keyLocked ? "SECURITY CABINET · LOCKED" : marker.baseLabel;
      const labelColor = keyLocked ? "#c4ae7c" : "#f0e8d4";
      if (marker.label.text !== label) marker.label.setText(label);
      if (marker.label.style.color !== labelColor) marker.label.setColor(labelColor);
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
    if (signature !== "0000" && time - this.lastFootstepAt >= 340) {
      this.lastFootstepAt = time;
      this.footstepCallback?.();
    }
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
          verb: object.kind === "key" && !this.room.state.deductionSolved ? "LOCKED" : "SEARCH",
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
    if (this.nearbyTarget) {
      const previous = this.markers.get(this.nearbyTarget.id);
      previous?.ring.setScale(1).setStrokeStyle(1.5, previous.color, 0.84);
      previous?.icon.setScale(1);
    }
    if (target) {
      const current = this.markers.get(target.id);
      current?.ring.setScale(1.18).setStrokeStyle(2.2, current.color, 1);
      current?.icon.setScale(1.1);
    }
    this.nearbyTarget = target;
    this.nearbyTargetChanged?.(target);
  }
}
