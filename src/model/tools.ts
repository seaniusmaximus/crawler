import { interiorRect, intersectRect, rectContains, tileKindIn } from './rect.ts'
import { openingAt, stairsAt } from './tiles.ts'
import { sharedWalls, showsWall } from './walls.ts'
import type { Cell, CellRect, Opening, Room, StairsDir } from './types.ts'

export type Tool = 'select' | 'rooms' | 'doors' | 'windows' | 'stairs' | 'walls' | 'link' | 'ramp'

/** Tools that stamp a feature onto tiles of an existing room. */
export type FeatureTool = Exclude<Tool, 'select' | 'rooms' | 'link' | 'ramp'>

/** A plain door leaf, or an open archway with no leaf at all. */
export type DoorStyle = 'door' | 'open'

/** A drag in progress with a feature tool, and what it would write. */
export interface FeatureDraft {
  roomId: string
  rect: CellRect
  tool: FeatureTool
  erase: boolean
}

export function isFeatureTool(tool: Tool): tool is FeatureTool {
  return tool !== 'select' && tool !== 'rooms' && tool !== 'link' && tool !== 'ramp'
}

export function featureAt(
  rooms: readonly Room[],
  room: Room,
  x: number,
  y: number,
  tool: FeatureTool,
): Opening | StairsDir | undefined {
  if (tool === 'stairs') return stairsAt(room, x, y)?.dir
  if (tool === 'walls') return showsWall(rooms, room, x, y) ? 'wall' : 'open'
  return openingAt(room, x, y)
}

/** What the tool writes right now, given its current option. */
export function pendingFeature(
  tool: FeatureTool,
  doorStyle: DoorStyle,
  stairsDir: StairsDir,
): Opening | StairsDir {
  if (tool === 'stairs') return stairsDir
  if (tool === 'windows') return 'window'
  if (tool === 'walls') return 'wall'
  return doorStyle
}

/**
 * The wall cells a door or window drag changes: those inside both the drag and
 * the room. Sloppy drags that stray into the interior simply contribute nothing,
 * so a run never lands where it cannot. Walls given up to a neighbouring room
 * are floor now, so they are not targets either — the shared wall itself is —
 * unless the user has planted an extra wall on that strip.
 */
export function wallCells(rooms: readonly Room[], room: Room, rect: CellRect): Cell[] {
  const shared = sharedWalls(rooms)
  const cells: Cell[] = []
  for (let y = Math.max(rect.minY, room.rect.minY); y <= Math.min(rect.maxY, room.rect.maxY); y++) {
    for (let x = Math.max(rect.minX, room.rect.minX); x <= Math.min(rect.maxX, room.rect.maxX); x++) {
      if (!rectContains(room.rect, x, y)) continue
      const opening = openingAt(room, x, y)
      if (opening === 'wall') {
        cells.push({ x, y })
        continue
      }
      if (opening === 'door' || opening === 'window') {
        cells.push({ x, y })
        continue
      }
      if (shared.has(room.id, x, y)) continue
      if (tileKindIn(room.rect, x, y) === 'wall') cells.push({ x, y })
    }
  }
  return cells
}

/**
 * Every cell the walls tool would actually change: floors become walls, or
 * walls become floor, matching the drag's erase/add mode. Staircases stay put.
 */
export function wallPaintCells(
  rooms: readonly Room[],
  room: Room,
  rect: CellRect,
  erase: boolean,
): Cell[] {
  const cells: Cell[] = []
  for (let y = Math.max(rect.minY, room.rect.minY); y <= Math.min(rect.maxY, room.rect.maxY); y++) {
    for (let x = Math.max(rect.minX, room.rect.minX); x <= Math.min(rect.maxX, room.rect.maxX); x++) {
      if (!rectContains(room.rect, x, y)) continue
      if (!erase && stairsAt(room, x, y)) continue
      const wall = showsWall(rooms, room, x, y)
      if (erase ? wall : !wall) cells.push({ x, y })
    }
  }
  return cells
}

/**
 * A stairs drag becomes one staircase over the floor area it covers, rather
 * than a stack of single-tile stairs, so the art scales across the whole run.
 */
export function stairsRegion(room: Room, rect: CellRect): CellRect | null {
  return intersectRect(rect, interiorRect(room.rect))
}
