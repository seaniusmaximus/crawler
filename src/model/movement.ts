import { FEET_PER_TILE } from './scale.ts'
import type { Cell } from './types.ts'

function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y
}

export function tokenTrail(origin: Cell, waypoints: readonly Cell[], live: Cell): Cell[] {
  return uniqueTrail([origin, ...waypoints, live])
}

/** Collapse back-to-back duplicates so a live drag does not double-count a pin. */
export function uniqueTrail(cells: readonly Cell[]): Cell[] {
  const trail: Cell[] = []
  for (const cell of cells) {
    const last = trail[trail.length - 1]
    if (!last || !sameCell(last, cell)) trail.push(cell)
  }
  return trail
}

/**
 * Chebyshev steps from a to b: diagonal when both axes change, then the leftover
 * cardinal run. Diagonals are allowed.
 */
export function walkCells(from: Cell, to: Cell): Cell[] {
  const cells: Cell[] = []
  let x = from.x
  let y = from.y
  const sx = Math.sign(to.x - from.x)
  const sy = Math.sign(to.y - from.y)
  while (x !== to.x || y !== to.y) {
    if (x !== to.x) x += sx
    if (y !== to.y) y += sy
    cells.push({ x, y })
  }
  return cells
}

/** Each grid step costs one tile, diagonal or cardinal. */
export function pathFeet(cells: readonly Cell[]): number {
  const trail = uniqueTrail(cells)
  if (trail.length < 2) return 0
  const first = trail[0]
  if (!first) return 0
  let prev = first
  let steps = 0
  for (let i = 1; i < trail.length; i++) {
    const end = trail[i]
    if (!end) continue
    steps += walkCells(prev, end).length
    prev = end
  }
  return steps * FEET_PER_TILE
}
