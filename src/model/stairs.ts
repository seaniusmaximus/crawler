import { floorAtOrder } from './floors.ts'
import { occupantRoom, playerFootprint } from './players.ts'
import { rectsOverlap } from './rect.ts'
import { stairsAt } from './tiles.ts'
import type { Cell, CellRect, Floor, Room, StairsBlock, StairsDir } from './types.ts'

export function linkedFloors(dir: StairsDir): Array<{ delta: number; inverse: StairsDir }> {
  if (dir === 'up') return [{ delta: 1, inverse: 'down' }]
  if (dir === 'down') return [{ delta: -1, inverse: 'up' }]
  return [
    { delta: 1, inverse: 'down' },
    { delta: -1, inverse: 'up' },
  ]
}

/** A staircase on another floor that was the other end of these stairs. */
export interface StairLanding {
  floorId: string
  floorName: string
  roomId: string
  roomName: string
  rect: CellRect
  /** Direction to strip from the landing so it no longer points here. */
  inverse: StairsDir
}

/**
 * Staircases on adjacent floors that overlap this region and still point back
 * at `room`. Used after an erase so leftover landings can be cleaned up.
 */
export function stairLandings(
  floors: readonly Floor[],
  source: Floor,
  room: Room,
  region: CellRect,
): StairLanding[] {
  const found: StairLanding[] = []
  const seen = new Set<string>()

  for (const block of room.stairs) {
    if (!rectsOverlap(block.rect, region)) continue
    for (const link of linkedFloors(block.dir)) {
      const floor = floorAtOrder(floors, source.order + link.delta)
      if (!floor) continue
      for (const other of floor.rooms) {
        for (const twin of other.stairs) {
          if (!rectsOverlap(twin.rect, block.rect)) continue
          if (twin.dir !== link.inverse && twin.dir !== 'both') continue
          const key = `${floor.id}:${other.id}:${twin.rect.minX},${twin.rect.minY},${twin.rect.maxX},${twin.rect.maxY}:${link.inverse}`
          if (seen.has(key)) continue
          seen.add(key)
          found.push({
            floorId: floor.id,
            floorName: floor.name,
            roomId: other.id,
            roomName: other.name,
            rect: twin.rect,
            inverse: link.inverse,
          })
        }
      }
    }
  }
  return found
}

/** Every landing that would go nowhere if `room` and all its stairs vanished. */
export function roomStairLandings(
  floors: readonly Floor[],
  source: Floor,
  room: Room,
): StairLanding[] {
  const found: StairLanding[] = []
  const seen = new Set<string>()
  for (const block of room.stairs) {
    for (const landing of stairLandings(floors, source, room, block.rect)) {
      const key = `${landing.floorId}:${landing.roomId}:${landing.rect.minX},${landing.rect.minY},${landing.rect.maxX},${landing.rect.maxY}:${landing.inverse}`
      if (seen.has(key)) continue
      seen.add(key)
      found.push(landing)
    }
  }
  return found
}

export interface StairExit {
  dir: 'up' | 'down'
  floorId: string
  floorName: string
  roomId: string
  roomName: string
}

export interface StairUsePrompt {
  playerId: string
  x: number
  y: number
  exits: StairExit[]
}

/** Stairs the token landed on, if the move started off a staircase. */
export function stairsEnteredOnPath(
  rooms: readonly Room[],
  cells: readonly Cell[],
  size = 1,
): {
  x: number
  y: number
  room: Room
} | null {
  const start = cells[0]
  const end = cells[cells.length - 1]
  if (!start || !end) return null
  if (stairFoot(rooms, start.x, start.y, size)) return null
  return stairFoot(rooms, end.x, end.y, size)
}

function stairFoot(
  rooms: readonly Room[],
  x: number,
  y: number,
  size: number,
): { x: number; y: number; room: Room } | null {
  for (const foot of playerFootprint(x, y, size)) {
    const room = occupantRoom(rooms, foot.x, foot.y)
    if (room && stairsAt(room, foot.x, foot.y)) return { x: foot.x, y: foot.y, room }
  }
  return null
}

/** Floors a staircase at `x,y` can actually deliver a token to. */
export function stairExits(
  floors: readonly Floor[],
  source: Floor,
  room: Room,
  x: number,
  y: number,
): StairExit[] {
  const block = stairsAt(room, x, y)
  if (!block) return []
  const exits: StairExit[] = []
  for (const link of linkedFloors(block.dir)) {
    const floor = floorAtOrder(floors, source.order + link.delta)
    if (!floor) continue
    const dest =
      floor.rooms.find((other) => {
        const twin = stairsAt(other, x, y)
        return Boolean(twin && (twin.dir === link.inverse || twin.dir === 'both'))
      }) ?? occupantRoom(floor.rooms, x, y)
    if (!dest) continue
    exits.push({
      dir: link.delta > 0 ? 'up' : 'down',
      floorId: floor.id,
      floorName: floor.name,
      roomId: dest.id,
      roomName: dest.name,
    })
  }
  return exits
}

/** Drop the connection that pointed at the erased stairs; a lone leftover vanishes. */
export function stripStairs(
  blocks: readonly StairsBlock[],
  rect: CellRect,
  inverse: StairsDir,
): StairsBlock[] {
  return blocks.flatMap((block) => {
    if (!rectsOverlap(block.rect, rect)) return [block]
    if (block.dir === inverse) return []
    if (block.dir === 'both') {
      return [{ ...block, dir: inverse === 'up' ? 'down' : 'up' }]
    }
    return [block]
  })
}
