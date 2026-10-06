export const GAME_TITLE = "MIDNIGHT: THE LAST TEN MINUTES";
export const OBJECTIVE_COPY = "Find the clues.\nFind the key.\nUnlock the emergency exit.\nEscape before midnight.";
export const DEFAULT_GAME_DURATION_SECONDS = 10 * 60;
export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;
export const INTERACTION_RADIUS = 76;

export const WORLD = { width: 1120, height: 640 } as const;
export const SPAWN = { x: 142, y: 470 } as const;

export const WALKABLE_ZONES = [
  { x: 40, y: 360, width: 220, height: 220 },
  { x: 180, y: 294, width: 820, height: 110 },
  { x: 195, y: 75, width: 190, height: 220 },
  { x: 255, y: 276, width: 72, height: 58 },
  { x: 395, y: 75, width: 190, height: 220 },
  { x: 455, y: 276, width: 72, height: 58 },
  { x: 595, y: 75, width: 190, height: 220 },
  { x: 655, y: 276, width: 72, height: 58 },
  { x: 795, y: 75, width: 190, height: 220 },
  { x: 855, y: 276, width: 72, height: 58 },
  { x: 970, y: 310, width: 100, height: 82 },
] as const;

export type SearchableKind = "clue" | "key";

export interface SearchableObject {
  id: string;
  label: string;
  room: string;
  x: number;
  y: number;
  kind: SearchableKind;
  clue?: string;
}

export const SEARCHABLE_OBJECTS: SearchableObject[] = [
  {
    id: "guest-ledger",
    label: "Guest ledger",
    room: "Room 101 · The Blue Suite",
    x: 290,
    y: 165,
    kind: "clue",
    clue: "Guest ledger: The portrait on this floor faces north.",
  },
  {
    id: "dusty-portrait",
    label: "Dusty portrait",
    room: "Room 102 · The Violet Suite",
    x: 490,
    y: 165,
    kind: "clue",
    clue: "Portrait inscription: What the mirror cannot show waits in the east wing.",
  },
  {
    id: "maintenance-note",
    label: "Maintenance notes",
    room: "Room 103 · The Orchid Suite",
    x: 690,
    y: 165,
    kind: "clue",
    clue: "Maintenance note: Three records are needed to release the security key.",
  },
  {
    id: "security-cabinet",
    label: "Security key cabinet",
    room: "Security Room",
    x: 890,
    y: 165,
    kind: "key",
  },
];

export const EXIT = {
  id: "emergency-exit",
  label: "Emergency exit",
  room: "Emergency Exit",
  x: 1035,
  y: 351,
} as const;

export const MAP_ROOMS = [
  { id: "lobby", label: "LOBBY", subtitle: "RECEPTION", x: 40, y: 360, width: 220, height: 220, kind: "lobby" },
  { id: "room-101", label: "101", subtitle: "THE BLUE SUITE", x: 195, y: 75, width: 190, height: 220, kind: "guest" },
  { id: "room-102", label: "102", subtitle: "THE VIOLET SUITE", x: 395, y: 75, width: 190, height: 220, kind: "guest" },
  { id: "room-103", label: "103", subtitle: "THE ORCHID SUITE", x: 595, y: 75, width: 190, height: 220, kind: "guest" },
  { id: "security", label: "SECURITY", subtitle: "STAFF ONLY", x: 795, y: 75, width: 190, height: 220, kind: "security" },
] as const;
