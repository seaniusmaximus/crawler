import { attackToHit, damageModifier, saveLabel, type Attack } from '../../model/attacks.ts'
import { initiativeLeader } from '../../model/combat.ts'
import { characterNameOf } from '../../model/players.ts'
import { normalizeSpellcasting, saveDc, spellAttackBonus, type Spell } from '../../model/spells.ts'
import { ABILITY_LABEL, initiativeBonus, normalizeStats, type AbilityKey } from '../../model/stats.ts'
import type { Player } from '../../model/types.ts'
import { requestRoll } from '../../state/diceStore.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'

const ABILITY_NAME: Record<AbilityKey, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
}

/** Rolls 1d20 + bonus for a token into the shared dice log (by the table's relay when connected). */
function rollD20For(token: Player, bonus: number, title: string, kind: string): void {
  requestRoll({
    count: 1,
    faces: 20,
    modifier: bonus,
    title,
    kind,
    character: characterNameOf(token),
    characterId: token.characterId ?? undefined,
    tokenId: token.id,
  })
}

/** Rolls initiative for every token that has not rolled yet, except companions going on their owner's. */
export function rollInitiativeFor(tokens: readonly Player[]): void {
  const everyone = useDungeonStore.getState().dungeon.players ?? []
  for (const token of tokens) {
    if (token.initiativeRoll != null || initiativeLeader(token, everyone)) continue
    rollD20For(token, initiativeBonus(normalizeStats(token.stats)) ?? 0, 'Initiative', 'initiative')
  }
}

/** An ability check: 1d20 plus that ability's modifier. */
export function rollAbilityCheck(token: Player, ability: AbilityKey, modifier: number): void {
  rollD20For(token, modifier, `${ABILITY_NAME[ability]} check`, 'check')
}

/** An attack roll: 1d20 plus the attack's ability modifier and any extra to hit. */
export function rollAttack(token: Player, attack: Attack): void {
  rollD20For(token, attackToHit(attack, normalizeStats(token.stats)), `${attack.name} to hit`, 'attack')
}

/** A spell attack: 1d20 plus the caster's spell attack bonus. */
export function rollSpellAttack(token: Player, spell: Spell): void {
  const casting = normalizeSpellcasting(token.spellcasting)
  rollD20For(token, spellAttackBonus(casting, normalizeStats(token.stats)), `${spell.name} spell attack`, 'attack')
}

/**
 * A spell's damage (or healing). For a save spell the log says what to save
 * against, so the table sees "Fireball (DC 13 DEX, half)" beside the number.
 */
export function rollSpellDamage(token: Player, spell: Spell): void {
  const stats = normalizeStats(token.stats)
  const casting = normalizeSpellcasting(token.spellcasting)
  const healing = spell.type.toLowerCase() === 'healing'
  const title =
    spell.resolve === 'save'
      ? `${spell.name} (DC ${saveDc(casting, stats)} ${ABILITY_LABEL[spell.save]}${spell.onSave === 'half' ? ', half' : ''})`
      : `${spell.name} ${healing ? 'healing' : 'damage'}`
  requestRoll({
    count: spell.count,
    faces: spell.faces,
    modifier: spell.damageBonus,
    title,
    kind: healing ? 'healing' : 'damage',
    character: characterNameOf(token),
    characterId: token.characterId ?? undefined,
    tokenId: token.id,
  })
}

/**
 * An attack's damage, with the ability modifier it names taken from the token's
 * current stats. Each extra damage type is rolled on its own, since a target
 * can resist one type and not another.
 */
export function rollDamage(token: Player, attack: Attack): void {
  const parts = [
    { count: attack.count, faces: attack.faces, bonus: damageModifier(attack, normalizeStats(token.stats)), type: attack.type },
    ...attack.extra,
  ]
  for (const part of parts) {
    requestRoll({
      count: part.count,
      faces: part.faces,
      modifier: part.bonus,
      title: part.type ? `${attack.name} damage (${part.type})` : `${attack.name} damage`,
      kind: 'damage',
      character: characterNameOf(token),
      characterId: token.characterId ?? undefined,
      tokenId: token.id,
    })
  }
}

/** The damage of the save a hit forces, titled with what to save against: "Bite poison (DC 11 CON, half)". */
export function rollSaveDamage(token: Player, attack: Attack): void {
  const save = attack.save
  if (!save || save.count === 0) return
  requestRoll({
    count: save.count,
    faces: save.faces,
    modifier: save.bonus,
    title: `${attack.name}${save.type ? ` ${save.type}` : ''} (${saveLabel(save)}${save.onSave === 'half' ? ', half' : ''})`,
    kind: 'damage',
    character: characterNameOf(token),
    characterId: token.characterId ?? undefined,
    tokenId: token.id,
  })
}
