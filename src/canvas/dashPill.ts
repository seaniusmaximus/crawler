/**
 * The Dash button beside a token that has used all its movement this turn, for
 * whoever runs it. Laid out here so the map can draw it and tell when it is clicked.
 */
export interface DashPill {
  playerId: string
  x: number
  y: number
  width: number
  height: number
}

const WIDTH = 46
const HEIGHT = 20

/** The pill beside a token, given its base on screen (`x`, `y`) and its base's width out from the middle. */
export function dashPillAt(playerId: string, x: number, y: number, baseRx: number): DashPill {
  return { playerId, x: x + baseRx + 8, y: y - HEIGHT / 2, width: WIDTH, height: HEIGHT }
}

/** The pill under a screen point, if any. */
export function hitDashPill(pills: readonly DashPill[], sx: number, sy: number): DashPill | undefined {
  return pills.find((pill) => sx >= pill.x && sx <= pill.x + pill.width && sy >= pill.y && sy <= pill.y + pill.height)
}
