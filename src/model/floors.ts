import type { Floor } from './types.ts'

export const GROUND_ORDER = 0

export function floorName(order: number): string {
  return order >= 0 ? `Floor ${order + 1}` : `Basement ${-order}`
}

/** Highest floor first, the way a floor stack reads. */
export function floorsTopDown(floors: readonly Floor[]): Floor[] {
  return [...floors].sort((a, b) => b.order - a.order)
}

export function lowestFloor(floors: readonly Floor[]): Floor | undefined {
  let lowest: Floor | undefined
  for (const floor of floors) {
    if (!lowest || floor.order < lowest.order) lowest = floor
  }
  return lowest
}

export function floorAtOrder(floors: readonly Floor[], order: number): Floor | undefined {
  return floors.find((floor) => floor.order === order)
}

/**
 * Falls back to the ground floor rather than the lowest one, so adding a
 * basement never moves the view out from under the user.
 */
export function resolveFloor(floors: readonly Floor[], activeFloorId: string | null): Floor {
  const active = activeFloorId ? floors.find((floor) => floor.id === activeFloorId) : undefined
  const floor = active ?? floorAtOrder(floors, GROUND_ORDER) ?? lowestFloor(floors)
  if (!floor) throw new Error('Dungeon has no floor')
  return floor
}
