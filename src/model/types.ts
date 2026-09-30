import type { Combat } from './combat.ts'
import type { CharacterStats, StatsManual } from './stats.ts'
import type { TokenTravel } from './travel.ts'

export type TileKind = 'floor' | 'wall'

/**
 * A per-tile override. `door` / `window` / `open` punch a geometric wall;
 * `wall` plants a wall on a floor tile. Absent means the room's shape wins.
 */
export type Opening = 'door' | 'window' | 'open' | 'wall'

/** Where a floor tile's stairs lead. */
export type StairsDir = 'up' | 'down' | 'both'

export type TileSprite =
  | 'floor'
  | 'wall'
  | 'door-h'
  | 'door-v'
  | 'window-h'
  | 'window-v'
  | 'stairs'

export type Edge = 'left' | 'right' | 'top' | 'bottom'

export interface Cell {
  x: number
  y: number
}

export interface CellRect {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** One staircase covering a run of floor tiles; the art scales to fit the rect. */
export interface StairsBlock {
  rect: CellRect
  dir: StairsDir
}

/**
 * A visual staircase between rooms on the same floor at different elevations.
 * Distinct from `StairsBlock`, which links dungeon floors.
 */
export interface ElevationRamp {
  id: string
  rect: CellRect
  /** World edge toward increasing elevation. */
  up: Edge
  fromElev: number
  toElev: number
}

export interface Room {
  id: string
  name: string
  rect: CellRect
  /** Keyed by absolute `"x,y"`. */
  openings: Record<string, Opening>
  /**
   * Doors and windows default closed. A true flag means that cell is open;
   * later a spritesheet will swap closed/open art for the same key.
   */
  openingOpen: Record<string, boolean>
  stairs: StairsBlock[]
  /** When false, player view hides this room. The DM always sees it. */
  visible: boolean
  /** Steps above the floor plane; one step is a wall's height. */
  elevation: number
}

/**
 * Two rooms joined by a doorway in the wall they share, so they drag as one.
 * Ids are stored sorted, making the pair its own identity.
 */
export interface Link {
  a: string
  b: string
}

export interface Floor {
  id: string
  name: string
  /** 0 is the ground floor; positive is up, negative is below. */
  order: number
  rooms: Room[]
  links: Link[]
  ramps: ElevationRamp[]
}

export interface Dungeon {
  id: string
  name: string
  floors: Floor[]
  players: Player[]
  combat: Combat
  /** Planned or playing token walk; null when nobody is moving. */
  travel: TokenTravel | null
  /** Id of the tileset every room is drawn with; unknown or missing means the default. */
  tileset?: string
}

/** A character token that stands on a floor tile. */
export interface Player {
  id: string
  /** The person at the table — used later for multi-user sessions. */
  name: string
  /** The figure on the map. */
  characterName: string
  /** PNG data URL of a transparent standee cutout, or null for the default pawn. */
  portrait: string | null
  color: string
  floorId: string
  x: number
  y: number
  /** When false, player view hides this token. The DM always sees it. */
  visible: boolean
  /** Footprint in tiles; 1 is a 5 ft Medium square. */
  size: number
  /** Elevation steps above the floor; 0 is standing on the deck. */
  hover: number
  /** Active condition rings drawn around the base. */
  statuses: string[]
  /** D&D Beyond character id when the extension has seen this sheet. */
  characterId: string | null
  /** Combat line shown under the name. Filled from Beyond when possible. */
  stats: CharacterStats
  /** Fields a player typed by hand; Beyond will not overwrite these. */
  statsManual: StatsManual
  /** Latest initiative check total (d20 + bonus). Null until they roll. */
  initiativeRoll: number | null
  /** Monsters share the token and initiative pool but are DM-owned. */
  kind: 'player' | 'monster'
}

/** Quarter-turns clockwise of a 2:1 iso view. Continuous yaw would stop being isometric. */
export type IsoYaw = 0 | 1 | 2 | 3

export interface Camera {
  x: number
  y: number
  zoom: number
  yaw: IsoYaw
}
