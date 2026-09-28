import { rectContains, tileKindIn } from './rect.ts'
import { cellKey, openingAt, tileLooks } from './tiles.ts'
import type { Cell, CellRect, Room } from './types.ts'

export interface SharedWalls {
  /** True when this wall tile defers to a neighbour's wall and reads as floor. */
  has(roomId: string, x: number, y: number): boolean
}

const STEPS: readonly Cell[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]

/** All eight neighbours: a wall reads as broken at its corners too. */
const RING: readonly Cell[] = [
  ...STEPS,
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
]

const NONE: SharedWalls = { has: () => false }

const cache = new WeakMap<readonly Room[], SharedWalls>()

/**
 * Rooms that sit flush against each other should read as sharing one wall, not
 * stacking two. The younger room gives up its side of the boundary and renders
 * floor there, leaving the older room to own the wall.
 *
 * Nothing is stored: this is derived from the current rectangles, so dragging a
 * room away re-grows the wall it had given up, and the rooms stay independent.
 * Memoised per rooms array, which the store replaces on every edit.
 */
export function sharedWalls(rooms: readonly Room[]): SharedWalls {
  if (rooms.length < 2) return NONE
  const known = cache.get(rooms)
  if (known) return known
  const computed = build(rooms)
  cache.set(rooms, computed)
  return computed
}

function build(rooms: readonly Room[]): SharedWalls {
  // Earliest room owning a wall on each cell, plus every cell any room floors.
  const wallOwner = new Map<string, number>()
  const floors = new Set<string>()

  rooms.forEach((room, index) => {
    const rect = room.rect
    for (let y = rect.minY; y <= rect.maxY; y++) {
      for (let x = rect.minX; x <= rect.maxX; x++) {
        const key = cellKey(x, y)
        if (tileKindIn(rect, x, y) === 'floor') {
          floors.add(key)
          continue
        }
        const owner = wallOwner.get(key)
        if (owner === undefined || index < owner) wallOwner.set(key, index)
      }
    }
  })

  const shared = new Map<string, Set<string>>()
  rooms.forEach((room, index) => {
    const rect = room.rect
    for (let y = rect.minY; y <= rect.maxY; y++) {
      for (let x = rect.minX; x <= rect.maxX; x++) {
        if (tileKindIn(rect, x, y) !== 'wall') continue
        if (!defers(room, index, x, y, wallOwner, floors)) continue
        let cells = shared.get(room.id)
        if (!cells) {
          cells = new Set()
          shared.set(room.id, cells)
        }
        cells.add(cellKey(x, y))
      }
    }
  })

  return {
    has: (roomId, x, y) => shared.get(roomId)?.has(cellKey(x, y)) ?? false,
  }
}

function defers(
  room: Room,
  index: number,
  x: number,
  y: number,
  wallOwner: Map<string, number>,
  floors: Set<string>,
): boolean {
  // Never paint floor over a wall an older room already owns on this same cell.
  if (wallOwner.get(cellKey(x, y)) !== index) return false
  // A room always keeps its own corners. They are where its two wall runs meet,
  // so giving one up notches the wall where rooms meet in an L.
  if (isCorner(room.rect, x, y)) return false
  if (!touchesOlderWall(index, x, y, wallOwner)) return false

  // Giving up a wall must not expose the inside. Diagonals count: without them
  // the wall opens up where the neighbour's run ends alongside this one.
  for (const step of RING) {
    const nx = x + step.x
    const ny = y + step.y
    if (rectContains(room.rect, nx, ny)) continue
    const key = cellKey(nx, ny)
    if (!wallOwner.has(key) || floors.has(key)) return false
  }
  return true
}

/** Only a wall an older room already runs alongside is worth giving up. */
function touchesOlderWall(
  index: number,
  x: number,
  y: number,
  wallOwner: Map<string, number>,
): boolean {
  for (const step of STEPS) {
    const owner = wallOwner.get(cellKey(x + step.x, y + step.y))
    if (owner !== undefined && owner < index) return true
  }
  return false
}

function isCorner(rect: CellRect, x: number, y: number): boolean {
  return (x === rect.minX || x === rect.maxX) && (y === rect.minY || y === rect.maxY)
}

/**
 * True when this room currently paints a wall here. Shared-away tiles are floor
 * unless the user has planted an extra wall on top of them.
 */
export function showsWall(rooms: readonly Room[], room: Room, x: number, y: number): boolean {
  if (openingAt(room, x, y) === 'wall') return true
  if (sharedWalls(rooms).has(room.id, x, y)) return false
  return tileLooks(room, x, y) === 'wall'
}
