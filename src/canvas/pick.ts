import {
  anchorFromGrid,
  isStandable,
  occupantRoom,
  playerCenter,
  playerHover,
  playerSize,
  playerStatuses,
} from '../model/players.ts'
import { roomContains } from '../model/rect.ts'
import { rampOccupancy } from '../model/ramps.ts'
import { openingSpot } from '../model/openings.ts'
import type { OpeningSpot } from '../model/openings.ts'
import { cellKey } from '../model/tiles.ts'
import type { Camera, ElevationRamp, Player, Room } from '../model/types.ts'
import {
  TILE_HEIGHT,
  TILE_WIDTH,
  cellCenter,
  isoDepth,
  lift,
  roomLift,
  screenToCell,
  screenToCellAt,
  screenToGridAt,
} from './camera.ts'
import type { Point } from './camera.ts'

export function cellOnRoom(sx: number, sy: number, room: Room, camera: Camera): Point {
  return screenToCellAt(sx, sy, camera, room.elevation ?? 0)
}

/**
 * Which room the pointer is on, accounting for raised floors. Higher rooms win
 * when two unlifted cells both contain the click; later rooms still win a tie.
 */
export function hitRoom(
  rooms: readonly Room[],
  sx: number,
  sy: number,
  camera: Camera,
): Room | undefined {
  let best: Room | undefined
  let bestIndex = -1
  rooms.forEach((room, index) => {
    const cell = cellOnRoom(sx, sy, room, camera)
    if (!roomContains(room, cell.x, cell.y)) return
    if (
      !best ||
      room.elevation > best.elevation ||
      (room.elevation === best.elevation && index > bestIndex)
    ) {
      best = room
      bestIndex = index
    }
  })
  return best
}

export function groundCell(sx: number, sy: number, camera: Camera): Point {
  return screenToCell(sx, sy, camera)
}

/**
 * Floor cell under the pointer, using each tile's own elevation so stairs
 * between rooms pick at their steps' height instead of a neighbouring room's deck.
 */
export function pickFloorCell(
  rooms: readonly Room[],
  ramps: readonly ElevationRamp[],
  sx: number,
  sy: number,
  camera: Camera,
): Point | undefined {
  const occupancy = rampOccupancy(ramps, rooms)
  const elevations = new Set<number>()
  for (const room of rooms) elevations.add(room.elevation ?? 0)
  for (const slice of occupancy.values()) elevations.add(slice.stand)

  let best: { x: number; y: number; depth: number; elevation: number } | undefined
  for (const elevation of elevations) {
    const cell = screenToCellAt(sx, sy, camera, elevation)
    const actual = occupancy.get(cellKey(cell.x, cell.y))?.stand ?? occupantRoom(rooms, cell.x, cell.y)?.elevation ?? 0
    if (actual !== elevation) continue
    if (!isStandable(rooms, cell.x, cell.y, ramps)) continue
    const depth = isoDepth(cell.x, cell.y, camera.yaw)
    if (
      !best ||
      depth > best.depth ||
      (depth === best.depth && elevation > best.elevation)
    ) {
      best = { x: cell.x, y: cell.y, depth, elevation }
    }
  }
  return best ? { x: best.x, y: best.y } : undefined
}

/** NW anchor for a token of `size`, snapped to a tile center or a vertex. */
export function pickTokenAnchor(
  rooms: readonly Room[],
  ramps: readonly ElevationRamp[],
  sx: number,
  sy: number,
  camera: Camera,
  size: number,
): { x: number; y: number } | undefined {
  const cell = pickFloorCell(rooms, ramps, sx, sy, camera)
  if (!cell) return undefined
  const elevation = cellElevation(rooms, ramps, cell.x, cell.y)
  const grid = screenToGridAt(sx, sy, camera, elevation)
  return anchorFromGrid(grid.x, grid.y, size)
}

export function tokenEllipse(camera: Camera): { rx: number; ry: number } {
  const standee = tokenStandee(camera)
  return { rx: standee.rx, ry: standee.ry }
}

/** Circular iso base plus an upright cardboard figure. */
export function tokenStandee(camera: Camera, size = 1): {
  rx: number
  ry: number
  width: number
  height: number
  tab: number
  rim: number
} {
  const scale = Math.max(1, size)
  const rx = Math.max(8, TILE_WIDTH * camera.zoom * 0.3 * scale)
  const ry = rx * (TILE_HEIGHT / TILE_WIDTH)
  return {
    rx,
    ry,
    width: rx * 1.48,
    height: rx * 2.85,
    tab: ry * 0.62,
    rim: Math.max(3, ry * 0.38),
  }
}

export function playerTokenCenter(
  player: Player,
  rooms: readonly Room[],
  ramps: readonly ElevationRamp[],
  camera: Camera,
): Point {
  return playerTokenCenterAt(player, player.x, player.y, rooms, ramps, camera)
}

export function playerTokenCenterAt(
  player: Player,
  x: number,
  y: number,
  rooms: readonly Room[],
  ramps: readonly ElevationRamp[],
  camera: Camera,
): Point {
  const size = playerSize(player)
  const mid = playerCenter(x, y, size)
  const floor = cellElevation(rooms, ramps, Math.round(x), Math.round(y))
  return tokenCenter(mid.x, mid.y, floor + playerHover(player), camera)
}

export function playerGroundCenter(
  player: Player,
  rooms: readonly Room[],
  ramps: readonly ElevationRamp[],
  camera: Camera,
): Point {
  return playerGroundCenterAt(player, player.x, player.y, rooms, ramps, camera)
}

export function playerGroundCenterAt(
  player: Player,
  x: number,
  y: number,
  rooms: readonly Room[],
  ramps: readonly ElevationRamp[],
  camera: Camera,
): Point {
  const size = playerSize(player)
  const mid = playerCenter(x, y, size)
  return tokenCenter(mid.x, mid.y, cellElevation(rooms, ramps, Math.round(x), Math.round(y)), camera)
}

export function cellElevation(
  rooms: readonly Room[],
  ramps: readonly ElevationRamp[],
  x: number,
  y: number,
): number {
  const slice = rampOccupancy(ramps, rooms).get(cellKey(x, y))
  if (slice) return slice.stand
  return occupantRoom(rooms, x, y)?.elevation ?? 0
}

export function tokenCenter(
  x: number,
  y: number,
  elevation: number,
  camera: Camera,
): Point {
  return lift(cellCenter(x, y, camera), camera, roomLift(elevation))
}

export function hitToken(
  players: readonly Player[],
  floorId: string,
  rooms: readonly Room[],
  ramps: readonly ElevationRamp[],
  sx: number,
  sy: number,
  camera: Camera,
): Player | undefined {
  let best: Player | undefined
  let bestDepth = -Infinity
  let bestDist = Infinity
  for (const player of players) {
    if (player.floorId !== floorId) continue
    const size = playerSize(player)
    const standee = tokenStandee(camera, size)
    const pos = playerTokenCenter(player, rooms, ramps, camera)
    const dist =
      standeeHit(sx, sy, pos, standee, playerStatuses(player).includes('prone')) ??
      airColumnHit(sx, sy, pos, playerGroundCenter(player, rooms, ramps, camera), standee)
    if (dist === null) continue
    const mid = playerCenter(player.x, player.y, size)
    const depth = isoDepth(mid.x, mid.y, camera.yaw)
    if (depth > bestDepth || (depth === bestDepth && dist < bestDist)) {
      best = player
      bestDepth = depth
      bestDist = dist
    }
  }
  return best
}

export function hitGhostToken(
  player: Player,
  x: number,
  y: number,
  rooms: readonly Room[],
  ramps: readonly ElevationRamp[],
  sx: number,
  sy: number,
  camera: Camera,
): boolean {
  const size = playerSize(player)
  const standee = tokenStandee(camera, size)
  const pos = playerTokenCenterAt(player, x, y, rooms, ramps, camera)
  if (standeeHit(sx, sy, pos, standee, playerStatuses(player).includes('prone')) !== null) return true
  const ground = playerGroundCenterAt(player, x, y, rooms, ramps, camera)
  return airColumnHit(sx, sy, pos, ground, standee) !== null
}

/**
 * The clear column under a raised token belongs to the token, so it can be
 * grabbed or right-clicked from the floor. Mirrors `drawAirColumn`. Scores
 * behind the figure itself so an overlapping standee still wins a tie.
 */
function airColumnHit(
  sx: number,
  sy: number,
  pos: Point,
  ground: Point,
  standee: ReturnType<typeof tokenStandee>,
): number | null {
  if (ground.y - pos.y < 1.5) return null
  const dx = (sx - pos.x) / standee.rx
  if (dx * dx > 1) return null
  if (sy >= pos.y && sy <= ground.y) return 2 + dx * dx
  const dyFoot = (sy - ground.y) / standee.ry
  if (dx * dx + dyFoot * dyFoot <= 1) return 2 + dx * dx + dyFoot * dyFoot
  return null
}

function standeeHit(
  sx: number,
  sy: number,
  pos: Point,
  standee: ReturnType<typeof tokenStandee>,
  prone = false,
): number | null {
  const dx = (sx - pos.x) / standee.rx
  const dyTop = (sy - pos.y) / standee.ry
  const top = dx * dx + dyTop * dyTop
  if (top <= 1) return top
  const dyBot = (sy - (pos.y + standee.rim)) / standee.ry
  if (dx * dx + dyBot * dyBot <= 1) return dx * dx + dyBot * dyBot
  if (sy >= pos.y && sy <= pos.y + standee.rim && dx * dx <= 1) return dx * dx + 0.5

  const plant = pos.y - standee.tab * 0.15
  const left = prone ? pos.x : pos.x - standee.width / 2
  const right = prone ? pos.x + standee.height : pos.x + standee.width / 2
  const figureTop = prone ? plant - standee.width / 2 : pos.y - standee.height + standee.tab
  const figureBottom = prone ? plant + standee.width / 2 : pos.y + standee.tab * 0.15
  if (sx < left || sx > right || sy < figureTop || sy > figureBottom) return null
  const cx = (sx - (left + right) / 2) / Math.max(1, (right - left) / 2)
  const cy = (sy - (figureTop + figureBottom) / 2) / Math.max(1, (figureBottom - figureTop) / 2)
  return 1 + cx * cx + cy * cy
}

export function hitOpening(
  rooms: readonly Room[],
  sx: number,
  sy: number,
  camera: Camera,
): OpeningSpot | undefined {
  const room = hitRoom(rooms, sx, sy, camera)
  if (!room) return undefined
  const cell = cellOnRoom(sx, sy, room, camera)
  return openingSpot(room, cell.x, cell.y)
}
