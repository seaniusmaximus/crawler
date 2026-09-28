import { rectContains, topmostRoomAt, translateRect } from './rect.ts'
import type { Cell, CellRect, Edge, ElevationRamp, Room } from './types.ts'

export interface RampDraft {
  erase: boolean
  rect: CellRect
  ramp: Omit<ElevationRamp, 'id'> | null
}

export interface RampSlice {
  x: number
  y: number
  elevation: number
  prevElev: number
  slice: number
  rampId: string
  up: Edge
}

export function edgeDelta(edge: Edge): { dx: number; dy: number } {
  switch (edge) {
    case 'left':
      return { dx: -1, dy: 0 }
    case 'right':
      return { dx: 1, dy: 0 }
    case 'top':
      return { dx: 0, dy: -1 }
    case 'bottom':
      return { dx: 0, dy: 1 }
  }
}

export function oppositeEdge(edge: Edge): Edge {
  switch (edge) {
    case 'left':
      return 'right'
    case 'right':
      return 'left'
    case 'top':
      return 'bottom'
    case 'bottom':
      return 'top'
  }
}

export function rampAt(
  ramps: readonly ElevationRamp[],
  x: number,
  y: number,
): ElevationRamp | undefined {
  for (let i = ramps.length - 1; i >= 0; i--) {
    const ramp = ramps[i]
    if (ramp && rectContains(ramp.rect, x, y)) return ramp
  }
  return undefined
}

/**
 * Drag from one room toward another. Length is at least the elevation gap so
 * each jump gets a tread; a longer drag stretches the same rise into a gentler
 * run. Width follows the cross-axis of the drag.
 */
export function rampFromDrag(
  start: Cell,
  end: Cell,
  startElev: number,
  endElev: number,
): Omit<ElevationRamp, 'id'> | null {
  if (startElev === endElev) return null
  const rise = Math.abs(endElev - startElev)
  const dragDx = end.x - start.x
  const dragDy = end.y - start.y
  const horizontal = Math.abs(dragDx) >= Math.abs(dragDy)
  const low = startElev < endElev ? start : end
  const high = startElev < endElev ? end : start
  const fromElev = Math.min(startElev, endElev)
  const toElev = Math.max(startElev, endElev)

  if (horizontal) {
    const towardHigh =
      Math.sign(high.x - low.x) ||
      (startElev < endElev ? Math.sign(dragDx) || 1 : -(Math.sign(dragDx) || 1))
    const length = Math.max(rise, Math.abs(dragDx) + 1)
    const minY = Math.min(start.y, end.y)
    const maxY = Math.max(start.y, end.y)
    const minX = towardHigh >= 0 ? low.x : low.x - length + 1
    const maxX = towardHigh >= 0 ? low.x + length - 1 : low.x
    return {
      rect: { minX, minY, maxX, maxY },
      up: towardHigh >= 0 ? 'right' : 'left',
      fromElev,
      toElev,
    }
  }

  const towardHigh =
    Math.sign(high.y - low.y) ||
    (startElev < endElev ? Math.sign(dragDy) || 1 : -(Math.sign(dragDy) || 1))
  const length = Math.max(rise, Math.abs(dragDy) + 1)
  const minX = Math.min(start.x, end.x)
  const maxX = Math.max(start.x, end.x)
  const minY = towardHigh >= 0 ? low.y : low.y - length + 1
  const maxY = towardHigh >= 0 ? low.y + length - 1 : low.y
  return {
    rect: { minX, minY, maxX, maxY },
    up: towardHigh >= 0 ? 'bottom' : 'top',
    fromElev,
    toElev,
  }
}

export function shiftRamp(ramp: ElevationRamp, dx: number, dy: number): ElevationRamp {
  if (dx === 0 && dy === 0) return ramp
  return { ...ramp, rect: translateRect(ramp.rect, dx, dy) }
}

export function runLength(ramp: Pick<ElevationRamp, 'rect' | 'up'>): number {
  return ramp.up === 'left' || ramp.up === 'right'
    ? ramp.rect.maxX - ramp.rect.minX + 1
    : ramp.rect.maxY - ramp.rect.minY + 1
}

function sliceIndex(ramp: Pick<ElevationRamp, 'rect' | 'up'>, x: number, y: number): number {
  switch (ramp.up) {
    case 'right':
      return x - ramp.rect.minX
    case 'left':
      return ramp.rect.maxX - x
    case 'bottom':
      return y - ramp.rect.minY
    case 'top':
      return ramp.rect.maxY - y
  }
}

function sliceElevation(fromElev: number, toElev: number, slice: number, length: number): number {
  if (length <= 0) return toElev
  return fromElev + Math.round(((slice + 1) / length) * (toElev - fromElev))
}

/** Prefer the rooms currently sitting on each end so later raise/lower stays honest. */
export function resolveRamp(
  ramp: ElevationRamp,
  rooms: readonly Room[],
): ElevationRamp | null {
  const down = downhillCell(ramp)
  const upCell = uphillCell(ramp)
  const downRoom = topmostRoomAt(rooms, down.x, down.y)
  const upRoom = topmostRoomAt(rooms, upCell.x, upCell.y)
  let fromElev = downRoom?.elevation ?? ramp.fromElev
  let toElev = upRoom?.elevation ?? ramp.toElev
  let up = ramp.up
  if (fromElev > toElev) {
    const swap = fromElev
    fromElev = toElev
    toElev = swap
    up = oppositeEdge(up)
  }
  if (fromElev === toElev) return null
  return { ...ramp, fromElev, toElev, up }
}

export function rampSlices(ramp: ElevationRamp, rooms: readonly Room[]): RampSlice[] {
  const resolved = resolveRamp(ramp, rooms)
  if (!resolved) return []
  const length = runLength(resolved)
  const slices: RampSlice[] = []
  const rect = resolved.rect
  for (let y = rect.minY; y <= rect.maxY; y++) {
    for (let x = rect.minX; x <= rect.maxX; x++) {
      const slice = sliceIndex(resolved, x, y)
      const elevation = sliceElevation(resolved.fromElev, resolved.toElev, slice, length)
      const prevElev =
        slice === 0
          ? resolved.fromElev
          : sliceElevation(resolved.fromElev, resolved.toElev, slice - 1, length)
      slices.push({
        x,
        y,
        elevation,
        prevElev,
        slice,
        rampId: resolved.id,
        up: resolved.up,
      })
    }
  }
  return slices
}

export function allRampSlices(
  ramps: readonly ElevationRamp[],
  rooms: readonly Room[],
): RampSlice[] {
  return ramps.flatMap((ramp) => rampSlices(ramp, rooms))
}

export function rampOccupancy(
  ramps: readonly ElevationRamp[],
  rooms: readonly Room[],
): Map<string, RampSlice> {
  const cells = new Map<string, RampSlice>()
  for (const slice of allRampSlices(ramps, rooms)) {
    cells.set(`${slice.x},${slice.y}`, slice)
  }
  return cells
}

function downhillCell(ramp: Pick<ElevationRamp, 'rect' | 'up'>): Cell {
  const rect = ramp.rect
  switch (ramp.up) {
    case 'right':
      return { x: rect.minX, y: rect.minY }
    case 'left':
      return { x: rect.maxX, y: rect.minY }
    case 'bottom':
      return { x: rect.minX, y: rect.minY }
    case 'top':
      return { x: rect.minX, y: rect.maxY }
  }
}

function uphillCell(ramp: Pick<ElevationRamp, 'rect' | 'up'>): Cell {
  const rect = ramp.rect
  switch (ramp.up) {
    case 'right':
      return { x: rect.maxX, y: rect.minY }
    case 'left':
      return { x: rect.minX, y: rect.minY }
    case 'bottom':
      return { x: rect.minX, y: rect.maxY }
    case 'top':
      return { x: rect.minX, y: rect.minY }
  }
}
