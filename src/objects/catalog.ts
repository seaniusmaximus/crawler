/**
 * Every object a room can be dressed with. Objects are built from a few solid
 * shapes rather than sprites, so they stand up and turn with the camera like
 * the walls do. See ./parts.ts for how shapes are placed.
 *
 * Tilesets list which objects suit them (see `objects` on a Tileset), but any
 * object can go in any room: the lists only sort the picker.
 */

import { CAMP } from './defs/camp.ts'
import { CLASSIC } from './defs/classic.ts'
import { DRESSING } from './defs/dressing.ts'
import { LIGHTS } from './defs/lights.ts'
import { MANOR_FURNISHINGS } from './defs/manor.ts'
import { TRAPS } from './defs/traps.ts'
import { TREASURE } from './defs/treasure.ts'
import { WILD_DEFS } from './defs/wilds.ts'
import { box, type ObjectDef } from './parts.ts'

export type { ObjectDef, ObjectPart } from './parts.ts'

const DEFS: ObjectDef[] = [...CLASSIC, ...LIGHTS, ...TREASURE, ...TRAPS, ...DRESSING, ...CAMP, ...MANOR_FURNISHINGS, ...WILD_DEFS]

const BY_ID = new Map(DEFS.map((def) => [def.id, def]))

/** Every object, in catalog order. */
export const OBJECTS: readonly ObjectDef[] = DEFS

/** Stands in for an object whose kind is no longer in the catalog, so it can still be seen and removed. */
const UNKNOWN: ObjectDef = {
  id: 'unknown',
  name: 'Unknown object',
  w: 1,
  d: 1,
  parts: [box(0.2, 0.2, 0.6, 0.6, 0, 14, '#6a6d78', '#868995')],
}

/** Prefix on the id of every object a DM made themselves, so it can never take a catalog id. */
export const CUSTOM_PREFIX = 'custom:'

export function isCustomKind(kind: string): boolean {
  return kind.startsWith(CUSTOM_PREFIX)
}

type CustomSource = () => readonly ObjectDef[] | undefined

/** Looks objects up by id in whatever list `source` gives now, re-indexing only when that list changes. */
function customLookup(): { set: (source: CustomSource) => void; get: (kind: string) => ObjectDef | undefined } {
  let source: CustomSource = () => undefined
  let seen: readonly ObjectDef[] | undefined
  let byId = new Map<string, ObjectDef>()
  return {
    set: (next) => {
      source = next
    },
    get: (kind) => {
      const list = source()
      if (list !== seen) {
        seen = list
        byId = new Map((list ?? []).map((def) => [def.id, def]))
      }
      return byId.get(kind)
    },
  }
}

/**
 * Custom objects come from two places: the copies the open map keeps of those
 * placed on it (all a player has), and the DM's own Custom objects collection.
 * Their stores point these here, so `objectDef` finds them without everything
 * that draws or places objects having to be handed either.
 */
const mapCustoms = customLookup()
const libraryCustoms = customLookup()

export const setMapObjectSource = mapCustoms.set
export const setLibraryObjectSource = libraryCustoms.set

/** An object in the DM's Custom objects collection. */
export function libraryObject(kind: string): ObjectDef | undefined {
  return libraryCustoms.get(kind)
}

export function objectDef(kind: string): ObjectDef {
  return BY_ID.get(kind) ?? mapCustoms.get(kind) ?? libraryCustoms.get(kind) ?? UNKNOWN
}

/** True when nothing stands up from it, so things can stand on it (a rug). */
export function isFlatObject(def: ObjectDef): boolean {
  return def.parts.every((part) => part.shape === 'flat')
}
