export const STATUS_IDS = [
  'blinded',
  'charmed',
  'deafened',
  'exhausted',
  'grappled',
  'invisible',
  'prone',
  'stunned',
  'unconscious',
  'restrained',
  'paralyzed',
  'poisoned',
  'incapacitated',
  'petrified',
  'frightened',
  'concentrating',
] as const

export type StatusId = (typeof STATUS_IDS)[number]

export interface StatusEffect {
  id: StatusId
  label: string
  color: string
}

export const STATUS_EFFECTS: readonly StatusEffect[] = [
  { id: 'blinded', label: 'Blinded', color: '#94a3b8' },
  { id: 'charmed', label: 'Charmed', color: '#f472b6' },
  { id: 'deafened', label: 'Deafened', color: '#7dd3fc' },
  { id: 'exhausted', label: 'Exhausted', color: '#d6b07c' },
  { id: 'grappled', label: 'Grappled', color: '#fb923c' },
  { id: 'invisible', label: 'Invisible', color: '#c4b5fd' },
  { id: 'prone', label: 'Prone', color: '#facc15' },
  { id: 'stunned', label: 'Stunned', color: '#fde68a' },
  { id: 'unconscious', label: 'Unconscious', color: '#60a5fa' },
  { id: 'restrained', label: 'Restrained', color: '#f59e0b' },
  { id: 'paralyzed', label: 'Paralyzed', color: '#c084fc' },
  { id: 'poisoned', label: 'Poisoned', color: '#4ade80' },
  { id: 'incapacitated', label: 'Incapacitated', color: '#a1a1aa' },
  { id: 'petrified', label: 'Petrified', color: '#a8a29e' },
  { id: 'frightened', label: 'Frightened', color: '#f87171' },
  // Not a condition: holding a concentration spell. A spell area tied to it ends when it goes.
  { id: 'concentrating', label: 'Concentrating', color: '#38bdf8' },
]

/** The statuses a spell or attack can put on a target: everything but concentrating, which is the caster's own. */
export const CONDITION_EFFECTS: readonly StatusEffect[] = STATUS_EFFECTS.filter((item) => item.id !== 'concentrating')

const BY_ID = new Map(STATUS_EFFECTS.map((item) => [item.id, item]))

export function isStatusId(value: string): value is StatusId {
  return BY_ID.has(value as StatusId)
}

export function statusEffect(id: StatusId): StatusEffect {
  return BY_ID.get(id) ?? { id, label: id, color: '#e8c468' }
}

export function uniqueStatuses(ids: readonly string[] | undefined): StatusId[] {
  const seen = new Set<StatusId>()
  for (const id of ids ?? []) {
    if (isStatusId(id)) seen.add(id)
  }
  return STATUS_IDS.filter((id) => seen.has(id))
}
