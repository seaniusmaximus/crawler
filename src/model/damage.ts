/** The damage types of the 5e rules, physical first, then the rest alphabetically. */
export const DAMAGE_TYPES = [
  'bludgeoning',
  'piercing',
  'slashing',
  'acid',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'poison',
  'psychic',
  'radiant',
  'thunder',
] as const

export type DamageType = (typeof DAMAGE_TYPES)[number]

/** "fire" → "Fire", for lists and menus. */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function isDamageType(value: unknown): value is DamageType {
  return (DAMAGE_TYPES as readonly unknown[]).includes(value)
}

/** How a creature takes one type of damage: half, none, or double. */
export type Defense = 'resistant' | 'immune' | 'vulnerable'
export type Defenses = Partial<Record<DamageType, Defense>>

/** The order a damage type's chip steps through when clicked; the last goes back to none. */
export const DEFENSE_CYCLE: readonly Defense[] = ['resistant', 'immune', 'vulnerable']

export const DEFENSE_LABEL: Record<Defense, string> = {
  resistant: 'Resistances',
  immune: 'Immunities',
  vulnerable: 'Vulnerabilities',
}

/** The badge on a chip: what the damage becomes. */
export const DEFENSE_MARK: Record<Defense, string> = {
  resistant: '½',
  immune: '0',
  vulnerable: '×2',
}

export function nextDefense(current: Defense | undefined): Defense | undefined {
  if (!current) return DEFENSE_CYCLE[0]
  return DEFENSE_CYCLE[DEFENSE_CYCLE.indexOf(current) + 1]
}

/** Damage types with this defense, in the usual order. */
export function typesWith(defenses: Defenses, defense: Defense): DamageType[] {
  return DAMAGE_TYPES.filter((type) => defenses[type] === defense)
}

export function normalizeDefenses(value: unknown): Defenses {
  if (!value || typeof value !== 'object') return {}
  const out: Defenses = {}
  for (const [type, defense] of Object.entries(value as Record<string, unknown>)) {
    if (isDamageType(type) && DEFENSE_CYCLE.includes(defense as Defense)) out[type] = defense as Defense
  }
  return out
}
