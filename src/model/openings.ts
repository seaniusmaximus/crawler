import { cellKey, openingAt, parseCellKey, spriteAt } from './tiles.ts'
import { sharedWalls } from './walls.ts'
import type { Cell, Opening, Room } from './types.ts'

export interface OpeningSpot {
  roomId: string
  x: number
  y: number
  kind: Extract<Opening, 'door' | 'window'>
}

const ORTHO: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

export function openingSpot(room: Room, x: number, y: number): OpeningSpot | undefined {
  const kind = openingAt(room, x, y)
  if (kind !== 'door' && kind !== 'window') return undefined
  return { roomId: room.id, x, y, kind }
}

/** Where a cell sits in the door or window it is part of, counted along its wall. */
export interface OpeningGroup {
  index: number
  size: 1 | 2
}

/** The widest door or window that side-by-side cells merge into. */
const MAX_GROUP = 2

/**
 * Doors (or windows) side by side along the same wall merge into one: two
 * make a double door that opens in the middle. A longer run splits into
 * pairs from its low end, with a single one left over if the count is odd.
 */
export function openingGroup(room: Room, x: number, y: number): OpeningGroup {
  const sprite = spriteAt(room, x, y)
  const [dx, dy] = sprite.endsWith('-h') ? [1, 0] : [0, 1]
  let before = 0
  while (spriteAt(room, x - (before + 1) * dx, y - (before + 1) * dy) === sprite) before++
  let after = 0
  while (spriteAt(room, x + (after + 1) * dx, y + (after + 1) * dy) === sprite) after++
  const start = before - (before % MAX_GROUP)
  const size = Math.min(MAX_GROUP, before + after + 1 - start) as OpeningGroup['size']
  return { index: before - start, size }
}

/**
 * Every door or window of the same kind that shares an edge with this one,
 * including across neighbouring rooms, so a double door opens as one leaf.
 */
export function connectedOpenings(
  rooms: readonly Room[],
  roomId: string,
  x: number,
  y: number,
): OpeningSpot[] {
  const start = findOpening(rooms, roomId, x, y)
  if (!start) return []

  const byCell = new Map<string, OpeningSpot[]>()
  for (const item of rooms) {
    for (const [key, opening] of Object.entries(item.openings)) {
      if (opening !== start.kind) continue
      const cell = parseCellKey(key)
      const list = byCell.get(key) ?? []
      list.push({ roomId: item.id, x: cell.x, y: cell.y, kind: opening })
      byCell.set(key, list)
    }
  }

  const seen = new Set<string>()
  const spots: OpeningSpot[] = []
  const queue = [cellKey(x, y)]
  seen.add(cellKey(x, y))
  while (queue.length > 0) {
    const key = queue.pop()
    if (!key) continue
    const here = byCell.get(key)
    if (!here) continue
    spots.push(...here)
    const cell = parseCellKey(key)
    for (const [dx, dy] of ORTHO) {
      const next = cellKey(cell.x + dx, cell.y + dy)
      if (seen.has(next) || !byCell.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return spots
}

/**
 * The door or window at a cell, preferring the one `roomId` holds. A doorway in
 * a shared wall is stored on one room only, so a click from the other side lands here.
 */
export function findOpening(
  rooms: readonly Room[],
  roomId: string,
  x: number,
  y: number,
): OpeningSpot | undefined {
  const own = rooms.find((item) => item.id === roomId)
  const spot = own ? openingSpot(own, x, y) : undefined
  if (spot) return spot
  for (const item of rooms) {
    const found = openingSpot(item, x, y)
    if (found) return found
  }
  return undefined
}

/**
 * The cells a doorway spans. Where two rooms sit flush, the far room's wall
 * tile beside the door gave itself up as floor, so it is part of the way through.
 */
function doorwayCells(rooms: readonly Room[], spots: readonly OpeningSpot[]): Cell[] {
  const shared = sharedWalls(rooms)
  const cells: Cell[] = []
  for (const spot of spots) {
    cells.push({ x: spot.x, y: spot.y })
    for (const [dx, dy] of ORTHO) {
      const x = spot.x + dx
      const y = spot.y + dy
      if (rooms.some((room) => room.id !== spot.roomId && shared.has(room.id, x, y))) cells.push({ x, y })
    }
  }
  return cells
}

/**
 * True when one of `tokens` stands beside any of these doors or windows
 * (diagonals count), close enough to reach the handle from either side.
 */
export function withinReach(
  rooms: readonly Room[],
  tokens: readonly { floorId: string; x: number; y: number; size?: number }[],
  floorId: string,
  spots: readonly OpeningSpot[],
): boolean {
  const cells = doorwayCells(rooms, spots)
  for (const token of tokens) {
    if (token.floorId !== floorId) continue
    const size = Math.max(1, Math.round(token.size ?? 1))
    for (const cell of cells) {
      const dx = Math.max(token.x - cell.x, cell.x - (token.x + size - 1), 0)
      const dy = Math.max(token.y - cell.y, cell.y - (token.y + size - 1), 0)
      if (dx <= 1 && dy <= 1) return true
    }
  }
  return false
}
