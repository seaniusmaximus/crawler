import { MAX_DIE_COUNT, formatModifier, isDieFace } from './dice.ts'
import { ABILITY_KEYS, ABILITY_LABEL, displayedAbilityMod, type AbilityKey, type CharacterStats } from './stats.ts'

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
}

export const MAX_ATTACKS = 12
export const MAX_ATTACK_NAME = 40
export const MAX_DAMAGE_TYPE = 24
/** Faces offered for damage dice, as on the dice tray. */
export const DAMAGE_FACES = [4, 6, 8, 10, 12, 20] as const
/** Matches the relay's own modifier limit, so a roll is never clamped on the way out. */
export const MAX_ATTACK_BONUS = 50

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
  }
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
      type: typeof raw.type === 'string' ? raw.type.trim().slice(0, MAX_DAMAGE_TYPE) : '',
    })
  }
  return attacks
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
}
