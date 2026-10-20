import type { DiceRoll, RollRequest } from '../model/dice.ts'
import type { EffectPlan } from '../model/effects.ts'
import type { AreaMark, MarkKind, Ping, TableMark } from '../model/marks.ts'
import type { Handout, Note, SharedNote } from '../model/notes.ts'
import type { SpellCard } from '../model/spellCard.ts'
import type { CharacterStats } from '../model/stats.ts'
import type { TokenTravel } from '../model/travel.ts'
import type { Dungeon, Player } from '../model/types.ts'
import type { World } from '../model/worlds.ts'
import type { DungeonPatch } from './patch.ts'

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
  /** `feet` is how far the token walked there, counted toward its movement on its turn. */
  | { type: 'move'; playerId: string; floorId: string; x: number; y: number; feet?: number }
  /** A player marks their token (or companion) as taking the Dash action this turn, or not. */
  | { type: 'dash'; clientId: string; playerId: string; dashed: boolean }
  /** A pulse on the map for everyone to look at, relayed straight to all and never saved. */
  | { type: 'ping'; clientId: string; ping: Ping }
  /** A spell someone sent over from D&D Beyond, shown to everyone to read; relayed straight to all and never saved. */
  | { type: 'spellCard'; clientId: string; card: SpellCard }
  | { type: 'player'; player: Player }
  | { type: 'opening'; floorId: string; roomId: string; x: number; y: number }
  /**
   * Rolls for the log. From the relay these are its own 'table' rolls; a browser
   * may only send D&D Beyond ones (the relay drops anything else).
   */
  | { type: 'dice'; rolls: DiceRoll[] }
  /** Ask the relay to roll; the result comes back to everyone as `dice`. */
  | { type: 'roll'; clientId: string; request: RollRequest }
  /**
   * A live token path, relayed straight to everyone and never saved. `travel` is
   * null when the sender's path for `playerId` ends; `fromHost` is checked by the relay.
   */
  | { type: 'travel'; clientId: string; fromHost: boolean; playerId: string; travel: TokenTravel | null }
  /**
   * A ruler or spell area, relayed straight to everyone and never saved. `mark` is
   * null when the sender takes theirs away; `fromHost` is checked by the relay.
   */
  | { type: 'mark'; clientId: string; fromHost: boolean; kind: MarkKind; mark: TableMark | null }
  /**
   * A player lays a spell area down on the map (`add`, with its id) or takes
   * theirs away (`remove`). The DM's browser checks it over and puts it on the map.
   */
  | { type: 'area'; clientId: string; add?: AreaMark; remove?: string[] }
  /**
   * A player's spell going off: who it catches and what it does. The DM's browser
   * waits for its rolls (tagged with its id) and applies the outcome.
   */
  | { type: 'effect'; clientId: string; plan: EffectPlan }
  | { type: 'focus'; floorId: string; roomId: string }
  /** Sent by the table relay itself whenever someone connects or drops. */
  | { type: 'presence'; host: boolean; guests: string[] }
  /** Sent by the relay just before it closes a socket for good (see worker/room.ts). */
  | { type: 'kicked'; code: number; reason: string }
  /**
   * What changed since revision `base`, from the DM to everyone; never stored. A player
   * whose map isn't at `base` asks for a resync instead of applying it.
   */
  | { type: 'patch'; base: number; rev: number; patch: DungeonPatch; you?: Record<string, string | null> }
  /** The DM moves the party to another map; the relay answers with `mapLoad` or `mapError`. */
  | { type: 'switchMap'; mapId: string }
  /** That map, as last saved (null when it's brand new), now live. */
  | { type: 'mapLoad'; mapId: string; snapshot: SnapshotMessage | null }
  | { type: 'mapError'; message: string }
  /** A player's map fell out of step: the DM answers with a full snapshot. */
  | { type: 'resync'; clientId: string }
  /** The relay stored the DM's snapshot with this `seq`. */
  | { type: 'saved'; seq: number }
  /** A save point was restored: the DM's browser takes this as its map. */
  | { type: 'restore'; snapshot: SnapshotMessage }
  /**
   * Notes (see src/model/notes.ts) are kept by the relay, never in the map. The DM
   * saves or deletes their own; a player, those of the token the DM says they hold.
   */
  | { type: 'noteSave'; clientId: string; note: Note }
  | { type: 'noteDelete'; clientId: string; id: string }
  /**
   * From the relay: this seat's own notes (the DM's, or the player's token's) and
   * everything shared with the table, on connecting and whenever the seat changes
   * hands. `mapId` is the map in play, which pins are placed on.
   */
  | { type: 'notebook'; mapId: string | null; notes: Note[]; shared: SharedNote[] }
  /** From the relay: one of this seat's notes changed in another tab. */
  | { type: 'noteMine'; id: string; note: Note | null }
  /** From the relay: a note shared with the table changed, or stopped being shared (`note` null). */
  | { type: 'noteShared'; id: string; author: string; note: SharedNote | null }
  | { type: 'noteError'; message: string }
  /** The DM puts a picture (or a note's shared words) up on everyone's screen; relayed straight to all, never saved. */
  | { type: 'handout'; clientId: string; handout: Handout }
  /** From the relay: the party moved to this map. */
  | { type: 'liveMap'; mapId: string }
  /**
   * World maps (see src/model/worlds.ts) are kept by the relay beside the maps. Only
   * the DM saves, deletes or shows one; the table only ever gets `playerView` of the one shown.
   */
  | { type: 'worldSave'; world: World }
  | { type: 'worldDelete'; id: string }
  /** The DM puts a world map on everyone's screen, or (null) takes it down. */
  | { type: 'worldShow'; id: string | null }
  /** From the relay, to the DM on connecting: every world map, and which one the table is shown. */
  | { type: 'worlds'; worlds: World[]; shown: string | null }
  /** From the relay: the world map the table is shown now (to players, as they may see it), or none. */
  | { type: 'worldShown'; world: World | null }
  | { type: 'worldError'; message: string }

export interface SnapshotMessage {
  type: 'snapshot'
  dungeon: Dungeon
  rolls: DiceRoll[]
  you: Record<string, string | null>
  /** Set by the DM so the relay can confirm exactly which version it saved. */
  seq?: number
  /** The DM's revision this snapshot is at; patches build on it. */
  rev?: number
  /** Save only: the relay stores it but doesn't send it to the players. */
  quiet?: boolean
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
