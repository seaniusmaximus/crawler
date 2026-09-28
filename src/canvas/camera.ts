import type { Camera, IsoYaw } from '../model/types.ts'

/** Diamond width and height in world units (2:1 isometric). */
export const TILE_WIDTH = 64
export const TILE_HEIGHT = 32
/** How far a wall cube stands above the floor. */
export const WALL_HEIGHT = 20
/** One room elevation step; +1 sits a room on another room's wall tops. */
export const LEVEL_HEIGHT = WALL_HEIGHT
export const MIN_ELEVATION = -8
export const MAX_ELEVATION = 8

export const MIN_ZOOM = 0.35
export const MAX_ZOOM = 4

export interface Point {
  x: number
  y: number
}

export function wrapYaw(yaw: number): IsoYaw {
  return (((yaw % 4) + 4) % 4) as IsoYaw
}

/**
 * Map a grid point into view space. Yaw 1 turns the map 90° clockwise on
 * screen, so the camera walks around the dungeon the other way.
 */
export function orient(cx: number, cy: number, yaw: IsoYaw): Point {
  switch (yaw) {
    case 0:
      return { x: cx, y: cy }
    case 1:
      return { x: -cy, y: cx }
    case 2:
      return { x: -cx, y: -cy }
    case 3:
      return { x: cy, y: -cx }
  }
}

export function unorient(vx: number, vy: number, yaw: IsoYaw): Point {
  switch (yaw) {
    case 0:
      return { x: vx, y: vy }
    case 1:
      return { x: vy, y: -vx }
    case 2:
      return { x: -vx, y: -vy }
    case 3:
      return { x: -vy, y: vx }
  }
}

/** Painter's depth: smaller is farther from the camera. */
export function isoDepth(cx: number, cy: number, yaw: IsoYaw): number {
  const view = orient(cx, cy, yaw)
  return view.x + view.y
}

/** Back-most isoDepth of a rectangle after yaw — far corner of a room volume. */
export function rectPaintDepth(
  rect: { minX: number; minY: number; maxX: number; maxY: number },
  yaw: IsoYaw,
): number {
  return Math.min(
    isoDepth(rect.minX, rect.minY, yaw),
    isoDepth(rect.maxX, rect.minY, yaw),
    isoDepth(rect.minX, rect.maxY, yaw),
    isoDepth(rect.maxX, rect.maxY, yaw),
  )
}

export function screenToWorld(sx: number, sy: number, camera: Camera): Point {
  return {
    x: sx / camera.zoom + camera.x,
    y: sy / camera.zoom + camera.y,
  }
}

export function worldToScreen(wx: number, wy: number, camera: Camera): Point {
  return {
    x: (wx - camera.x) * camera.zoom,
    y: (wy - camera.y) * camera.zoom,
  }
}

/** Grid point (cx, cy) on the floor plane — the north (top) corner of that cell. */
export function cellToWorld(cx: number, cy: number, yaw: IsoYaw = 0): Point {
  const view = orient(cx, cy, yaw)
  return {
    x: (view.x - view.y) * (TILE_WIDTH / 2),
    y: (view.x + view.y) * (TILE_HEIGHT / 2),
  }
}

export function cellToScreen(cx: number, cy: number, camera: Camera): Point {
  const world = cellToWorld(cx, cy, camera.yaw)
  return worldToScreen(world.x, world.y, camera)
}

export function worldToCell(wx: number, wy: number, yaw: IsoYaw): Point {
  const a = wx / (TILE_WIDTH / 2)
  const b = wy / (TILE_HEIGHT / 2)
  return unorient((a + b) / 2, (b - a) / 2, yaw)
}

export function screenToCell(sx: number, sy: number, camera: Camera): Point {
  const world = screenToWorld(sx, sy, camera)
  const cell = worldToCell(world.x, world.y, camera.yaw)
  return {
    x: Math.floor(cell.x),
    y: Math.floor(cell.y),
  }
}

export function cellCenter(cx: number, cy: number, camera: Camera): Point {
  return cellToScreen(cx + 0.5, cy + 0.5, camera)
}

export function lift(point: Point, camera: Camera, height: number): Point {
  return { x: point.x, y: point.y - height * camera.zoom }
}

export function roomLift(elevation: number | undefined): number {
  return (elevation ?? 0) * LEVEL_HEIGHT
}

export function clampElevation(value: number): number {
  return Math.max(MIN_ELEVATION, Math.min(MAX_ELEVATION, Math.round(value)))
}

export function liftCorners(corners: IsoCorners, camera: Camera, height: number): IsoCorners {
  return {
    n: lift(corners.n, camera, height),
    e: lift(corners.e, camera, height),
    s: lift(corners.s, camera, height),
    w: lift(corners.w, camera, height),
  }
}

/** Undo `lift` so a click on a raised floor maps back to the cell grid. */
export function screenToCellAt(
  sx: number,
  sy: number,
  camera: Camera,
  elevation: number,
): Point {
  return screenToCell(sx, sy + roomLift(elevation) * camera.zoom, camera)
}

/** Continuous grid coords at an elevation, not snapped to a tile. */
export function screenToGridAt(
  sx: number,
  sy: number,
  camera: Camera,
  elevation: number,
): Point {
  const world = screenToWorld(sx, sy + roomLift(elevation) * camera.zoom, camera)
  return worldToCell(world.x, world.y, camera.yaw)
}

export interface IsoCorners {
  n: Point
  e: Point
  s: Point
  w: Point
}

/** Floor diamond for the cell at (cx, cy), corners labeled in world space. */
export function cellCorners(cx: number, cy: number, camera: Camera): IsoCorners {
  return {
    n: cellToScreen(cx, cy, camera),
    e: cellToScreen(cx + 1, cy, camera),
    s: cellToScreen(cx + 1, cy + 1, camera),
    w: cellToScreen(cx, cy + 1, camera),
  }
}

/** Floor diamond covering a whole room (or draft) rectangle, world-labeled. */
export function rectCorners(
  rect: { minX: number; minY: number; maxX: number; maxY: number },
  camera: Camera,
): IsoCorners {
  return {
    n: cellToScreen(rect.minX, rect.minY, camera),
    e: cellToScreen(rect.maxX + 1, rect.minY, camera),
    s: cellToScreen(rect.maxX + 1, rect.maxY + 1, camera),
    w: cellToScreen(rect.minX, rect.maxY + 1, camera),
  }
}

/** Relabel a diamond so n/e/s/w match the screen (top/right/bottom/left). */
export function screenCorners(corners: IsoCorners): IsoCorners {
  const pts = [corners.n, corners.e, corners.s, corners.w]
  return {
    n: pts.reduce((a, b) => (a.y <= b.y ? a : b)),
    e: pts.reduce((a, b) => (a.x >= b.x ? a : b)),
    s: pts.reduce((a, b) => (a.y >= b.y ? a : b)),
    w: pts.reduce((a, b) => (a.x <= b.x ? a : b)),
  }
}

export function zoomAt(camera: Camera, sx: number, sy: number, factor: number): Camera {
  const world = screenToWorld(sx, sy, camera)
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor))
  return {
    ...camera,
    x: world.x - sx / zoom,
    y: world.y - sy / zoom,
    zoom,
  }
}

export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return {
    ...camera,
    x: camera.x - dx / camera.zoom,
    y: camera.y - dy / camera.zoom,
  }
}

/** Keep the cell under (sx, sy) still while turning 90°. */
export function rotateAt(camera: Camera, sx: number, sy: number, steps: number): Camera {
  const world = screenToWorld(sx, sy, camera)
  const cell = worldToCell(world.x, world.y, camera.yaw)
  const yaw = wrapYaw(camera.yaw + steps)
  const next = cellToWorld(cell.x, cell.y, yaw)
  return {
    ...camera,
    x: next.x - sx / camera.zoom,
    y: next.y - sy / camera.zoom,
    yaw,
  }
}

/** Camera that puts world point (wx, wy) under the given screen point. */
export function cameraFocused(
  wx: number,
  wy: number,
  screenX: number,
  screenY: number,
  zoom: number,
  yaw: IsoYaw = 0,
): Camera {
  return {
    x: wx - screenX / zoom,
    y: wy - screenY / zoom,
    zoom,
    yaw,
  }
}

export function centerOnWorld(
  width: number,
  height: number,
  wx: number,
  wy: number,
  zoom: number,
  yaw: IsoYaw = 0,
): Camera {
  return cameraFocused(wx, wy, width / 2, height / 2, zoom, yaw)
}
