import { objectFootprint } from '../model/objects.ts'
import type { Camera, CellRect, ElevationRamp, Room, RoomObject } from '../model/types.ts'
import { MIN_ELEVATION, WALL_HEIGHT, cellToWorld, roomLift } from './camera.ts'
import { objectTop } from './objects.ts'

/** A box in world pixels (zoom 1), where the map is laid out before the camera moves and scales it. */
export interface WorldRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** A ramp shown in the scene as a preview of one being drawn. */
export type RampPreview = Omit<ElevationRamp, 'id'>

/**
 * How far past a changed thing its painting can spread, in cells: its shadow,
 * the pool of light it casts, and the walls it shares with the room next door.
 */
const SPILL = 3
/** How far a halo can spread, in world pixels, and a little over. */
const HALO = 70
/** Deep enough for any stone under a raised floor. */
const LOWEST = roomLift(MIN_ELEVATION)

/** The parts of the scene whose changes can be found in place (see `changedRegions`). */
export interface SceneShape {
  rooms: readonly Room[]
  ramps: readonly ElevationRamp[] | undefined
  /** The ramp being drawn, previewed in the scene. */
  ramp: RampPreview | null
}

/**
 * Where on the map painting differs between two versions of the floor's rooms,
 * its ramps and the ramp being previewed, as world boxes; null when too much
 * changed to say (rooms or ramps added, removed or reordered) and it should all
 * be painted again. A room whose only change is its objects gives just those
 * objects' spots, old and new; any other change to a room gives the whole room.
 */
export function changedRegions(before: SceneShape, after: SceneShape, yaw: Camera['yaw']): WorldRect[] | null {
  const regions: WorldRect[] = []
  if (before.rooms !== after.rooms) {
    if (before.rooms.length !== after.rooms.length) return null
    for (let i = 0; i < after.rooms.length; i++) {
      const old = before.rooms[i]!
      const next = after.rooms[i]!
      if (old === next) continue
      if (old.id !== next.id) return null
      const objects = onlyObjectsChanged(old, next) ? changedObjects(old.objects ?? [], next.objects ?? []) : null
      if (objects) {
        const floor = roomLift(next.elevation)
        for (const object of objects) regions.push(region(objectFootprint(object), yaw, floor, floor + objectTop(object)))
      } else {
        regions.push(roomRegion(old, yaw), roomRegion(next, yaw))
      }
    }
  }
  if (before.ramps !== after.ramps) {
    const was = before.ramps ?? []
    const is = after.ramps ?? []
    if (was.length !== is.length) return null
    for (let i = 0; i < is.length; i++) {
      const old = was[i]!
      const next = is[i]!
      if (old === next) continue
      if (old.id !== next.id) return null
      regions.push(rampRegion(old, yaw), rampRegion(next, yaw))
    }
  }
  if (!sameRampPreview(before.ramp, after.ramp)) {
    for (const ramp of [before.ramp, after.ramp]) if (ramp) regions.push(rampRegion(ramp, yaw))
  }
  return regions
}

/** All a ramp can paint: its flight, from the deepest stone to a wall above its top. */
function rampRegion(ramp: RampPreview, yaw: Camera['yaw']): WorldRect {
  return region(ramp.rect, yaw, LOWEST, roomLift(Math.max(ramp.fromElev, ramp.toElev)) + WALL_HEIGHT)
}

/** Whether two versions of a room differ in nothing but their objects. */
function onlyObjectsChanged(a: Room, b: Room): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (key !== 'objects' && a[key as keyof Room] !== b[key as keyof Room]) return false
  }
  return true
}

/**
 * The objects that moved, changed, came or went, in both their old and new
 * versions; null when the objects were reordered, which can change how they
 * paint over each other anywhere in the room.
 */
function changedObjects(before: readonly RoomObject[], after: readonly RoomObject[]): RoomObject[] | null {
  const kept = after.filter((object) => before.some((old) => old.id === object.id))
  const stayed = before.filter((object) => after.some((next) => next.id === object.id))
  if (kept.some((object, i) => object.id !== stayed[i]?.id)) return null
  const changed: RoomObject[] = []
  const was = new Map(before.map((object) => [object.id, object]))
  const is = new Map(after.map((object) => [object.id, object]))
  for (const object of after) {
    const old = was.get(object.id)
    if (old === object) continue
    changed.push(object)
    if (old) changed.push(old)
  }
  for (const object of before) if (!is.has(object.id)) changed.push(object)
  return changed
}

/** All a room can paint: its floor and walls, the stone under it, its objects, and what spills next door. */
function roomRegion(room: Room, yaw: Camera['yaw']): WorldRect {
  const floor = roomLift(room.elevation)
  let tallest = WALL_HEIGHT
  for (const object of room.objects ?? []) tallest = Math.max(tallest, objectTop(object))
  return region(room.rect, yaw, LOWEST, floor + tallest)
}

/** The world box over `rect`'s cells grown by SPILL, from `low` to `high` pixels up, with room for halos. */
function region(rect: CellRect, yaw: Camera['yaw'], low: number, high: number): WorldRect {
  const corners = [
    cellToWorld(rect.minX - SPILL, rect.minY - SPILL, yaw),
    cellToWorld(rect.maxX + 1 + SPILL, rect.minY - SPILL, yaw),
    cellToWorld(rect.maxX + 1 + SPILL, rect.maxY + 1 + SPILL, yaw),
    cellToWorld(rect.minX - SPILL, rect.maxY + 1 + SPILL, yaw),
  ]
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  return {
    x0: Math.min(...xs) - HALO,
    x1: Math.max(...xs) + HALO,
    // Higher on the map is further up the screen.
    y0: Math.min(...ys) - high - HALO,
    y1: Math.max(...ys) - low + HALO,
  }
}

export function sameRampPreview(a: RampPreview | null, b: RampPreview | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.up === b.up &&
    a.fromElev === b.fromElev &&
    a.toElev === b.toElev &&
    a.rect.minX === b.rect.minX &&
    a.rect.minY === b.rect.minY &&
    a.rect.maxX === b.rect.maxX &&
    a.rect.maxY === b.rect.maxY
  )
}
