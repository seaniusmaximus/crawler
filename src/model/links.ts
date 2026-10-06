import { roomContains, roomTileKind } from './rect.ts'
import { openingAt, parseCellKey, wallAxis } from './tiles.ts'
import { sharedWalls, showsWall } from './walls.ts'
import type { Cell, CellRect, Link, Opening, Room } from './types.ts'

const STEPS: readonly Cell[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]

/** A window looks through a wall; only these let people walk through it. */
function isPassage(opening: Opening | undefined): boolean {
  return opening === 'door' || opening === 'open'
}

export function sameLink(a: Link, b: Link): boolean {
  return a.a === b.a && a.b === b.b
}

/** Sorted so a pair has one spelling wherever it is stored or compared. */
export function makeLink(a: string, b: string): Link {
  return a < b ? { a, b } : { a: b, b: a }
}

export function linkedTo(link: Link, roomId: string): string | null {
  if (link.a === roomId) return link.b
  return link.b === roomId ? link.a : null
}

/**
 * The rooms a doorway in `room`'s wall opens onto: whatever has floor on the far
 * side of that wall tile. That is either a neighbour's own floor or the wall it
 * gave up to this room, which is exactly the shared-wall case.
 */
export function roomsThrough(rooms: readonly Room[], room: Room, cell: Cell): Room[] {
  if (!isPassage(openingAt(room, cell.x, cell.y))) return []
  return roomsBeyond(rooms, room, cell)
}

/** The rooms on the far side of a wall tile in `room`, whatever is set in that tile. */
export function roomsBeyond(rooms: readonly Room[], room: Room, cell: Cell): Room[] {
  const shared = sharedWalls(rooms)
  const found: Room[] = []
  for (const step of STEPS) {
    const x = cell.x + step.x
    const y = cell.y + step.y
    // Only the far side counts; the near side is the room's own inside.
    if (roomContains(room, x, y)) continue
    for (const other of rooms) {
      if (other.id === room.id || found.includes(other)) continue
      if (!roomContains(other, x, y)) continue
      const walkable = roomTileKind(other, x, y) === 'floor' || shared.has(other.id, x, y)
      if (walkable) found.push(other)
    }
  }
  return found
}

export interface LinkSpot {
  link: Link
  /** Wall tile for the badge, beside the doorway rather than over it. */
  cell: Cell
}

/**
 * Stored links with somewhere to put their badge. A doorway still prefers the
 * wall beside it; without one the badge sits on the shared wall, or in the gap
 * between rooms when they are not even adjacent.
 */
export function linkSpots(rooms: readonly Room[], links: readonly Link[]): LinkSpot[] {
  const spots: LinkSpot[] = []
  for (const link of links) {
    const a = rooms.find((room) => room.id === link.a)
    const b = rooms.find((room) => room.id === link.b)
    if (!a || !b) continue
    const cell = badgeCell(rooms, a, b) ?? badgeCell(rooms, b, a) ?? betweenCell(a.rect, b.rect)
    spots.push({ link, cell })
  }
  return spots
}

/** Rooms that travel with `roomId`, following stored links from room to room. */
export function linkedGroup(
  rooms: readonly Room[],
  links: readonly Link[],
  roomId: string,
): Set<string> {
  const known = new Set(rooms.map((room) => room.id))
  const group = new Set([roomId])
  const queue = [roomId]
  while (queue.length > 0) {
    const current = queue.pop()
    if (!current) break
    for (const link of links) {
      const other = linkedTo(link, current)
      if (!other || !known.has(other) || group.has(other)) continue
      group.add(other)
      queue.push(other)
    }
  }
  return group
}

/** Doorway tiles in `room` that open onto `partner`. */
function doorways(rooms: readonly Room[], room: Room, partner: Room): Cell[] {
  const cells: Cell[] = []
  for (const key of Object.keys(room.openings)) {
    const cell = parseCellKey(key)
    if (!roomContains(room, cell.x, cell.y)) continue
    if (roomsThrough(rooms, room, cell).some((item) => item.id === partner.id)) cells.push(cell)
  }
  return cells
}

function badgeCell(rooms: readonly Room[], room: Room, partner: Room): Cell | null {
  const cells = doorways(rooms, room, partner)
  if (cells.length === 0) cells.push(...boundaryWalls(rooms, room, partner))
  if (cells.length === 0) return null

  const run = bounds(cells)
  // Which way the doorway runs comes from its wall, since one tile has no shape.
  const first = cells[0] ?? { x: run.minX, y: run.minY }
  // Sit next to the doorway, on either end of it, and never on top of it.
  const candidates: Cell[] =
    wallAxis(room, first.x, first.y) === 'v'
      ? [
          { x: first.x, y: run.maxY + 1 },
          { x: first.x, y: run.minY - 1 },
        ]
      : [
          { x: run.maxX + 1, y: first.y },
          { x: run.minX - 1, y: first.y },
        ]

  const shared = sharedWalls(rooms)
  for (const cell of candidates) {
    if (!roomContains(room, cell.x, cell.y)) continue
    if (roomTileKind(room, cell.x, cell.y) !== 'wall') continue
    if (shared.has(room.id, cell.x, cell.y)) continue
    if (openingAt(room, cell.x, cell.y)) continue
    return cell
  }
  // A doorway filling the whole wall leaves nowhere beside it; ride it instead.
  return { x: run.maxX, y: run.maxY }
}

/** Displayed wall tiles of `room` that sit flush against `partner`. */
function boundaryWalls(rooms: readonly Room[], room: Room, partner: Room): Cell[] {
  const cells: Cell[] = []
  const rect = room.rect
  for (let y = rect.minY; y <= rect.maxY; y++) {
    for (let x = rect.minX; x <= rect.maxX; x++) {
      if (!roomContains(room, x, y) || !showsWall(rooms, room, x, y)) continue
      for (const step of STEPS) {
        const nx = x + step.x
        const ny = y + step.y
        if (roomContains(room, nx, ny)) continue
        if (roomContains(partner, nx, ny)) {
          cells.push({ x, y })
          break
        }
      }
    }
  }
  return cells
}

/** A cell on the shortest line between two rooms, for a badge with no shared wall. */
function betweenCell(a: CellRect, b: CellRect): Cell {
  const ax = clamp((b.minX + b.maxX) / 2, a.minX, a.maxX)
  const ay = clamp((b.minY + b.maxY) / 2, a.minY, a.maxY)
  const bx = clamp((a.minX + a.maxX) / 2, b.minX, b.maxX)
  const by = clamp((a.minY + a.maxY) / 2, b.minY, b.maxY)
  return { x: Math.round((ax + bx) / 2), y: Math.round((ay + by) / 2) }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function bounds(cells: readonly Cell[]): CellRect {
  const xs = cells.map((cell) => cell.x)
  const ys = cells.map((cell) => cell.y)
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
}
