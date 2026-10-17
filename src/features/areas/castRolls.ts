import { areaSide, areaCellsOn, standsIn } from '../../model/areaEffects.ts'
import { isEnemyOf, type AreaAffects, type AreaMark, type PlacedArea } from '../../model/marks.ts'
import { characterNameOf, playerSize } from '../../model/players.ts'
import { ABILITY_LABEL, displayedAbilityMod, normalizeStats, type AbilityKey } from '../../model/stats.ts'
import { statusEffect, type StatusId } from '../../model/status.ts'
import type { Player } from '../../model/types.ts'
import { damageTag, effectId, rollTitle, saveTag, type EffectPlan } from '../../model/effects.ts'
import { requestRoll } from '../../state/diceStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'

/**
 * What a spell does to the creatures in its area as it is cast (Fireball,
 * Thunderwave, Mass Cure Wounds): who it takes in, the save each makes against
 * it, and the damage or healing rolled once for all of them.
 */
export interface CastRoll {
  spell: string
  casterId: string
  affects: AreaAffects
  save: { ability: AbilityKey; dc: number; onSave: 'half' | 'none' } | null
  /** Dice rolled once for everyone it takes in; null for a spell that only imposes its save or condition. */
  dice: { count: number; faces: number; bonus: number; type: string } | null
  condition: StatusId | null
}

/** How long an instant spell's area (Fireball's burst) stays on the map once it has gone off. */
export const INSTANT_AREA_MS = 4000

/**
 * The creatures a spell's area takes in as it lands: those standing in it (by
 * any of their squares) among `players` (what the caster can see on its floor),
 * of whichever side it takes in. The caster is caught in their own blast like
 * anyone else, unless it spares allies.
 */
export function castTargets(area: AreaMark, roll: CastRoll, players: readonly Player[]): Player[] {
  const caster = players.find((player) => player.id === roll.casterId)
  const side = area.side ?? areaSide(caster, 'dm')
  const cells = areaCellsOn({ ...area, id: area.id ?? 'cast', color: area.color ?? 'red', owner: '' } as PlacedArea, players, area.floorId)
  if (!cells) return []
  return players.filter((token) => {
    if (token.floorId !== area.floorId || !standsIn(cells, token.x, token.y, playerSize(token))) return false
    if (roll.affects === 'all') return true
    const enemy = isEnemyOf(side, token)
    return roll.affects === 'enemies' ? enemy : !enemy
  })
}

/**
 * Roll a spell going off over its area: each creature caught in it saves, and
 * the damage (or healing) is rolled once, under the caster, naming who it hits.
 * Nothing is rolled when it catches no one.
 */
export function rollCast(area: AreaMark, roll: CastRoll, players: readonly Player[]): void {
  const targets = castTargets(area, roll, players)
  if (targets.length === 0) return
  const caster = players.find((player) => player.id === roll.casterId)
  const healing = roll.dice?.type.toLowerCase() === 'healing'
  const failing = roll.condition ? `, or ${statusEffect(roll.condition).label.toLowerCase()}` : ''
  const saveTitle = roll.save ? `${ABILITY_LABEL[roll.save.ability]} save vs ${roll.spell} (DC ${roll.save.dc}${failing})` : undefined
  const names = targets.map(characterNameOf).join(', ')
  const onSave = roll.save && !healing ? (roll.save.onSave === 'half' ? ', half on save' : ', none on save') : ''
  const what = healing ? 'healing' : `${roll.dice?.type ? `${roll.dice.type} ` : ''}damage`
  const damageTitle = roll.dice ? `${roll.spell} ${what} → ${names}${onSave}` : undefined
  // The DM's browser applies what the rolls come to, once they are all in.
  const plan: EffectPlan = {
    id: effectId(),
    name: roll.spell,
    targets: targets.map((token) => token.id),
    save: roll.save,
    damage: roll.dice && !healing ? { type: roll.dice.type } : null,
    healing,
    condition: roll.condition,
    ...(saveTitle ? { saveTitle: rollTitle(saveTitle) } : {}),
    ...(damageTitle ? { damageTitle: rollTitle(damageTitle) } : {}),
  }
  useSessionStore.getState().reportEffect(plan)
  if (roll.save && saveTitle) {
    for (const token of targets) {
      requestRoll({
        count: 1,
        faces: 20,
        modifier: displayedAbilityMod(normalizeStats(token.stats), roll.save.ability) ?? 0,
        title: saveTitle,
        kind: 'save',
        effect: saveTag(plan, token.id),
        character: characterNameOf(token),
        characterId: token.characterId ?? undefined,
        tokenId: token.id,
      })
    }
  }
  if (roll.dice && damageTitle) {
    requestRoll({
      count: roll.dice.count,
      faces: roll.dice.faces,
      modifier: roll.dice.bonus,
      title: damageTitle,
      kind: healing ? 'healing' : 'damage',
      effect: damageTag(plan),
      ...(caster
        ? { character: characterNameOf(caster), characterId: caster.characterId ?? undefined, tokenId: caster.id }
        : {}),
    })
  }
}
