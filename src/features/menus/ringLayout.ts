/** Box the ring is laid out in; the menu anchor sits at its centre. */
export const RING_SIZE = 260
/** Radius of the dashed guide circle the controls sit on. */
export const RING_RADIUS = 80
/** Every control on the ring is a circle this wide. */
export const RING_CONTROL = 68

function spot(degrees: number): { x: number; y: number } {
  const radians = ((degrees - 90) * Math.PI) / 180
  return {
    x: Math.round(Math.cos(radians) * RING_RADIUS),
    y: Math.round(Math.sin(radians) * RING_RADIUS),
  }
}

/** Five evenly spaced seats, clockwise from twelve o'clock, as in the design's token ring. */
export const RING_SPOTS = {
  top: spot(0),
  upperRight: spot(72),
  lowerRight: spot(144),
  lowerLeft: spot(216),
  upperLeft: spot(288),
} as const

/** Six seats, 60° apart clockwise from twelve o'clock, for rings with one more action. */
export const RING_SPOTS_SIX = {
  top: spot(0),
  upperRight: spot(60),
  lowerRight: spot(120),
  bottom: spot(180),
  lowerLeft: spot(240),
  upperLeft: spot(300),
} as const
