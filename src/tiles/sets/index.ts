import type { Tileset } from '../tileset.ts'
import type { Dungeon, Room } from '../../model/types.ts'
import { CAVE } from './cave.ts'
import { DUNGEON } from './dungeon.ts'
import { ICE } from './ice.ts'
import { LAVA } from './lava.ts'
import { MANOR } from './manor.ts'

/** Every map look Crawler ships with. */
export const TILESETS: readonly Tileset[] = [DUNGEON, CAVE, MANOR, LAVA, ICE]

export const DEFAULT_TILESET = DUNGEON

/** The tileset with this id; unknown or missing ids fall back to the default. */
export function tilesetById(id: string | undefined): Tileset {
  return TILESETS.find((set) => set.id === id) ?? DEFAULT_TILESET
}

/** The tileset a room is drawn with: its own, or else the map's. */
export function roomTileset(room: Pick<Room, 'tileset'>, mapTileset: string | undefined): Tileset {
  return tilesetById(room.tileset ?? mapTileset)
}

/** Rooms on any floor of the map that would not follow a switch to `id`, keeping their own tileset. */
export function roomsWithOwnTileset(dungeon: Pick<Dungeon, 'floors'>, id: string): number {
  let count = 0
  for (const floor of dungeon.floors) {
    for (const room of floor.rooms) if (room.tileset && tilesetById(room.tileset).id !== id) count++
  }
  return count
}
