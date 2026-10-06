import type { DiceRoll } from './dice.ts'
import { normalizeStats } from './stats.ts'
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

export function sortByInitiative(players: readonly Player[]): Player[] {
  return [...players].sort((left, right) => {
    const leftRoll = left.initiativeRoll
    const rightRoll = right.initiativeRoll
    if (leftRoll != null && rightRoll != null && leftRoll !== rightRoll) return rightRoll - leftRoll
    if (leftRoll != null && rightRoll == null) return -1
    if (leftRoll == null && rightRoll != null) return 1
    const leftBonus = normalizeStats(left.stats).initiative ?? 0
    const rightBonus = normalizeStats(right.stats).initiative ?? 0
    if (leftBonus !== rightBonus) return rightBonus - leftBonus
    return nameOf(left).localeCompare(nameOf(right))
  })
}

export function nextTurnPlayerId(
  players: readonly Player[],
  currentId: string | null,
): string | null {
  if (players.length === 0) return null
  const ordered = sortByInitiative(players)
  const index = ordered.findIndex((player) => player.id === currentId)
  return ordered[(index + 1) % ordered.length]?.id ?? ordered[0]?.id ?? null
}
