import type { Camera, CellRect, Edge } from '../model/types.ts'
import { TILE_HEIGHT, WALL_HEIGHT, liftCorners, rectCorners, roomLift, screenCorners } from './camera.ts'
import type { Point } from './camera.ts'

export const HANDLE_SIZE = 12
const GRAB_RADIUS = 11

export interface HandleSpot {
  edge: Edge
  x: number
  y: number
  cursor: string
}

export function handleSpots(rect: CellRect, camera: Camera, elevation = 0): HandleSpot[] {
  const floor = liftCorners(rectCorners(rect, camera), camera, roomLift(elevation))
  const top = liftCorners(floor, camera, WALL_HEIGHT)
  return [
    {
      edge: 'left',
      x: (top.n.x + top.w.x) / 2,
      y: (top.n.y + top.w.y) / 2,
      cursor: resizeCursor(top.n, top.w),
    },
    {
      edge: 'right',
      x: (top.e.x + top.s.x) / 2,
      y: (top.e.y + top.s.y) / 2,
      cursor: resizeCursor(top.e, top.s),
    },
    {
      edge: 'top',
      x: (top.n.x + top.e.x) / 2,
      y: (top.n.y + top.e.y) / 2,
      cursor: resizeCursor(top.n, top.e),
    },
    {
      edge: 'bottom',
      x: (top.w.x + top.s.x) / 2,
      y: (top.w.y + top.s.y) / 2,
      cursor: resizeCursor(top.w, top.s),
    },
  ]
}

function resizeCursor(a: Point, b: Point): string {
  return (b.x - a.x) * (b.y - a.y) >= 0 ? 'nwse-resize' : 'nesw-resize'
}

export function hitHandle(
  rect: CellRect,
  camera: Camera,
  sx: number,
  sy: number,
  elevation = 0,
): Edge | null {
  for (const spot of handleSpots(rect, camera, elevation)) {
    if (Math.abs(sx - spot.x) <= GRAB_RADIUS && Math.abs(sy - spot.y) <= GRAB_RADIUS) {
      return spot.edge
    }
  }
  return null
}

export function edgeCursor(rect: CellRect, camera: Camera, edge: Edge, elevation = 0): string {
  return handleSpots(rect, camera, elevation).find((spot) => spot.edge === edge)?.cursor ?? 'nwse-resize'
}

export function roomScreenRect(
  rect: CellRect,
  camera: Camera,
  elevation = 0,
): { x: number; y: number; width: number; height: number } {
  const floor = screenCorners(liftCorners(rectCorners(rect, camera), camera, roomLift(elevation)))
  const top = liftCorners(floor, camera, WALL_HEIGHT).n
  const xs = [floor.n.x, floor.e.x, floor.s.x, floor.w.x]
  const ys = [top.y, floor.e.y, floor.s.y, floor.w.y]
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  }
}

export function diamondHeight(camera: Camera): number {
  return TILE_HEIGHT * camera.zoom
}
