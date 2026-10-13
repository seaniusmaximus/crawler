import type { DiceRoll } from './dice.ts'
import { initiativeBonus, normalizeStats } from './stats.ts'
import type { Player } from './types.ts'

function nameOf(player: Player): string {
  const named = player.characterName?.trim()
  return named ? named : player.name
}

export interface Combat {
  turnPlayerId: string | null
}

export function emptyCombat(): Combat {
  return { turnPlayerId: null }
}

export function normalizeCombat(value: unknown): Combat {
  const raw = value && typeof value === 'object' ? (value as Combat) : emptyCombat()
  const id = typeof raw.turnPlayerId === 'string' ? raw.turnPlayerId.trim() : ''
  return { turnPlayerId: id || null }
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

/**
 * The party member a companion takes its turn with: its owner, while it follows
 * one still on the map. Undefined for everyone else, who rolls their own.
 */
export function initiativeLeader(token: Player, tokens: readonly Player[]): Player | undefined {
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

/** Highest initiative first; a following companion sits right after its owner. */
export function sortByInitiative(players: readonly Player[]): Player[] {
  const followers = players.filter((token) => initiativeLeader(token, players))
  const ordered = players.filter((token) => !followers.includes(token)).sort(byInitiative)
  if (followers.length === 0) return ordered
  return ordered.flatMap((token) => [
    token,
    ...followers
      .filter((follower) => follower.ownerId === token.id)
      .sort((left, right) => nameOf(left).localeCompare(nameOf(right))),
  ])
}

/** Who shares the turn: the token whose turn it is, and any companions that follow it. */
export function turnTokenIds(players: readonly Player[], turnPlayerId: string | null): Set<string> {
  const ids = new Set<string>()
  if (!turnPlayerId) return ids
  ids.add(turnPlayerId)
  for (const token of players) {
    if (initiativeLeader(token, players)?.id === turnPlayerId) ids.add(token.id)
  }
  return ids
}

/** Whose turn is next; following companions never hold the turn themselves. */
export function nextTurnPlayerId(
  players: readonly Player[],
  currentId: string | null,
): string | null {
  const ordered = sortByInitiative(players).filter((token) => !initiativeLeader(token, players))
  if (ordered.length === 0) return null
  // A companion that just started following hands the turn on from its owner's place.
  const current = players.find((token) => token.id === currentId)
  const at = (current && initiativeLeader(current, players)?.id) ?? currentId
  const index = ordered.findIndex((player) => player.id === at)
  return ordered[(index + 1) % ordered.length]?.id ?? ordered[0]?.id ?? null
}
