import { boundingRect, rectContains, roomCells, roomContains, roomParts, roomTileKind } from './rect.ts'
import { makeLink, sameLink } from './links.ts'
import { parseCellKey } from './tiles.ts'
import type { CellRect, Link, Opening, Room } from './types.ts'

const STEPS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/** Rooms can only merge when they overlap or sit side by side. */
export function roomsTouch(a: Room, b: Room): boolean {
  for (const cell of roomCells(a)) {
    if (roomContains(b, cell.x, cell.y)) return true
    for (const [dx, dy] of STEPS) {
      if (roomContains(b, cell.x + dx, cell.y + dy)) return true
    }
  }
  return false
}

/**
 * `other` folded into `keep`: one room covering both shapes, under `keep`'s
 * name, height, visibility and look. Doorways and erased walls in the walls
 * that divided them go with those walls; everything else carries over.
 */
export function mergeRooms(keep: Room, other: Room): Room {
  const parts: CellRect[] = [...roomParts(keep), ...roomParts(other)]
  const shape: Room = { ...keep, rect: boundingRect(parts), parts }

  const openings: Record<string, Opening> = {}
  const openingOpen: Record<string, boolean> = {}
  // The kept room wins a cell both rooms changed.
  for (const source of [other, keep]) {
    for (const [key, opening] of Object.entries(source.openings)) {
      const { x, y } = parseCellKey(key)
      if (!roomContains(source, x, y)) continue
      const dissolved =
        opening !== 'wall' &&
        roomTileKind(source, x, y) === 'wall' &&
        roomTileKind(shape, x, y) === 'floor'
      if (dissolved) {
        delete openings[key]
        delete openingOpen[key]
        continue
      }
      openings[key] = opening
      if (source.openingOpen?.[key] !== undefined) openingOpen[key] = source.openingOpen[key]
      else delete openingOpen[key]
    }
  }

  return {
    ...shape,
    openings,
    openingOpen,
    stairs: [...keep.stairs, ...other.stairs],
  }
}

/**
 * A merged room back into one room per part. The first keeps the room's id and
 * name; the rest take the ids and names given. Each change to a tile goes to
 * the first part covering it.
 */
export function splitRoom(room: Room, pieces: readonly { id: string; name: string }[]): Room[] {
  const parts = roomParts(room)
  return parts.map((part, index) => {
    const owns = (x: number, y: number) =>
      rectContains(part, x, y) && parts.findIndex((item) => rectContains(item, x, y)) === index
    const openings: Record<string, Opening> = {}
    const openingOpen: Record<string, boolean> = {}
    for (const [key, opening] of Object.entries(room.openings)) {
      const { x, y } = parseCellKey(key)
      if (!owns(x, y)) continue
      openings[key] = opening
      const open = room.openingOpen?.[key]
      if (open !== undefined) openingOpen[key] = open
    }
    const piece = index === 0 ? { id: room.id, name: room.name } : pieces[index - 1]
    const { parts: _parts, ...rest } = room
    return {
      ...rest,
      id: piece?.id ?? `${room.id}-${index}`,
      name: piece?.name ?? room.name,
      rect: part,
      openings,
      openingOpen,
      stairs: room.stairs.filter((block) => owns(block.rect.minX, block.rect.minY)),
    }
  })
}

/** Links that pointed at `from` point at `to`; ones left joining a room to itself go. */
export function redirectLinks(links: readonly Link[], from: string, to: string): Link[] {
  const result: Link[] = []
  for (const link of links) {
    const a = link.a === from ? to : link.a
    const b = link.b === from ? to : link.b
    if (a === b) continue
    const next = makeLink(a, b)
    if (!result.some((item) => sameLink(item, next))) result.push(next)
  }
  return result
}

