import { intersectRect, rectContains, roomContains, roomFloorBounds, roomTileKind } from './rect.ts'
import type { Opening, Room, StairsBlock, TileSprite } from './types.ts'

export function cellKey(x: number, y: number): string {
  return `${x},${y}`
}

export function parseCellKey(key: string): { x: number; y: number } {
  const comma = key.indexOf(',')
  return { x: Number(key.slice(0, comma)), y: Number(key.slice(comma + 1)) }
}

/**
 * Which way a doorway faces. Perimeter tiles follow the room; interior extra
 * walls follow whichever run they sit in, so a painted column of wall reads
 * vertical the way the outer left and right edges do.
 */
export function wallAxis(room: Room, x: number, y: number): 'h' | 'v' {
  const rect = room.rect
  // A merged room's outline bends, so only its neighbours tell which way it runs.
  if (!room.parts && (x === rect.minX || x === rect.maxX)) return 'v'
  if (!room.parts && (y === rect.minY || y === rect.maxY)) return 'h'
  const vertical = solidIn(room, x, y - 1) || solidIn(room, x, y + 1)
  const horizontal = solidIn(room, x - 1, y) || solidIn(room, x + 1, y)
  if (vertical && !horizontal) return 'v'
  return 'h'
}

function solidIn(room: Room, x: number, y: number): boolean {
  if (!roomContains(room, x, y)) return false
  return tileLooks(room, x, y) === 'wall'
}

/** What this cell reads as, ignoring neighbours that stole the wall. */
export function tileLooks(room: Room, x: number, y: number): 'floor' | 'wall' {
  const opening = openingAt(room, x, y)
  if (opening === 'wall') return 'wall'
  if (opening === 'open') return 'floor'
  if (opening === 'door' || opening === 'window') return 'wall'
  return roomTileKind(room, x, y)
}

export function openingAt(room: Room, x: number, y: number): Opening | undefined {
  return room.openings[cellKey(x, y)]
}

/** Archways are always open; doors and windows are closed until toggled. */
export function openingIsOpen(room: Room, x: number, y: number): boolean {
  const opening = openingAt(room, x, y)
  if (opening === 'open') return true
  if (opening !== 'door' && opening !== 'window') return false
  return Boolean(room.openingOpen?.[cellKey(x, y)])
}

/**
 * Staircases clipped to the room's floor area. Shrinking a room hides the part
 * that no longer fits without discarding it, the way openings behave.
 */
export function stairsBlocks(room: Room): StairsBlock[] {
  const interior = roomFloorBounds(room)
  const blocks: StairsBlock[] = []
  for (const block of room.stairs) {
    const clipped = intersectRect(block.rect, interior)
    if (clipped) blocks.push({ rect: clipped, dir: block.dir })
  }
  return blocks
}

export function stairsAt(room: Room, x: number, y: number): StairsBlock | undefined {
  return stairsBlocks(room).find((block) => rectContains(block.rect, x, y))
}

export function spriteAt(room: Room, x: number, y: number): TileSprite {
  const opening = openingAt(room, x, y)
  // Doors and windows win even on extra walls, which live on floor geometry.
  if (opening === 'door' || opening === 'window') return `${opening}-${wallAxis(room, x, y)}`
  if (opening === 'wall') return 'wall'
  if (opening === 'open' || roomTileKind(room, x, y) === 'floor') return 'floor'
  return 'wall'
}
