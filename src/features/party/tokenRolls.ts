import { rollLocal } from '../../model/dice.ts'
import { characterNameOf } from '../../model/players.ts'
import { normalizeStats, type AbilityKey } from '../../model/stats.ts'
import type { Player } from '../../model/types.ts'
import { useDiceStore } from '../../state/diceStore.ts'

const ABILITY_NAME: Record<AbilityKey, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
}

/** Rolls 1d20 + bonus for a token into the shared dice log, which syncs it to the table. */
function rollD20For(token: Player, bonus: number, title: string, kind: string): void {
  const roll = rollLocal(1, 20, bonus)
  useDiceStore.getState().ingest({
    ...roll,
    title,
    kind,
    character: characterNameOf(token),
    characterId: token.characterId ?? undefined,
  })
}

/** Rolls initiative for every token that has not rolled yet. */
export function rollInitiativeFor(tokens: readonly Player[]): void {
  for (const token of tokens) {
    if (token.initiativeRoll != null) continue
    rollD20For(token, normalizeStats(token.stats).initiative ?? 0, 'Initiative', 'initiative')
  }
}

/** An ability check: 1d20 plus that ability's modifier. */
export function rollAbilityCheck(token: Player, ability: AbilityKey, modifier: number): void {
  rollD20For(token, modifier, `${ABILITY_NAME[ability]} check`, 'check')
}
