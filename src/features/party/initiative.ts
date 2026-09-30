import { rollLocal } from '../../model/dice.ts'
import { characterNameOf } from '../../model/players.ts'
import { normalizeStats } from '../../model/stats.ts'
import type { Player } from '../../model/types.ts'
import { useDiceStore } from '../../state/diceStore.ts'

/** Rolls initiative for every token that has not rolled yet. */
export function rollInitiativeFor(tokens: readonly Player[]): void {
  for (const token of tokens) {
    if (token.initiativeRoll != null) continue
    const bonus = normalizeStats(token.stats).initiative ?? 0
    const roll = rollLocal(1, 20, bonus)
    useDiceStore.getState().ingest({
      ...roll,
      title: 'Initiative',
      kind: 'initiative',
      character: characterNameOf(token),
      characterId: token.characterId ?? undefined,
    })
  }
}
