import type { DiceRoll } from '../model/dice.ts'
import type { CharacterStats } from '../model/stats.ts'
import type { TokenTravel } from '../model/travel.ts'
import type { Dungeon, Player } from '../model/types.ts'

export interface DdbCharacter {
  characterId: string
  name: string
  portrait: string | null
  stats?: Partial<CharacterStats> | null
}

export interface SessionPeer {
  id: string
  playerId: string | null
  name: string
}

export type NetMessage =
  | { type: 'hello'; clientId: string }
  | { type: 'claim'; clientId: string; character: DdbCharacter | null }
  | { type: 'snapshot'; dungeon: Dungeon; rolls: DiceRoll[]; you: Record<string, string | null> }
  | { type: 'move'; playerId: string; floorId: string; x: number; y: number }
  | { type: 'player'; player: Player }
  | { type: 'opening'; floorId: string; roomId: string; x: number; y: number }
  | { type: 'dice'; rolls: DiceRoll[] }
  | { type: 'travel'; travel: TokenTravel | null }

export function isNetMessage(value: unknown): value is NetMessage {
  return Boolean(value && typeof value === 'object' && 'type' in value)
}

export function roomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4))
  return [...bytes].map((byte) => (byte % 36).toString(36)).join('')
}

export function joinIdFromUrl(): string | null {
  const id = new URLSearchParams(window.location.search).get('join')?.trim()
  return id || null
}

export function parseJoinInput(value: string): { room: string; href: string | null } {
  const trimmed = value.trim()
  if (!trimmed) return { room: '', href: null }
  try {
    const url = new URL(trimmed)
    const room = url.searchParams.get('join')?.trim() || trimmed
    return { room, href: url.href }
  } catch {
    return { room: trimmed, href: null }
  }
}

export function joinLinks(origins: string[], room: string): string[] {
  return origins.map((origin) => {
    const url = new URL(origin)
    url.searchParams.set('join', room)
    return url.toString()
  })
}
