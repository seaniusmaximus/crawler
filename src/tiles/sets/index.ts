import type { Tileset } from '../tileset.ts'
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
