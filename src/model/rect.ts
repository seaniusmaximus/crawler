import type { Cell, CellRect, Edge, Room, TileKind } from './types.ts'

export function normalizeRect(x0: number, y0: number, x1: number, y1: number): CellRect {
  return {
    minX: Math.min(x0, x1),
    minY: Math.min(y0, y1),
    maxX: Math.max(x0, x1),
    maxY: Math.max(y0, y1),
  }
}

export function rectWidth(rect: CellRect): number {
  return rect.maxX - rect.minX + 1
}

export function rectHeight(rect: CellRect): number {
  return rect.maxY - rect.minY + 1
}

export function rectContains(rect: CellRect, x: number, y: number): boolean {
  return x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY
}

export function translateRect(rect: CellRect, dx: number, dy: number): CellRect {
  return {
    minX: rect.minX + dx,
    minY: rect.minY + dy,
    maxX: rect.maxX + dx,
    maxY: rect.maxY + dy,
  }
}

/** Drags one edge to the pointer cell; the opposite edge pins, so size never drops below 1. */
export function resizeRect(rect: CellRect, edge: Edge, x: number, y: number): CellRect {
  switch (edge) {
    case 'left':
      return { ...rect, minX: Math.min(x, rect.maxX) }
    case 'right':
      return { ...rect, maxX: Math.max(x, rect.minX) }
    case 'top':
      return { ...rect, minY: Math.min(y, rect.maxY) }
    case 'bottom':
      return { ...rect, maxY: Math.max(y, rect.minY) }
  }
}

/**
 * Walls need an inside to enclose. A room only grows a wall ring once it is at
 * least 3x3; thinner shapes (1xN strips, 2-wide corridors) stay all floor so
 * walls never swallow the whole room. Rooms are independent, so a neighbouring
 * room never changes this.
 */
export function hasWalls(rect: CellRect): boolean {
  return rectWidth(rect) >= 3 && rectHeight(rect) >= 3
}

/** The floor area inside a room's wall ring, or the whole rect when it has none. */
export function interiorRect(rect: CellRect): CellRect {
  if (!hasWalls(rect)) return rect
  return { minX: rect.minX + 1, minY: rect.minY + 1, maxX: rect.maxX - 1, maxY: rect.maxY - 1 }
}

export function intersectRect(a: CellRect, b: CellRect): CellRect | null {
  const rect = {
    minX: Math.max(a.minX, b.minX),
    minY: Math.max(a.minY, b.minY),
    maxX: Math.min(a.maxX, b.maxX),
    maxY: Math.min(a.maxY, b.maxY),
  }
  return rect.minX > rect.maxX || rect.minY > rect.maxY ? null : rect
}

export function rectsOverlap(a: CellRect, b: CellRect): boolean {
  return intersectRect(a, b) !== null
}

export function sameRect(a: CellRect, b: CellRect): boolean {
  return a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY
}

export function tileKindIn(rect: CellRect, x: number, y: number): TileKind {
  if (!hasWalls(rect)) return 'floor'
  const onEdge = x === rect.minX || x === rect.maxX || y === rect.minY || y === rect.maxY
  return onEdge ? 'wall' : 'floor'
}

export function topmostRoomAt(rooms: readonly Room[], x: number, y: number): Room | undefined {
  for (let i = rooms.length - 1; i >= 0; i--) {
    const room = rooms[i]
    if (room && roomContains(room, x, y)) return room
  }
  return undefined
}

/** The smallest rect around all of `rects`. */
export function boundingRect(rects: readonly CellRect[]): CellRect {
  return {
    minX: Math.min(...rects.map((rect) => rect.minX)),
    minY: Math.min(...rects.map((rect) => rect.minY)),
    maxX: Math.max(...rects.map((rect) => rect.maxX)),
    maxY: Math.max(...rects.map((rect) => rect.maxY)),
  }
}

/** The rectangles a room is made of: its own, or each one merged into it. */
export function roomParts(room: Room): readonly CellRect[] {
  return room.parts ?? [room.rect]
}

export function isMerged(room: Room): boolean {
  return room.parts !== undefined
}

export function roomContains(room: Room, x: number, y: number): boolean {
  if (!rectContains(room.rect, x, y)) return false
  if (!room.parts) return true
  return room.parts.some((part) => rectContains(part, x, y))
}

/** All eight neighbours: an outline wall is one with outside anywhere around it. */
const RING: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

/**
 * The room's own geometry at a cell it covers. A merged room keeps only the
 * outline of the whole shape as wall: the walls that used to divide its parts
 * open up into floor, so the parts read as one room.
 */
export function roomTileKind(room: Room, x: number, y: number): TileKind {
  if (!room.parts) return tileKindIn(room.rect, x, y)
  let wall = false
  for (const part of room.parts) {
    if (!rectContains(part, x, y)) continue
    if (tileKindIn(part, x, y) === 'floor') return 'floor'
    wall = true
  }
  if (!wall) return 'floor'
  for (const [dx, dy] of RING) {
    if (!roomContains(room, x + dx, y + dy)) return 'wall'
  }
  return 'floor'
}

/**
 * Where floor can be inside the room. A plain room leaves out its wall ring; a
 * merged one is irregular, so callers check each cell of its bounds.
 */
export function roomFloorBounds(room: Room): CellRect {
  return room.parts ? room.rect : interiorRect(room.rect)
}

/** Every cell of `room`, each once even where its parts overlap. */
export function roomCells(room: Room): Cell[] {
  const cells: Cell[] = []
  const rect = room.rect
  for (let y = rect.minY; y <= rect.maxY; y++) {
    for (let x = rect.minX; x <= rect.maxX; x++) {
      if (roomContains(room, x, y)) cells.push({ x, y })
    }
  }
  return cells
}
