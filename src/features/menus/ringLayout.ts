/** Every control on the ring is a circle this wide. */
export const RING_CONTROL = 68
/** Clear space kept between neighbouring controls. */
export const RING_GAP = 20
/** Box for menus that open as a card rather than a ring (statuses, pulling a token). */
export const CARD_FRAME = 260

export type Spot = { x: number; y: number }

export interface RingLayout {
  /** Distance from the middle to each control's centre; the dashed guide is drawn at it. */
  radius: number
  /** Side of the square box the ring needs. */
  size: number
  /** Where each control sits, from the middle, in order. */
  seats: Spot[]
}

function spot(degrees: number, radius: number): Spot {
  const radians = ((degrees - 90) * Math.PI) / 180
  return {
    x: Math.round(Math.cos(radians) * radius),
    y: Math.round(Math.sin(radians) * radius),
  }
}

/**
 * `count` evenly spaced seats, clockwise from twelve o'clock (or from `start`
 * degrees), on a ring just wide enough to keep RING_GAP between neighbouring
 * controls.
 * More options make a wider ring; fewer, a tighter one.
 */
export function ringLayout(count: number, options: { start?: number } = {}): RingLayout {
  const n = Math.max(1, count)
  // Neighbours' centres are a chord apart: 2r·sin(π/n) = control + gap.
  const neighbours = n > 1 ? (RING_CONTROL + RING_GAP) / (2 * Math.sin(Math.PI / n)) : 0
  const radius = Math.ceil(neighbours)
  const start = options.start ?? 0
  return {
    radius,
    size: 2 * radius + RING_CONTROL,
    seats: Array.from({ length: n }, (_, index) => spot(start + (index * 360) / n, radius)),
  }
}
