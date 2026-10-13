/** Special senses a creature may have, each reaching some number of feet. */
export const SENSES = ['darkvision', 'blindsight', 'tremorsense', 'truesight'] as const
export type Sense = (typeof SENSES)[number]
export type Senses = Partial<Record<Sense, number>>

export const SENSE_LABEL: Record<Sense, string> = {
  darkvision: 'Darkvision',
  blindsight: 'Blindsight',
  tremorsense: 'Tremorsense',
  truesight: 'Truesight',
}

export const SENSE_HINT: Record<Sense, string> = {
  darkvision: 'Sees in darkness as if it were dim light',
  blindsight: 'Perceives its surroundings without sight',
  tremorsense: 'Feels movement through the ground',
  truesight: 'Sees through darkness, invisibility and illusions',
}

/** The ranges stat blocks almost always use, offered as one-click choices. */
export const SENSE_PRESETS = [30, 60, 120] as const

export const MAX_SENSE_RANGE = 1000

/** A range as kept: whole feet, or undefined for none. */
export function cleanRange(value: unknown): number | undefined {
  const feet = Math.round(Number(value))
  return Number.isFinite(feet) && feet > 0 ? Math.min(MAX_SENSE_RANGE, feet) : undefined
}

export function normalizeSenses(value: unknown): Senses {
  if (!value || typeof value !== 'object') return {}
  const raw = value as Record<string, unknown>
  const out: Senses = {}
  for (const sense of SENSES) {
    const range = cleanRange(raw[sense])
    if (range) out[sense] = range
  }
  return out
}

/** "darkvision 60 ft., tremorsense 30 ft." */
export function formatSenses(senses: Senses): string {
  return SENSES.filter((sense) => senses[sense])
    .map((sense) => `${SENSE_LABEL[sense].toLowerCase()} ${senses[sense]} ft.`)
    .join(', ')
}
