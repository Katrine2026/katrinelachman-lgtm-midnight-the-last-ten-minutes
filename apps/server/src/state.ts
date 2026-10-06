import { MapSchema, Schema, type } from "@colyseus/schema";

export class PlayerState extends Schema {
  @type("string") name = "Guest";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") color = 0xe6c987;
  @type("boolean") escaped = false;
}

export class InteractableState extends Schema {
  @type("boolean") found = false;
}

export class MidnightState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: InteractableState }) interactables = new MapSchema<InteractableState>();
  @type("string") phase = "lobby";
  @type("string") hostSessionId = "";
  @type("number") remainingSeconds = 600;
  @type("number") cluesFound = 0;
  @type("boolean") keyFound = false;
  @type("boolean") exitUnlocked = false;
}
