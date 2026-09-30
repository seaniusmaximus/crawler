export const DIE_FACES = [4, 6, 8, 10, 12, 20, 100] as const
export const MAX_DIE_COUNT = 12
export const MAX_ROLL_LOG = 40

export type DieFace = (typeof DIE_FACES)[number]
export type DiceSource = 'local' | 'ddb'

export interface DieResult {
  faces: number
  value: number
  discarded?: boolean
}

export interface DiceRoll {
  id: string
  source: DiceSource
  character: string
  characterId?: string
  title: string
  formula: string
  total: number
  dice: DieResult[]
  modifier?: number
  kind?: string
  at: number
}

export interface IncomingRoll {
  id?: string
  source?: string
  character?: string
  characterId?: string
  title?: string
  formula?: string
  total?: number
  dice?: Array<{ faces?: number; value?: number; discarded?: boolean }>
  modifier?: number
  kind?: string
  at?: number
}

export function isDieFace(value: number): value is DieFace {
  return (DIE_FACES as readonly number[]).includes(value)
}

export function formatModifier(value: number): string {
  if (!value) return ''
  return value > 0 ? `+${value}` : `${value}`
}

export function rollLocal(count: number, faces: number, modifier: number): DiceRoll {
  const n = Math.max(1, Math.min(MAX_DIE_COUNT, Math.round(count) || 1))
  const sides = Math.max(2, Math.round(faces) || 20)
  const dice: DieResult[] = Array.from({ length: n }, () => ({
    faces: sides,
    value: 1 + Math.floor(Math.random() * sides),
  }))
  const mod = Math.round(modifier) || 0
  const sum = dice.reduce((total, die) => total + die.value, 0)
  return {
    id: newRollId('local'),
    source: 'local',
    character: '',
    title: n === 1 ? `d${sides}` : `${n}d${sides}`,
    formula: `${n}d${sides}${formatModifier(mod)}`,
    total: sum + mod,
    dice,
    modifier: mod || undefined,
    at: Date.now(),
  }
}

export function normalizeRoll(raw: IncomingRoll): DiceRoll | null {
  const dice = (raw.dice ?? [])
    .map((die) => ({
      faces: Number(die.faces) || 0,
      value: Number(die.value) || 0,
      discarded: die.discarded ? true : undefined,
    }))
    .filter((die) => die.faces > 0)
  const modifier = finiteNumber(raw.modifier)
  const total = finiteNumber(raw.total)
  const formula = String(raw.formula ?? '').trim()
  if (total == null && !formula && dice.length === 0) return null

  const kept = dice.filter((die) => !die.discarded)
  const inferred =
    total ??
    kept.reduce((sum, die) => sum + die.value, 0) + (modifier ?? 0)

  return {
    id: String(raw.id || newRollId(raw.source === 'local' ? 'local' : 'ddb')),
    source: raw.source === 'local' ? 'local' : 'ddb',
    character: String(raw.character ?? '').trim(),
    characterId: String(raw.characterId ?? '').trim() || undefined,
    title: String(raw.title ?? '').trim() || formula || 'Roll',
    formula: formula || buildFormula(dice, modifier),
    total: inferred,
    dice,
    modifier: modifier ?? undefined,
    kind: String(raw.kind ?? '').trim() || undefined,
    at: finiteNumber(raw.at) ?? Date.now(),
  }
}

export function sameRoll(left: DiceRoll, right: DiceRoll): boolean {
  if (left.id && right.id && left.id === right.id) return true
  return (
    left.source === right.source &&
    left.character === right.character &&
    left.formula === right.formula &&
    left.total === right.total &&
    left.title === right.title &&
    Math.abs(left.at - right.at) < 2500
  )
}

export function rollAccent(roll: DiceRoll): 'crit' | 'fumble' | null {
  const d20s = roll.dice.filter((die) => die.faces === 20 && !die.discarded)
  if (d20s.some((die) => die.value === 20)) return 'crit'
  if (d20s.some((die) => die.value === 1)) return 'fumble'
  return null
}

function buildFormula(dice: DieResult[], modifier: number | null): string {
  const groups = new Map<number, number>()
  for (const die of dice) {
    groups.set(die.faces, (groups.get(die.faces) ?? 0) + 1)
  }
  const body = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([faces, count]) => `${count}d${faces}`)
    .join('+')
  // A roll reported by total alone (the D&D Beyond notification) has no dice to describe.
  if (!body) return ''
  return `${body}${formatModifier(modifier ?? 0)}`
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function newRollId(prefix: string): string {
  const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  return `${prefix}:${nonce}`
}
