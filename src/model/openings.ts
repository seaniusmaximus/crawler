import { cellKey, openingAt, parseCellKey } from './tiles.ts'
import type { Opening, Room } from './types.ts'

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
  const room = rooms.find((item) => item.id === roomId)
  const start = room ? openingSpot(room, x, y) : undefined
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
