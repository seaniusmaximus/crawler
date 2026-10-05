export const DIE_FACES = [4, 6, 8, 10, 12, 20, 100] as const
export const MAX_DIE_COUNT = 12
export const MAX_ROLL_LOG = 40

export type DieFace = (typeof DIE_FACES)[number]
/**
 * Where a roll came from: 'table' rolls are made by the relay when you're at a
 * table (nobody's browser chooses them), 'local' ones in this browser when
 * you're not, and 'ddb' ones arrive from a D&D Beyond sheet via the extension.
 */
export type DiceSource = 'local' | 'table' | 'ddb'

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

/** What to roll, and for whom: what a browser asks the table's relay for. */
export interface RollRequest {
  count: number
  faces: number
  modifier: number
  title?: string
  kind?: string
  character?: string
  characterId?: string
}

/** The largest die and modifier the relay will roll, so a request can't ask for nonsense. */
export const MAX_DIE_FACES = 1000
export const MAX_MODIFIER = 100

/**
 * A uniform integer in [0, n), from the platform's cryptographic random source
 * (the operating system's, seeded from hardware entropy). Raw values that would
 * make some results slightly more likely are thrown away and redrawn, so every
 * face is exactly equally likely.
 */
export function secureInt(n: number): number {
  const range = 2 ** 32
  const limit = range - (range % n)
  const draw = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(draw)
    if (draw[0] < limit) return draw[0] % n
  }
}

/** Roll a request with the cryptographic source. Counts, faces and modifier are clamped to sane ranges. */
export function rollDice(request: RollRequest, source: DiceSource): DiceRoll {
  // A missing or zero count or die size means the usual: one d20.
  const n = clampInt(request.count || 1, 1, MAX_DIE_COUNT, 1)
  const sides = clampInt(request.faces || 20, 2, MAX_DIE_FACES, 20)
  const mod = clampInt(request.modifier, -MAX_MODIFIER, MAX_MODIFIER, 0)
  const dice: DieResult[] = Array.from({ length: n }, () => ({ faces: sides, value: 1 + secureInt(sides) }))
  const sum = dice.reduce((total, die) => total + die.value, 0)
  return {
    id: newRollId(source),
    source,
    character: text(request.character),
    characterId: text(request.characterId) || undefined,
    title: text(request.title) || (n === 1 ? `d${sides}` : `${n}d${sides}`),
    formula: `${n}d${sides}${formatModifier(mod)}`,
    total: sum + mod,
    dice,
    modifier: mod || undefined,
    kind: text(request.kind) || undefined,
    at: Date.now(),
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 80) : ''
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
    id: String(raw.id || newRollId(sourceOf(raw.source))),
    source: sourceOf(raw.source),
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

/** One die as shown: its number, whether it came up 20 or 1 (d20s only), and whether it was dropped. */
export interface DieShown {
  value: number
  accent: 'crit' | 'fumble' | null
  discarded: boolean
}

/**
 * How a roll reads:
 * - `each`: d20s, every one on its own with the modifier added (attacks, checks,
 *   and both dice of advantage or disadvantage, the dropped one marked). No total.
 * - `sum`: any other dice, each die as rolled and then the total.
 * - `total`: just the number (one plain die, or a roll reported only by its total).
 */
export type RollBreakdown =
  | { kind: 'each'; dice: DieShown[] }
  | { kind: 'sum'; dice: DieShown[]; total: number }
  | { kind: 'total' }

export function rollBreakdown(roll: DiceRoll): RollBreakdown {
  const modifier = roll.modifier ?? 0
  if (roll.dice.length === 0) return { kind: 'total' }
  if (roll.dice.every((die) => die.faces === 20)) {
    return {
      kind: 'each',
      dice: roll.dice.map((die) => ({
        value: die.value + modifier,
        accent: die.value === 20 ? 'crit' : die.value === 1 ? 'fumble' : null,
        discarded: Boolean(die.discarded),
      })),
    }
  }
  // One die and nothing added: the die is the total.
  if (roll.dice.length === 1 && !modifier) return { kind: 'total' }
  return {
    kind: 'sum',
    dice: roll.dice.map((die) => ({ value: die.value, accent: null, discarded: Boolean(die.discarded) })),
    total: roll.total,
  }
}

/** The formula as people read it: "2 × d20+5" for d20s read one by one, so it doesn't look like a sum. */
export function readableFormula(roll: DiceRoll): string {
  const breakdown = rollBreakdown(roll)
  const kept = roll.dice.filter((die) => !die.discarded).length
  return breakdown.kind === 'each' && kept > 1 && kept === roll.dice.length
    ? `${kept} × d20${formatModifier(roll.modifier ?? 0)}`
    : roll.formula
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

function sourceOf(value: unknown): DiceSource {
  return value === 'local' || value === 'table' ? value : 'ddb'
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function newRollId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`
}
