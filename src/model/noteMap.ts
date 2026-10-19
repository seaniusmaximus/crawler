import { objectFootprint } from './objects.ts'
import { areaCells, type PlacedArea } from './marks.ts'
import { roomContains } from './rect.ts'
import type { NoteAnchor } from './notes.ts'
import type { Dungeon, Floor, Room } from './types.ts'
import { TRAPS } from '../objects/defs/traps.ts'

/** Notes on the map in play: where their pins stand, and the reminders the map writes itself. */

// ---------- Where a pin is on the map ----------

/** What an anchor points at on the map in play, if it is still there. */
export interface AnchorTarget {
  floor: Floor
  room: Room | null
  /** The square the pin stands on, and how high above the floor plane (in room steps). */
  cell: { x: number; y: number }
  /** Steps above the room's floor, for an object that floats. */
  hover: number
}

/** Where on the map in play an anchor is; null when it's another map's, a whole map, or what it named is gone. */
export function anchorTarget(dungeon: Dungeon, anchor: NoteAnchor | null, liveMapId: string | null): AnchorTarget | null {
  if (!anchor || anchor.mapId !== liveMapId || !anchor.floorId || !anchor.roomId) return null
  const floor = dungeon.floors.find((item) => item.id === anchor.floorId)
  const room = floor?.rooms.find((item) => item.id === anchor.roomId)
  if (!floor || !room) return null
  if (anchor.objectId) {
    const object = room.objects?.find((item) => item.id === anchor.objectId)
    if (!object) return null
    const rect = objectFootprint(object)
    return {
      floor,
      room,
      cell: { x: Math.floor((rect.minX + rect.maxX) / 2), y: Math.floor((rect.minY + rect.maxY) / 2) },
      hover: object.hover ?? 0,
    }
  }
  const rect = room.rect
  if (anchor.dx !== undefined && anchor.dy !== undefined) {
    const cell = { x: rect.minX + anchor.dx, y: rect.minY + anchor.dy }
    if (roomContains(room, cell.x, cell.y)) return { floor, room, cell, hover: 0 }
  }
  return {
    floor,
    room,
    cell: { x: Math.floor((rect.minX + rect.maxX) / 2), y: Math.floor((rect.minY + rect.maxY) / 2) },
    hover: 0,
  }
}

/** A short name for what an anchor points at: "Guard room · Chest". */
export function anchorLabel(dungeon: Dungeon, anchor: Omit<NoteAnchor, 'label'>, objectName?: (kind: string) => string): string {
  const floor = dungeon.floors.find((item) => item.id === anchor.floorId)
  const room = floor?.rooms.find((item) => item.id === anchor.roomId)
  if (!floor) return dungeon.name || 'This map'
  if (!room) return floor.name
  const object = anchor.objectId ? room.objects?.find((item) => item.id === anchor.objectId) : undefined
  return object && objectName ? `${room.name} · ${objectName(object.kind)}` : room.name
}

// ---------- Reminders the map writes itself ----------

const TRAP_KINDS = new Map(TRAPS.map((def) => [def.id, def.name]))

/** Something in a room for the DM to remember: a trap standing there, or a hidden zone laid over it. */
export interface Reminder {
  id: string
  floorId: string
  roomId: string
  roomName: string
  kind: 'trap' | 'zone'
  text: string
  objectId?: string
}

function zoneText(area: PlacedArea): string {
  const what = area.name || 'Hidden zone'
  const damage = area.damage
  if (!damage) return what
  const dice = `${damage.count}d${damage.faces}${damage.bonus ? (damage.bonus > 0 ? `+${damage.bonus}` : damage.bonus) : ''}`
  const save = damage.save ? `, DC ${damage.save.dc} ${damage.save.ability.toUpperCase()}` : ''
  return `${what}: ${dice}${damage.type ? ` ${damage.type}` : ''}${save}`
}

/**
 * Reminders for every room on the map: trap objects standing in it, and hidden
 * zones (the DM's traps laid with the area tool) over any of its squares.
 */
export function mapReminders(dungeon: Dungeon): Reminder[] {
  const reminders: Reminder[] = []
  const zones = (dungeon.areas ?? []).filter((area) => area.hidden && area.shape !== 'emanation')
  for (const floor of dungeon.floors) {
    const floorZones = zones.filter((area) => area.floorId === floor.id).map((area) => ({ area, cells: areaCells(area) }))
    for (const room of floor.rooms) {
      for (const object of room.objects ?? []) {
        const name = TRAP_KINDS.get(object.kind)
        if (!name) continue
        reminders.push({
          id: `trap:${object.id}`,
          floorId: floor.id,
          roomId: room.id,
          roomName: room.name,
          kind: 'trap',
          text: name,
          objectId: object.id,
        })
      }
      for (const { area, cells } of floorZones) {
        if (!cells.some((cell) => roomContains(room, cell.x, cell.y))) continue
        reminders.push({
          id: `zone:${area.id}:${room.id}`,
          floorId: floor.id,
          roomId: room.id,
          roomName: room.name,
          kind: 'zone',
          text: zoneText(area),
        })
      }
    }
  }
  return reminders
}
