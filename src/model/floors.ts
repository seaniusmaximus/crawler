import type { Floor } from './types.ts'

export const GROUND_ORDER = 0

export function floorName(order: number): string {
  return order >= 0 ? `Floor ${order + 1}` : `Basement ${-order}`
}

/** Short elevator-style label: F1 is the ground floor, B1 the first basement. */
export function floorTag(order: number): string {
  return order >= 0 ? `F${order + 1}` : `B${-order}`
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

/**
 * Close the gap a deleted floor leaves: floors keep their order in the stack but
 * number on from the ground floor again (the lowest above-ground floor, or the
 * top basement when none is left). Floors still wearing a default name take
 * their new number's name.
 */
export function packFloors(floors: readonly Floor[]): Floor[] {
  const sorted = [...floors].sort((a, b) => a.order - b.order)
  const below = sorted.filter((floor) => floor.order < GROUND_ORDER).length
  const ground = below === sorted.length ? below - 1 : below
  return sorted.map((floor, index) => {
    const order = GROUND_ORDER + index - ground
    if (order === floor.order) return floor
    const name = floor.name === floorName(floor.order) ? floorName(order) : floor.name
    return { ...floor, order, name }
  })
}
