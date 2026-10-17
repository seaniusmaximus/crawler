import { FEET_PER_TILE } from './scale.ts'
import { isStandable, occupantRoom, playerFootprint } from './players.ts'
import { openingAt, openingIsOpen } from './tiles.ts'
import type { Cell, ElevationRamp, Room } from './types.ts'

/**
 * Whether a token can pass over a square on its way somewhere: floor it could
 * stand on, or a doorway standing open. Walls, windows and closed doors stop it.
 */
function passable(rooms: readonly Room[], ramps: readonly ElevationRamp[], x: number, y: number): boolean {
  if (isStandable(rooms, x, y, ramps)) return true
  const room = occupantRoom(rooms, x, y)
  return room !== undefined && openingAt(room, x, y) === 'door' && openingIsOpen(room, x, y)
}

const STEPS: readonly Cell[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
]

/**
 * The squares a token could reach with `feet` of movement from where it stands
 * (`start`, its top-left square, `size` a side), going around walls and through
 * open doors. A step costs one square, diagonal or not, as moving does here, or
 * what `cost` says for the square it steps onto (2 in difficult terrain). It
 * returns every square its footprint could cover, its own included.
 */
export function reachableCells(
  rooms: readonly Room[],
  ramps: readonly ElevationRamp[],
  start: Cell,
  size: number,
  feet: number,
  cost?: (cell: Cell) => number,
): Cell[] {
  const budget = Math.floor(feet / FEET_PER_TILE)
  const key = (x: number, y: number) => `${x},${y}`
  const fits = (x: number, y: number) => playerFootprint(x, y, size).every((cell) => passable(rooms, ramps, cell.x, cell.y))
  // Cheapest spend to stand at each square, worked out in rings of equal spend (steps cost 1 or 2).
  const spent = new Map<string, number>([[key(start.x, start.y), 0]])
  const rings: Cell[][] = [[start]]
  const covered = new Map<string, Cell>()
  const cover = (anchor: Cell) => {
    for (const cell of playerFootprint(anchor.x, anchor.y, size)) covered.set(key(cell.x, cell.y), cell)
  }
  for (let used = 0; used <= budget; used++) {
    for (const from of rings[used] ?? []) {
      if (spent.get(key(from.x, from.y)) !== used) continue
      cover(from)
      for (const move of STEPS) {
        const to = { x: from.x + move.x, y: from.y + move.y }
        const total = used + (cost ? cost(to) : 1)
        if (total > budget || total >= (spent.get(key(to.x, to.y)) ?? Infinity) || !fits(to.x, to.y)) continue
        spent.set(key(to.x, to.y), total)
        ;(rings[total] ??= []).push(to)
      }
    }
  }
  return [...covered.values()]
}
