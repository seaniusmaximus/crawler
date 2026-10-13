import { MAX_DIE_COUNT, formatModifier, isDieFace } from './dice.ts'
import type { OnSave } from './spells.ts'
import { ABILITY_KEYS, ABILITY_LABEL, displayedAbilityMod, type AbilityKey, type CharacterStats } from './stats.ts'
import { isStatusId, type StatusId } from './status.ts'

/**
 * One of a token's attacks. Its ability is where both bonuses come from, as in
 * the rules: to hit is d20 + the ability's modifier + `hitBonus` (proficiency,
 * a magic weapon), and damage is `count`d`faces` + the same modifier + `damageBonus`.
 * The modifier is looked up when rolled, so changing STR changes the attack.
 */
export interface Attack {
  id: string
  name: string
  /** Ability whose modifier is added to hit and to damage; null for none. */
  ability: AbilityKey | null
  /** Added to hit on top of the ability's modifier. */
  hitBonus: number
  count: number
  faces: number
  /** Added to damage on top of the ability's modifier. */
  damageBonus: number
  /** A damage type (see damage.ts), or the DM's own words; empty for none. */
  type: string
  /** More damage the hit deals, each of its own type: a bite's "plus 2d6 poison". */
  extra: DamagePart[]
  /** A saving throw the hit forces as well; null for none. */
  save: AttackSave | null
}

/** Dice of one damage type, with a flat bonus and no ability modifier. */
export interface DamagePart {
  id: string
  count: number
  faces: number
  bonus: number
  type: string
}

/**
 * A save a hit forces, as stat blocks write it: "DC 11 CON saving throw or take
 * 2d6 poison damage and be poisoned". The DC is the stat block's own number.
 */
export interface AttackSave {
  dc: number
  ability: AbilityKey
  /** Damage on a failed save; a count of 0 means none. */
  count: number
  faces: number
  bonus: number
  type: string
  onSave: OnSave
  /** A condition imposed on a failed save; null for none. */
  condition: StatusId | null
  /** Anything a condition doesn't cover: "pushed 10 ft", "until the end of its next turn". */
  notes: string
}

export const MAX_ATTACKS = 12
export const MAX_ATTACK_NAME = 40
export const MAX_DAMAGE_TYPE = 24
/** Faces offered for damage dice, as on the dice tray. */
export const DAMAGE_FACES = [4, 6, 8, 10, 12, 20] as const
/** Matches the relay's own modifier limit, so a roll is never clamped on the way out. */
export const MAX_ATTACK_BONUS = 50
/** Extra damage types on one attack; stat blocks rarely go past two. */
export const MAX_EXTRA_DAMAGE = 3
export const MIN_SAVE_DC = 1
export const MAX_SAVE_DC = 30
export const MAX_SAVE_NOTES = 120

/** A fresh attack: a STR weapon doing 1d6, the most common shape there is. */
export function newAttack(): Attack {
  return {
    id: crypto.randomUUID(),
    name: 'Attack',
    ability: 'str',
    hitBonus: 0,
    count: 1,
    faces: 6,
    damageBonus: 0,
    type: 'slashing',
    extra: [],
    save: null,
  }
}

/** A fresh extra damage part: the 1d6 of fire a flaming weapon adds. */
export function newDamagePart(): DamagePart {
  return { id: crypto.randomUUID(), count: 1, faces: 6, bonus: 0, type: 'fire' }
}

/** A fresh save: DC 12 CON or be poisoned, the most common rider there is. */
export function newAttackSave(): AttackSave {
  return {
    dc: 12,
    ability: 'con',
    count: 0,
    faces: 6,
    bonus: 0,
    type: 'poison',
    onSave: 'half',
    condition: 'poisoned',
    notes: '',
  }
}

/** "2d6+1": dice plus a flat bonus. */
export function partFormula(part: Pick<DamagePart, 'count' | 'faces' | 'bonus'>): string {
  return `${part.count}d${part.faces}${formatModifier(part.bonus)}`
}

/** "DC 11 CON". */
export function saveLabel(save: Pick<AttackSave, 'dc' | 'ability'>): string {
  return `DC ${save.dc} ${ABILITY_LABEL[save.ability]}`
}

/** The ability's modifier for this token; 0 when it names none or the score isn't set. */
export function attackAbilityMod(attack: Pick<Attack, 'ability'>, stats: CharacterStats): number {
  return attack.ability ? (displayedAbilityMod(stats, attack.ability) ?? 0) : 0
}

/** The whole bonus to hit: ability modifier plus any extra. */
export function attackToHit(attack: Attack, stats: CharacterStats): number {
  return attackAbilityMod(attack, stats) + attack.hitBonus
}

/** What's added to the damage dice: ability modifier plus any extra. */
export function damageModifier(attack: Attack, stats: CharacterStats): number {
  return attackAbilityMod(attack, stats) + attack.damageBonus
}

/** Damage as rolled for this token: "4d6+3". */
export function damageFormula(attack: Attack, stats: CharacterStats): string {
  return `${attack.count}d${attack.faces}${formatModifier(damageModifier(attack, stats))}`
}

/** How a bonus adds up, for tooltips: "STR +3 + 2". */
export function bonusBreakdown(attack: Pick<Attack, 'ability'>, extra: number, stats: CharacterStats): string {
  const parts: string[] = []
  if (attack.ability) {
    const mod = displayedAbilityMod(stats, attack.ability)
    parts.push(`${ABILITY_LABEL[attack.ability]} ${mod == null ? '(not set)' : formatModifier(mod) || '+0'}`)
  }
  if (extra || parts.length === 0) parts.push(`${extra >= 0 ? '+' : '−'} ${Math.abs(extra)}`)
  return parts.join(' ')
}

/** Attacks read from somewhere untrusted (a save file, the network, storage), made safe. */
export function normalizeAttacks(value: unknown): Attack[] {
  if (!Array.isArray(value)) return []
  const attacks: Attack[] = []
  for (const item of value.slice(0, MAX_ATTACKS)) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const faces = Number(raw.faces)
    attacks.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : crypto.randomUUID(),
      name: (typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_ATTACK_NAME) : '') || 'Attack',
      ability: ABILITY_KEYS.find((key) => key === raw.ability) ?? null,
      hitBonus: clampInt(raw.hitBonus, -MAX_ATTACK_BONUS, MAX_ATTACK_BONUS, 0),
      count: clampInt(raw.count, 1, MAX_DIE_COUNT, 1),
      faces: isDieFace(faces) ? faces : 6,
      damageBonus: clampInt(raw.damageBonus, -MAX_ATTACK_BONUS, MAX_ATTACK_BONUS, 0),
      type: damageTypeOf(raw.type),
      extra: Array.isArray(raw.extra) ? raw.extra.slice(0, MAX_EXTRA_DAMAGE).flatMap(normalizePart) : [],
      save: normalizeSave(raw.save),
    })
  }
  return attacks
}

function normalizePart(value: unknown): DamagePart[] {
  if (!value || typeof value !== 'object') return []
  const raw = value as Record<string, unknown>
  return [
    {
      id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : crypto.randomUUID(),
      count: clampInt(raw.count, 1, MAX_DIE_COUNT, 1),
      faces: damageFacesOf(raw.faces),
      bonus: clampInt(raw.bonus, -MAX_ATTACK_BONUS, MAX_ATTACK_BONUS, 0),
      type: damageTypeOf(raw.type),
    },
  ]
}

function normalizeSave(value: unknown): AttackSave | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  return {
    dc: clampInt(raw.dc, MIN_SAVE_DC, MAX_SAVE_DC, 12),
    ability: ABILITY_KEYS.find((key) => key === raw.ability) ?? 'con',
    count: clampInt(raw.count, 0, MAX_DIE_COUNT, 0),
    faces: damageFacesOf(raw.faces),
    bonus: clampInt(raw.bonus, -MAX_ATTACK_BONUS, MAX_ATTACK_BONUS, 0),
    type: damageTypeOf(raw.type),
    onSave: raw.onSave === 'none' ? 'none' : 'half',
    condition: typeof raw.condition === 'string' && isStatusId(raw.condition) ? raw.condition : null,
    notes: typeof raw.notes === 'string' ? raw.notes.trim().slice(0, MAX_SAVE_NOTES) : '',
  }
}

function damageFacesOf(value: unknown): number {
  const faces = Number(value)
  return isDieFace(faces) && (DAMAGE_FACES as readonly number[]).includes(faces) ? faces : 6
}

function damageTypeOf(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_DAMAGE_TYPE) : ''
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
}
