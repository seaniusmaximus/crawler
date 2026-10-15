import { DAMAGE_FACES } from './attacks.ts'
import { MAX_DIE_COUNT, formatModifier, isDieFace } from './dice.ts'
import { ABILITY_KEYS, ABILITY_LABEL, displayedAbilityMod, type AbilityKey, type CharacterStats } from './stats.ts'
import { isStatusId, type StatusId } from './status.ts'

/**
 * How a creature casts, shared by all its spells, as a stat block's
 * Spellcasting trait has it: one ability, plus a bonus (its proficiency, and
 * anything else). Save DC is 8 + modifier + bonus; spell attacks add modifier + bonus.
 */
export interface Spellcasting {
  ability: AbilityKey
  bonus: number
}

/**
 * How a spell lands: the target saves against the caster's DC, the caster
 * makes a spell attack, or it simply happens (Misty Step, Shield).
 */
export type SpellResolve = 'save' | 'attack' | 'auto'

/** What a successful save does to a save spell's damage. */
export type OnSave = 'half' | 'none'

export interface Spell {
  id: string
  name: string
  /** 0 is a cantrip. */
  level: number
  resolve: SpellResolve
  /** The ability the target saves with; only for save spells. */
  save: AbilityKey
  onSave: OnSave
  /** Damage dice; a count of 0 means the spell does no damage. */
  count: number
  faces: number
  /** Added to damage, as some spells add the caster's modifier. */
  damageBonus: number
  /** A damage type (see damage.ts), "healing", or the DM's own words; empty for none. */
  type: string
  /** A condition the spell imposes (on a failed save, for save spells); null for none. */
  condition: StatusId | null
  /** Anything else worth a glance: area, duration, concentration. */
  notes: string
  /** Casts a day; null is at will. */
  perDay: number | null
  /** Casts spent today, out of `perDay`. */
  used: number
}

export const MAX_SPELLS = 20
export const MAX_SPELL_NAME = 40
export const MAX_SPELL_NOTES = 1000
export const MAX_SPELL_TYPE = 24
export const MAX_PER_DAY = 9
const MAX_BONUS = 50

export const SPELL_RESOLVE_LABEL: Record<SpellResolve, string> = {
  save: 'Saving throw',
  attack: 'Spell attack',
  auto: 'No roll',
}

/** Proficiency +2 on the creature's INT: a sensible start that the DM changes in two clicks. */
export function defaultSpellcasting(): Spellcasting {
  return { ability: 'int', bonus: 2 }
}

/** A fresh spell: a 1st-level DEX save that halves its damage, the most common shape there is. */
export function newSpell(): Spell {
  return {
    id: crypto.randomUUID(),
    name: 'Spell',
    level: 1,
    resolve: 'save',
    save: 'dex',
    onSave: 'half',
    count: 2,
    faces: 6,
    damageBonus: 0,
    type: 'fire',
    condition: null,
    notes: '',
    perDay: null,
    used: 0,
  }
}

export function castingMod(casting: Spellcasting, stats: CharacterStats): number {
  return displayedAbilityMod(stats, casting.ability) ?? 0
}

/** 8 + the casting ability's modifier + the bonus. */
export function saveDc(casting: Spellcasting, stats: CharacterStats): number {
  return 8 + castingMod(casting, stats) + casting.bonus
}

/** What's added to a spell attack's d20. */
export function spellAttackBonus(casting: Spellcasting, stats: CharacterStats): number {
  return castingMod(casting, stats) + casting.bonus
}

export function hasDamage(spell: Spell): boolean {
  return spell.count > 0
}

export function spellDamageFormula(spell: Spell): string {
  return `${spell.count}d${spell.faces}${formatModifier(spell.damageBonus)}`
}

/** "Cantrip", "1st level", "3rd level". */
export function levelLabel(level: number): string {
  if (level === 0) return 'Cantrip'
  const suffix = level === 1 ? 'st' : level === 2 ? 'nd' : level === 3 ? 'rd' : 'th'
  return `${level}${suffix} level`
}

/** "DC 13 DEX", "+5 to hit", or null when there's nothing to roll against. */
export function resolveLabel(spell: Spell, casting: Spellcasting, stats: CharacterStats): string | null {
  if (spell.resolve === 'save') return `DC ${saveDc(casting, stats)} ${ABILITY_LABEL[spell.save]}`
  if (spell.resolve === 'attack') return `${formatModifier(spellAttackBonus(casting, stats)) || '+0'} to hit`
  return null
}

export function normalizeSpellcasting(value: unknown): Spellcasting {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const fallback = defaultSpellcasting()
  return {
    ability: ABILITY_KEYS.find((key) => key === raw.ability) ?? fallback.ability,
    bonus: clampInt(raw.bonus, -MAX_BONUS, MAX_BONUS, fallback.bonus),
  }
}

/** Spells read from somewhere untrusted (a save file, the network, storage), made safe. */
export function normalizeSpells(value: unknown): Spell[] {
  if (!Array.isArray(value)) return []
  const spells: Spell[] = []
  for (const item of value.slice(0, MAX_SPELLS)) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const faces = Number(raw.faces)
    const perDay = raw.perDay == null ? null : clampInt(raw.perDay, 1, MAX_PER_DAY, 1)
    spells.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : crypto.randomUUID(),
      name: (typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_SPELL_NAME) : '') || 'Spell',
      level: clampInt(raw.level, 0, 9, 1),
      resolve: raw.resolve === 'attack' || raw.resolve === 'auto' ? raw.resolve : 'save',
      save: ABILITY_KEYS.find((key) => key === raw.save) ?? 'dex',
      onSave: raw.onSave === 'none' ? 'none' : 'half',
      count: clampInt(raw.count, 0, MAX_DIE_COUNT, 0),
      faces: isDieFace(faces) && (DAMAGE_FACES as readonly number[]).includes(faces) ? faces : 6,
      damageBonus: clampInt(raw.damageBonus, -MAX_BONUS, MAX_BONUS, 0),
      type: typeof raw.type === 'string' ? raw.type.trim().slice(0, MAX_SPELL_TYPE) : '',
      condition: typeof raw.condition === 'string' && isStatusId(raw.condition) ? raw.condition : null,
      notes: typeof raw.notes === 'string' ? raw.notes.trim().slice(0, MAX_SPELL_NOTES) : '',
      perDay,
      used: perDay == null ? 0 : clampInt(raw.used, 0, perDay, 0),
    })
  }
  return spells
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
}
