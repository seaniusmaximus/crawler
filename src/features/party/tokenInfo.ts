import { floorTag } from '../../model/floors.ts'
import { occupantRoom } from '../../model/players.ts'
import { hpRatio } from '../../model/stats.ts'
import type { Floor, Player, Room } from '../../model/types.ts'
import { roomRevealed, tokenRevealed, type ViewMode } from '../../model/visibility.ts'

export type HpTone = 'good' | 'hurt' | 'low' | 'none'

export function hpTone(hp: number | null, hpMax: number | null): HpTone {
  const ratio = hpRatio(hp, hpMax)
  if (ratio == null) return 'none'
  if (ratio > 0.5) return 'good'
  if (ratio > 0.25) return 'hurt'
  return 'low'
}

/** What players are told about a foe instead of its numbers. */
export function woundLabel(hp: number | null, hpMax: number | null): string {
  const ratio = hpRatio(hp, hpMax)
  if (ratio == null) return ''
  if (ratio <= 0) return 'Down'
  if (ratio >= 1) return 'Unhurt'
  return ratio > 0.5 ? 'Hurt' : 'Bloodied'
}

export function tokenPlace(
  player: Player,
  floors: readonly Floor[],
): { floor: Floor | undefined; room: Room | undefined } {
  const floor = floors.find((item) => item.id === player.floorId)
  const room = floor ? occupantRoom(floor.rooms, player.x, player.y) : undefined
  return { floor, room }
}

/** "F1 · Great Hall", or just the floor tag when the token stands between rooms. */
export function placeLabel(player: Player, floors: readonly Floor[]): string {
  const { floor, room } = tokenPlace(player, floors)
  if (!floor) return ''
  return room ? `${floorTag(floor.order)} · ${room.name}` : floorTag(floor.order)
}

/** Player view only lists tokens they could see on the map. */
export function tokenShown(player: Player, floors: readonly Floor[], mode: ViewMode): boolean {
  if (mode !== 'player') return true
  if (!tokenRevealed(player)) return false
  const { floor, room } = tokenPlace(player, floors)
  if (!floor) return false
  return !room || roomRevealed(room)
}
