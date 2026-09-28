import { floorAtOrder } from './floors.ts'
import type { Floor, Player, Room } from './types.ts'

export type ViewMode = 'dm' | 'player'

export function roomRevealed(room: Room): boolean {
  return room.visible === true
}

export function tokenRevealed(player: Player): boolean {
  return player.visible === true
}

export function shownRooms(rooms: readonly Room[], mode: ViewMode): Room[] {
  return mode === 'player' ? rooms.filter(roomRevealed) : [...rooms]
}

export function floorRevealed(floor: Floor): boolean {
  return floor.rooms.some(roomRevealed)
}

export function shownFloors(floors: readonly Floor[], mode: ViewMode): Floor[] {
  return mode === 'player' ? floors.filter(floorRevealed) : [...floors]
}

export function nextShownFloor(
  floors: readonly Floor[],
  order: number,
  step: 1 | -1,
  mode: ViewMode,
): Floor | undefined {
  let next = order + step
  while (true) {
    const floor = floorAtOrder(floors, next)
    if (!floor) return undefined
    if (mode !== 'player' || floorRevealed(floor)) return floor
    next += step
  }
}
