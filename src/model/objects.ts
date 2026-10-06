import { isFlatObject, objectDef, type ObjectDef } from '../objects/catalog.ts'
import { rectContains, rectsOverlap, roomContains } from './rect.ts'
import { occupantRoom } from './players.ts'
import { stairsAt } from './tiles.ts'
import { showsWall } from './walls.ts'
import type { CellRect, ObjectTurn, Room, RoomObject } from './types.ts'

/**
 * An object the Objects tool is about to place, or one being dragged to a new
 * spot (`objectId` set). `fits` says whether letting go would land it.
 */
export interface ObjectDraft {
  roomId: string
  objectId: string | null
  kind: string
  x: number
  y: number
  turn: ObjectTurn
  elevation: number
  fits: boolean
}

export function roomObjects(room: Pick<Room, 'objects'>): readonly RoomObject[] {
  return room.objects ?? []
}

export function nextTurn(turn: ObjectTurn, steps = 1): ObjectTurn {
  return ((((turn + steps) % 4) + 4) % 4) as ObjectTurn
}

/** Footprint size once turned: a quarter turn swaps across and deep. */
export function turnedSize(def: Pick<ObjectDef, 'w' | 'd'>, turn: ObjectTurn): { w: number; d: number } {
  return turn % 2 === 0 ? { w: def.w, d: def.d } : { w: def.d, d: def.w }
}

/** The cells an object of `def` covers with its north corner at (x, y). */
export function footprintAt(def: Pick<ObjectDef, 'w' | 'd'>, x: number, y: number, turn: ObjectTurn): CellRect {
  const size = turnedSize(def, turn)
  return { minX: x, minY: y, maxX: x + size.w - 1, maxY: y + size.d - 1 }
}

export function objectFootprint(object: RoomObject): CellRect {
  return footprintAt(objectDef(object.kind), object.x, object.y, object.turn)
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

/** The object covering a cell, preferring one standing up over a rug beneath it. */
export function objectAt(room: Room, x: number, y: number): RoomObject | undefined {
  let found: RoomObject | undefined
  for (const object of roomObjects(room)) {
    if (!rectContains(objectFootprint(object), x, y)) continue
    if (!isFlatObject(objectDef(object.kind))) return object
    found ??= object
  }
  return found
}

/**
 * Whether an object fits at (x, y): every cell it covers is open floor of this
 * room (no wall, door or stairs, and no higher room on top), and it doesn't
 * share a cell with another object of its kind of layer. Rugs lie under
 * furniture, so one of each may share.
 */
export function canPlaceObject(
  rooms: readonly Room[],
  room: Room,
  kind: string,
  x: number,
  y: number,
  turn: ObjectTurn,
  exceptId?: string,
): boolean {
  const def = objectDef(kind)
  const rect = footprintAt(def, x, y, turn)
  for (let cy = rect.minY; cy <= rect.maxY; cy++) {
    for (let cx = rect.minX; cx <= rect.maxX; cx++) {
      if (!roomContains(room, cx, cy)) return false
      if (occupantRoom(rooms, cx, cy)?.id !== room.id) return false
      if (showsWall(rooms, room, cx, cy) || stairsAt(room, cx, cy)) return false
    }
  }
  const flat = isFlatObject(def)
  return !roomObjects(room).some(
    (other) =>
      other.id !== exceptId &&
      isFlatObject(objectDef(other.kind)) === flat &&
      rectsOverlap(objectFootprint(other), rect),
  )
}

