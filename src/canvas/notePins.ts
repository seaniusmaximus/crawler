import { anchorTarget } from '../model/noteMap.ts'
import { noteTitle, type Note } from '../model/notes.ts'
import type { Camera, Dungeon } from '../model/types.ts'
import { cellCenter, lift, roomLift } from './camera.ts'

/**
 * A note's pin standing on the map, for whoever owns the note (the DM's are
 * never shown to players). Laid out here so the map can draw it and tell when
 * it is clicked.
 */
export interface NotePin {
  noteId: string
  title: string
  shared: boolean
  /** The pin's head on screen, and where its stem meets the floor. */
  x: number
  y: number
  footX: number
  footY: number
  radius: number
}

const RADIUS = 9
/** How high the head stands over its square, in world units: a little under a wall. */
const STEM = 26
const GRAB_SLOP = 3

/**
 * Pins for notes anchored on `floorId` of the map in play, in rooms this view
 * shows. Several on one square stand side by side.
 */
export function notePins(
  dungeon: Dungeon,
  notes: readonly Note[],
  mapId: string | null,
  floorId: string,
  shownRoomIds: ReadonlySet<string>,
  camera: Camera,
): NotePin[] {
  const bySquare = new Map<string, NotePin[]>()
  for (const note of notes) {
    const target = anchorTarget(dungeon, note.anchor, mapId)
    if (!target || target.floor.id !== floorId || !target.room || !shownRoomIds.has(target.room.id)) continue
    const height = roomLift((target.room.elevation ?? 0) + target.hover)
    const foot = lift(cellCenter(target.cell.x, target.cell.y, camera), camera, height)
    const head = lift(foot, camera, STEM)
    const key = `${target.cell.x},${target.cell.y},${target.hover}`
    const pin: NotePin = {
      noteId: note.id,
      title: noteTitle(note),
      shared: note.shared,
      x: head.x,
      y: head.y,
      footX: foot.x,
      footY: foot.y,
      radius: RADIUS,
    }
    bySquare.set(key, [...(bySquare.get(key) ?? []), pin])
  }
  const pins: NotePin[] = []
  for (const group of bySquare.values()) {
    const gap = RADIUS * 2 + 3
    group.forEach((pin, i) => pins.push({ ...pin, x: pin.x + (i - (group.length - 1) / 2) * gap }))
  }
  // Nearer the viewer draws last, on top.
  return pins.sort((a, b) => a.footY - b.footY)
}

/** The pin under a screen point, if any; the one drawn on top wins. */
export function hitNotePin(pins: readonly NotePin[], sx: number, sy: number): NotePin | undefined {
  for (let i = pins.length - 1; i >= 0; i--) {
    const pin = pins[i]
    if (Math.hypot(sx - pin.x, sy - pin.y) <= pin.radius + GRAB_SLOP) return pin
  }
  return undefined
}
