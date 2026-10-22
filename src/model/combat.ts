import type { DiceRoll } from './dice.ts'
import { initiativeBonus, normalizeStats } from './stats.ts'
import type { Player } from './types.ts'

function nameOf(player: Player): string {
  const named = player.characterName?.trim()
  return named ? named : player.name
}

export interface Combat {
  turnPlayerId: string | null
  /** Feet each token acting this turn has moved so far; starts over every turn. */
  moved?: Record<string, number>
  /** Tokens acting this turn that took the Dash action, so they move twice their speed. */
  dashed?: string[]
  /** Which round of combat it is, from 1; missing out of combat. */
  round?: number
  /** Spell areas that have already hurt a token on entering this turn, as "areaId:tokenId". */
  areaHits?: string[]
}

/** The most feet a turn's movement is believed to add up to, so a bad message can't wreck it. */
const MAX_TURN_FEET = 10_000

export function emptyCombat(): Combat {
  return { turnPlayerId: null }
}

export function normalizeCombat(value: unknown): Combat {
  const raw = value && typeof value === 'object' ? (value as Combat) : emptyCombat()
  const id = typeof raw.turnPlayerId === 'string' ? raw.turnPlayerId.trim() : ''
  const combat: Combat = { turnPlayerId: id || null }
  if (raw.moved && typeof raw.moved === 'object') {
    const moved: Record<string, number> = {}
    for (const [tokenId, feet] of Object.entries(raw.moved)) {
      if (typeof feet === 'number' && Number.isFinite(feet) && feet > 0) moved[tokenId] = Math.min(MAX_TURN_FEET, Math.round(feet))
    }
    if (Object.keys(moved).length) combat.moved = moved
  }
  if (Array.isArray(raw.dashed)) {
    const dashed = raw.dashed.filter((tokenId): tokenId is string => typeof tokenId === 'string')
    if (dashed.length) combat.dashed = dashed
  }
  if (combat.turnPlayerId && typeof raw.round === 'number' && Number.isFinite(raw.round) && raw.round >= 1) {
    combat.round = Math.round(raw.round)
  }
  if (Array.isArray(raw.areaHits)) {
    const hits = raw.areaHits.filter((hit): hit is string => typeof hit === 'string').slice(0, 500)
    if (hits.length) combat.areaHits = hits
  }
  return combat
}

/**
 * The turn as `turnPlayerId`: when it is still the same turn, what was moved,
 * dashed and set off this turn carries on; a new turn starts fresh. The round
 * carries on either way.
 */
export function withTurn(combat: Combat | undefined, turnPlayerId: string | null): Combat {
  if (combat && combat.turnPlayerId === turnPlayerId) return { ...combat }
  return { turnPlayerId, ...(turnPlayerId && combat?.round != null ? { round: combat.round } : {}) }
}

/**
 * The round the turn passing from `from` to `to` lands in: the first turn of a
 * fight is round 1, and coming back round to the top of the order starts the next.
 */
export function roundAfter(players: readonly Player[], from: string | null, to: string | null, round: number | undefined): number {
  if (!to) return 0
  if (!from || round == null) return 1
  const order = sortByInitiative(players)
    .filter((token) => !initiativeLeader(token, players))
    .map((token) => token.id)
  const before = order.indexOf(from)
  const after = order.indexOf(to)
  return before >= 0 && after >= 0 && after <= before ? round + 1 : round
}

/** The turn with `hit` (an area going off on a token as it entered) noted, so it goes off once a turn. */
export function withAreaHit(combat: Combat, hit: string): Combat {
  return { ...combat, areaHits: [...(combat.areaHits ?? []), hit] }
}

/** The turn with `feet` more moved by `tokenId`. */
export function addMoved(combat: Combat, tokenId: string, feet: number): Combat {
  const before = combat.moved?.[tokenId] ?? 0
  return { ...combat, moved: { ...combat.moved, [tokenId]: Math.min(MAX_TURN_FEET, before + Math.round(feet)) } }
}

/** The turn with `tokenId` dashing, or not. */
export function withDash(combat: Combat, tokenId: string, dashed: boolean): Combat {
  const others = (combat.dashed ?? []).filter((item) => item !== tokenId)
  return { ...combat, dashed: dashed ? [...others, tokenId] : others }
}

/** How far a token acting this turn may move, and has: its speed (twice that when dashing). */
export interface MoveBudget {
  used: number
  total: number
  dashed: boolean
}

/**
 * A token's movement this turn, while it is acting in combat and has a speed;
 * null otherwise (out of combat, not its turn, or no speed written down).
 */
export function moveBudget(token: Player, players: readonly Player[], combat: Combat | undefined): MoveBudget | null {
  const speed = token.stats?.speed
  if (!combat?.turnPlayerId || !speed || speed <= 0) return null
  if (!turnTokenIds(players, combat.turnPlayerId).has(token.id)) return null
  const dashed = combat.dashed?.includes(token.id) ?? false
  return { used: combat.moved?.[token.id] ?? 0, total: speed * (dashed ? 2 : 1), dashed }
}

export function normalizeInitiativeRoll(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.round(value)
}

export function isInitiativeRoll(roll: Pick<DiceRoll, 'title' | 'kind'>): boolean {
  const text = `${roll.title ?? ''} ${roll.kind ?? ''}`.toLowerCase()
  return /\binitiative\b/.test(text)
}

/** Names compared loosely: case and runs of spaces don't matter. */
function sameName(a: string, b: string): boolean {
  const norm = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()
  return norm(a) !== '' && norm(a) === norm(b)
}

/**
 * The token a roll belongs to: the one it names by id, else the one linked to
 * its D&D Beyond character, else the one whose character (or player) has its
 * name. Undefined when none fits.
 */
export function tokenForRoll(
  roll: Pick<DiceRoll, 'character' | 'characterId' | 'tokenId'>,
  players: readonly Player[],
): Player | undefined {
  const tokenId = String(roll.tokenId ?? '').trim()
  if (tokenId) {
    const match = players.find((player) => player.id === tokenId)
    if (match) return match
  }
  const characterId = String(roll.characterId ?? '').trim()
  if (characterId) {
    const match = players.find((player) => player.characterId === characterId)
    if (match) return match
  }
  const name = String(roll.character ?? '')
  return (
    players.find((player) => sameName(player.characterName, name)) ??
    players.find((player) => sameName(player.name, name))
  )
}

/** "Goblin 3" is a Goblin, spawned third; a name with no number is the first. */
function spawnParts(token: Player): { base: string; number: number } {
  const name = nameOf(token).trim().replace(/\s+/g, ' ')
  const match = /^(.*\S)\s+(\d+)$/.exec(name)
  return match ? { base: match[1].toLowerCase(), number: Number(match[2]) } : { base: name.toLowerCase(), number: 1 }
}

/**
 * What kind of monster a token is, going by its name without the spawn number,
 * so every Goblin shares one; null for anything else. Blank "Monster 1"s are
 * left apart, since they are yet to be made into anything.
 */
function monsterType(token: Player): string | null {
  if (token.kind !== 'monster') return null
  const { base } = spawnParts(token)
  return base && base !== 'monster' ? base : null
}

/**
 * Every monster of `token`'s kind, the one holding the group's turn first: one
 * that has rolled, then the earliest spawned. Just the token when it has no kind.
 */
export function initiativeGroup(token: Player, tokens: readonly Player[]): Player[] {
  const type = monsterType(token)
  if (!type) return [token]
  const members = tokens.filter((item) => monsterType(item) === type)
  if (!members.some((item) => item.id === token.id)) members.push(token)
  return members.sort(
    (left, right) =>
      Number(left.initiativeRoll == null) - Number(right.initiativeRoll == null) ||
      spawnParts(left).number - spawnParts(right).number ||
      left.id.localeCompare(right.id),
  )
}

/**
 * Whose turn a token takes instead of its own: a companion's owner, while it
 * follows one still on the map, or the first of a monster's kind, since monsters
 * of a kind all go on one count. Undefined for everyone else, who rolls their own.
 */
export function initiativeLeader(token: Player, tokens: readonly Player[]): Player | undefined {
  if (token.kind === 'monster') {
    const leader = initiativeGroup(token, tokens)[0]
    return leader && leader.id !== token.id ? leader : undefined
  }
  if (token.kind !== 'companion' || !token.followsOwner || !token.ownerId) return undefined
  return tokens.find((item) => item.id === token.ownerId && item.kind !== 'monster' && item.kind !== 'companion')
}

/** The initiative a token goes on: its leader's when it follows one. */
export function initiativeOf(token: Player, tokens: readonly Player[]): number | null {
  return (initiativeLeader(token, tokens) ?? token).initiativeRoll
}

function byInitiative(left: Player, right: Player): number {
  const leftRoll = left.initiativeRoll
  const rightRoll = right.initiativeRoll
  if (leftRoll != null && rightRoll != null && leftRoll !== rightRoll) return rightRoll - leftRoll
  if (leftRoll != null && rightRoll == null) return -1
  if (leftRoll == null && rightRoll != null) return 1
  const leftBonus = initiativeBonus(normalizeStats(left.stats)) ?? 0
  const rightBonus = initiativeBonus(normalizeStats(right.stats)) ?? 0
  if (leftBonus !== rightBonus) return rightBonus - leftBonus
  return nameOf(left).localeCompare(nameOf(right))
}

/** Highest initiative first; a following companion sits right after its owner, a monster after the first of its kind. */
export function sortByInitiative(players: readonly Player[]): Player[] {
  const leaders = new Map(players.map((token) => [token.id, initiativeLeader(token, players)?.id]))
  const followers = players.filter((token) => leaders.get(token.id))
  const ordered = players.filter((token) => !followers.includes(token)).sort(byInitiative)
  if (followers.length === 0) return ordered
  return ordered.flatMap((token) => [
    token,
    ...followers
      .filter((follower) => leaders.get(follower.id) === token.id)
      .sort((left, right) => nameOf(left).localeCompare(nameOf(right), undefined, { numeric: true })),
  ])
}

/** Who shares the turn: the token whose turn it is, and any companions or monsters of its kind that go with it. */
export function turnTokenIds(players: readonly Player[], turnPlayerId: string | null): Set<string> {
  const ids = new Set<string>()
  if (!turnPlayerId) return ids
  ids.add(turnPlayerId)
  for (const token of players) {
    if (initiativeLeader(token, players)?.id === turnPlayerId) ids.add(token.id)
  }
  return ids
}

/** Whose turn is next; following companions and monsters never hold the turn themselves. */
export function nextTurnPlayerId(
  players: readonly Player[],
  currentId: string | null,
): string | null {
  const ordered = sortByInitiative(players).filter((token) => !initiativeLeader(token, players))
  if (ordered.length === 0) return null
  // A token that just started following hands the turn on from its leader's place.
  const current = players.find((token) => token.id === currentId)
  const at = (current && initiativeLeader(current, players)?.id) ?? currentId
  const index = ordered.findIndex((player) => player.id === at)
  return ordered[(index + 1) % ordered.length]?.id ?? ordered[0]?.id ?? null
}
