import { isFlatObject, objectDef, type ObjectDef } from '../objects/catalog.ts'
import { rectsOverlap, roomContains } from './rect.ts'
import { occupantRoom } from './players.ts'
import { stairsAt } from './tiles.ts'
import { showsWall } from './walls.ts'
import type { CellRect, ObjectTurn, Room, RoomObject } from './types.ts'

export const MIN_OBJECT_SCALE = 1
export const MAX_OBJECT_SCALE = 4
export const MIN_OBJECT_HOVER = 0
export const MAX_OBJECT_HOVER = 8

/** Where and how an object stands: enough to draw it, or to test that it fits. */
export type ObjectPose = Pick<RoomObject, 'kind' | 'x' | 'y' | 'turn' | 'scale' | 'hover'>

/**
 * An object the Objects tool is about to place, or one being dragged to a new
 * spot (`objectId` set). `fits` says whether letting go would land it.
 */
export interface ObjectDraft extends ObjectPose {
  roomId: string
  objectId: string | null
  elevation: number
  fits: boolean
}

export function roomObjects(room: Pick<Room, 'objects'>): readonly RoomObject[] {
  return room.objects ?? []
}

export function nextTurn(turn: ObjectTurn, steps = 1): ObjectTurn {
  return ((((turn + steps) % 4) + 4) % 4) as ObjectTurn
}

export function objectScale(pose: Pick<RoomObject, 'scale'>): number {
  const scale = Math.round(pose.scale ?? 1)
  return Math.max(MIN_OBJECT_SCALE, Math.min(MAX_OBJECT_SCALE, scale))
}

/** Steps above its room's floor, one step being 5 ft, as a token's hover is. */
export function objectHover(pose: Pick<RoomObject, 'hover'>): number {
  const hover = Math.round(pose.hover ?? 0)
  return Math.max(MIN_OBJECT_HOVER, Math.min(MAX_OBJECT_HOVER, hover))
}

/** Footprint size once scaled and turned: a quarter turn swaps across and deep. */
export function turnedSize(def: Pick<ObjectDef, 'w' | 'd'>, turn: ObjectTurn, scale = 1): { w: number; d: number } {
  const w = def.w * scale
  const d = def.d * scale
  return turn % 2 === 0 ? { w, d } : { w: d, d: w }
}

/** The cells an object of `def` covers with its north corner at (x, y). */
export function footprintAt(
  def: Pick<ObjectDef, 'w' | 'd'>,
  x: number,
  y: number,
  turn: ObjectTurn,
  scale = 1,
): CellRect {
  const size = turnedSize(def, turn, scale)
  return { minX: x, minY: y, maxX: x + size.w - 1, maxY: y + size.d - 1 }
}

export function objectFootprint(pose: ObjectPose): CellRect {
  return footprintAt(objectDef(pose.kind), pose.x, pose.y, pose.turn, objectScale(pose))
}

/**
 * Maps a point in an object's own footprint (0..w by 0..d, before turning) to
 * an offset from its north corner once turned clockwise `turn` times.
 */
export function turnPoint(def: Pick<ObjectDef, 'w' | 'd'>, turn: ObjectTurn, u: number, v: number): { x: number; y: number } {
  switch (turn) {
    case 0:
      return { x: u, y: v }
    case 1:
      return { x: def.d - v, y: u }
    case 2:
      return { x: def.w - u, y: def.d - v }
    case 3:
      return { x: v, y: def.w - u }
  }
}

/** A rug on the floor lies under everything; anything else stands at its hover height. */
export function liesOnFloor(pose: ObjectPose): boolean {
  return objectHover(pose) === 0 && isFlatObject(objectDef(pose.kind))
}

/**
 * Objects only crowd each other at the same height: a rug and the table on it
 * share cells, and so do a table and a chandelier floating above it.
 */
function sameLayer(a: ObjectPose, b: ObjectPose): boolean {
  if (liesOnFloor(a) || liesOnFloor(b)) return liesOnFloor(a) === liesOnFloor(b)
  return objectHover(a) === objectHover(b)
}

/**
 * Whether an object fits where `pose` puts it: every cell it covers is open
 * floor of this room (no wall, door or stairs, and no higher room on top), and
 * nothing else in the room stands in the same cells at the same height.
 */
export function canPlaceObject(rooms: readonly Room[], room: Room, pose: ObjectPose, exceptId?: string): boolean {
  const rect = objectFootprint(pose)
  for (let cy = rect.minY; cy <= rect.maxY; cy++) {
    for (let cx = rect.minX; cx <= rect.maxX; cx++) {
      if (!roomContains(room, cx, cy)) return false
      if (occupantRoom(rooms, cx, cy)?.id !== room.id) return false
      if (showsWall(rooms, room, cx, cy) || stairsAt(room, cx, cy)) return false
    }
  }
  return !roomObjects(room).some(
    (other) => other.id !== exceptId && sameLayer(other, pose) && rectsOverlap(objectFootprint(other), rect),
  )
}

/**
 * The object grown or shrunk by `delta` steps, kept centred where it can be and
 * held at its north corner otherwise; null when no size change fits.
 */
export function rescaledObject(rooms: readonly Room[], room: Room, object: RoomObject, delta: number): RoomObject | null {
  const before = objectScale(object)
  const scale = Math.max(MIN_OBJECT_SCALE, Math.min(MAX_OBJECT_SCALE, before + delta))
  if (scale === before) return null
  const def = objectDef(object.kind)
  const old = turnedSize(def, object.turn, before)
  const next = turnedSize(def, object.turn, scale)
  const centred = {
    x: object.x + Math.trunc((old.w - next.w) / 2),
    y: object.y + Math.trunc((old.d - next.d) / 2),
  }
  for (const spot of [centred, { x: object.x, y: object.y }]) {
    const candidate = withPose(object, { ...spot, scale })
    if (canPlaceObject(rooms, room, candidate, object.id)) return candidate
  }
  return null
}

/** The object raised or lowered by `delta` steps; null when it can't go there. */
export function rehoveredObject(rooms: readonly Room[], room: Room, object: RoomObject, delta: number): RoomObject | null {
  const before = objectHover(object)
  const hover = Math.max(MIN_OBJECT_HOVER, Math.min(MAX_OBJECT_HOVER, before + delta))
  if (hover === before) return null
  const candidate = withPose(object, { hover })
  return canPlaceObject(rooms, room, candidate, object.id) ? candidate : null
}

/** An object with some of its pose changed, leaving out a scale of 1 and a hover of 0. */
export function withPose(object: RoomObject, change: Partial<ObjectPose>): RoomObject {
  const { scale, hover, ...rest } = { ...object, ...change }
  return {
    ...rest,
    ...(scale !== undefined && scale !== 1 ? { scale } : {}),
    ...(hover !== undefined && hover !== 0 ? { hover } : {}),
  }
}

