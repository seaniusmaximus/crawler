import { TILE_WIDTH } from '../../canvas/camera.ts'
import type { ObjectDef, ObjectPart } from '../../objects/catalog.ts'
import { MAX_CUSTOM_HEIGHT, MIN_PART_SIZE } from '../../objects/custom.ts'

/**
 * Pure edits on an object's parts for the object editor. Plan coordinates are
 * cells (x across, y deep, +y the front); heights are world pixels.
 */

/** World pixels along one cell's edge, so side views keep the proportions the map draws. */
export const CELL_Z = TILE_WIDTH * Math.SQRT1_2

export type Axis = 'x' | 'y'

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Which edges a plan handle drags: low or high side on each axis, or the radius of a round. */
export type PlanHandle = { x?: 'lo' | 'hi'; y?: 'lo' | 'hi' } | 'radius'

/** Which edge a side-view handle drags. */
export type ElevationHandle = 'lo' | 'hi' | 'top' | 'bottom' | 'topRadius'

export function widestRadius(part: Extract<ObjectPart, { shape: 'round' }>): number {
  return Math.max(part.r, part.r2 ?? part.r)
}

/** The part's outline seen from above. */
export function planRect(part: ObjectPart): Rect {
  if (part.shape === 'round') {
    const r = widestRadius(part)
    return { x0: part.x - r, y0: part.y - r, x1: part.x + r, y1: part.y + r }
  }
  return { x0: part.x, y0: part.y, x1: part.x + part.w, y1: part.y + part.d }
}

export function partBottom(part: ObjectPart): number {
  return part.shape === 'flat' ? 0 : part.z
}

export function partTop(part: ObjectPart): number {
  return part.shape === 'flat' ? 0 : part.z + part.h
}

/** The span a part covers along one plan axis. */
export function axisSpan(part: ObjectPart, axis: Axis): [number, number] {
  const rect = planRect(part)
  return axis === 'x' ? [rect.x0, rect.x1] : [rect.y0, rect.y1]
}

/** The colour seen from above: a box's top, or a rug's field. */
export function topColor(part: ObjectPart): string {
  return part.shape === 'flat' ? part.color : (part.top ?? part.color)
}

export function snap(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Moved by whole amounts; heights never go below the floor. */
export function translate(part: ObjectPart, dx: number, dy: number, dz = 0): ObjectPart {
  const moved = { ...part, x: round2(part.x + dx), y: round2(part.y + dy) }
  if (moved.shape === 'flat' || dz === 0) return moved
  return { ...moved, z: Math.max(0, Math.min(MAX_CUSTOM_HEIGHT - 1, Math.round(moved.z + dz))) }
}

export type Footprint = Pick<ObjectDef, 'w' | 'd'>

/** The largest radius a round centred at (x, y) can have and stay inside the footprint. */
function roomFor(part: Extract<ObjectPart, { shape: 'round' }>, footprint: Footprint): number {
  return Math.max(MIN_PART_SIZE / 2, Math.min(part.x, part.y, footprint.w - part.x, footprint.d - part.y))
}

function clampRadius(part: Extract<ObjectPart, { shape: 'round' }>, r: number, footprint: Footprint): number {
  return round2(Math.max(MIN_PART_SIZE / 2, Math.min(roomFor(part, footprint), r)))
}

/**
 * One edge of a box or rug dragged to `raw` along `axis`, snapped to `step`,
 * held inside the footprint and never narrower than the smallest part. A
 * round's edge sets its radius instead.
 */
function setEdge(part: ObjectPart, axis: Axis, side: 'lo' | 'hi', raw: number, step: number, footprint: Footprint): ObjectPart {
  if (part.shape === 'round') {
    const centre = axis === 'x' ? part.x : part.y
    return { ...part, r: clampRadius(part, snap(Math.abs(raw - centre), step), footprint) }
  }
  const limit = axis === 'x' ? footprint.w : footprint.d
  const at = Math.max(0, Math.min(limit, snap(raw, step)))
  const start = axis === 'x' ? part.x : part.y
  const size = axis === 'x' ? part.w : part.d
  let lo = start
  let hi = start + size
  if (side === 'lo') lo = Math.min(at, hi - MIN_PART_SIZE)
  else hi = Math.max(at, lo + MIN_PART_SIZE)
  return axis === 'x' ? { ...part, x: round2(lo), w: round2(hi - lo) } : { ...part, y: round2(lo), d: round2(hi - lo) }
}

/** A plan handle dragged to the point (px, py), snapped to `step`. */
export function dragPlanHandle(
  part: ObjectPart,
  handle: PlanHandle,
  px: number,
  py: number,
  step: number,
  footprint: Footprint,
): ObjectPart {
  if (handle === 'radius') {
    if (part.shape !== 'round') return part
    return { ...part, r: clampRadius(part, snap(Math.hypot(px - part.x, py - part.y), step), footprint) }
  }
  let next = part
  if (handle.x) next = setEdge(next, 'x', handle.x, px, step, footprint)
  if (handle.y) next = setEdge(next, 'y', handle.y, py, step, footprint)
  return next
}

/** A side-view handle dragged to `along` (cells, on `axis`, snapped to `step`) and `height` (whole pixels). */
export function dragElevationHandle(
  part: ObjectPart,
  axis: Axis,
  handle: ElevationHandle,
  along: number,
  height: number,
  step: number,
  footprint: Footprint,
): ObjectPart {
  if (handle === 'lo' || handle === 'hi') return setEdge(part, axis, handle, along, step, footprint)
  if (part.shape === 'flat') return part
  if (handle === 'topRadius') {
    if (part.shape !== 'round') return part
    const centre = axis === 'x' ? part.x : part.y
    return { ...part, r2: round2(Math.max(0, Math.min(roomFor(part, footprint), snap(Math.abs(along - centre), step)))) }
  }
  const z = Math.round(height)
  if (handle === 'top') return { ...part, h: Math.max(1, Math.min(MAX_CUSTOM_HEIGHT - part.z, z - part.z)) }
  const top = part.z + part.h
  const bottom = Math.max(0, Math.min(top - 1, z))
  return { ...part, z: bottom, h: top - bottom }
}

/** Mirrored across the middle of the footprint on one axis, as a copy for the other side. */
export function mirrored(part: ObjectPart, axis: Axis, footprint: Pick<ObjectDef, 'w' | 'd'>): ObjectPart {
  const size = axis === 'x' ? footprint.w : footprint.d
  if (part.shape === 'round') {
    return axis === 'x' ? { ...part, x: round2(size - part.x) } : { ...part, y: round2(size - part.y) }
  }
  return axis === 'x' ? { ...part, x: round2(size - part.x - part.w) } : { ...part, y: round2(size - part.y - part.d) }
}

/** Slid so its middle sits on the middle of the footprint along one axis. */
export function centred(part: ObjectPart, axis: Axis, footprint: Pick<ObjectDef, 'w' | 'd'>): ObjectPart {
  const [lo, hi] = axisSpan(part, axis)
  const middle = (axis === 'x' ? footprint.w : footprint.d) / 2
  const shift = middle - (lo + hi) / 2
  return axis === 'x' ? translate(part, shift, 0) : translate(part, 0, shift)
}

/**
 * A move of (dx, dy) cut short where it would push any of `parts` out of the
 * footprint, so a group slides up to the edge and stops. Parts already
 * outside (the footprint just shrank) don't hold the others back.
 */
export function clampShift(parts: readonly ObjectPart[], dx: number, dy: number, footprint: Footprint): { dx: number; dy: number } {
  let minX = -Infinity
  let maxX = Infinity
  let minY = -Infinity
  let maxY = Infinity
  for (const part of parts) {
    const rect = planRect(part)
    if (rect.x0 >= 0 && rect.x1 <= footprint.w) {
      minX = Math.max(minX, -rect.x0)
      maxX = Math.min(maxX, footprint.w - rect.x1)
    }
    if (rect.y0 >= 0 && rect.y1 <= footprint.d) {
      minY = Math.max(minY, -rect.y0)
      maxY = Math.min(maxY, footprint.d - rect.y1)
    }
  }
  return { dx: Math.max(minX, Math.min(maxX, dx)), dy: Math.max(minY, Math.min(maxY, dy)) }
}

export function rectsTouch(a: Rect, b: Rect): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1
}

/** What the parts list calls a part. */
export function partName(part: ObjectPart, index: number): string {
  if (part.label) return part.label
  const shape = part.shape === 'box' ? 'Box' : part.shape === 'round' ? (part.r2 === 0 ? 'Cone' : 'Round') : 'Flat'
  return `${shape} ${index + 1}`
}
