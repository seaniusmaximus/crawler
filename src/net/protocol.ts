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
  /**
   * A player without D&D Beyond asks for a token; `playerId` reclaims one they had.
   * `pick` marks a choice from the "played here before" list, which the DM refuses
   * if someone else at the table already holds that token.
   */
  | { type: 'spawn'; clientId: string; name: string; playerId: string | null; pick?: boolean }
  | SnapshotMessage
  | { type: 'move'; playerId: string; floorId: string; x: number; y: number }
  | { type: 'player'; player: Player }
  | { type: 'opening'; floorId: string; roomId: string; x: number; y: number }
  | { type: 'dice'; rolls: DiceRoll[] }
  | { type: 'travel'; travel: TokenTravel | null }
  | { type: 'focus'; floorId: string; roomId: string }
  /** Sent by the table relay itself whenever someone connects or drops. */
  | { type: 'presence'; host: boolean; guests: string[] }
  /** Sent by the relay just before it closes a socket for good (see worker/room.ts). */
  | { type: 'kicked'; code: number; reason: string }
  /** The relay stored the DM's snapshot with this `seq`. */
  | { type: 'saved'; seq: number }
  /** A save point was restored: the DM's browser takes this as its map. */
  | { type: 'restore'; snapshot: SnapshotMessage }

export interface SnapshotMessage {
  type: 'snapshot'
  dungeon: Dungeon
  rolls: DiceRoll[]
  you: Record<string, string | null>
  /** Set by the DM so the relay can confirm exactly which version it saved. */
  seq?: number
}

export function isNetMessage(value: unknown): value is NetMessage {
  return Boolean(value && typeof value === 'object' && 'type' in value)
}

export function roomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
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
