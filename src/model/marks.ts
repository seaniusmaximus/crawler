import { pathFeet } from './movement.ts'
import { FEET_PER_TILE } from './scale.ts'
import { ABILITY_KEYS, type AbilityKey } from './stats.ts'
import type { Cell } from './types.ts'

/**
 * Marks are what anyone at the table draws over the map for a moment: a ruler,
 * or a spell's area of effect. They travel live to everyone and are never saved.
 */

/**
 * Spell areas as the rules name them: a sphere or cylinder is a circle seen from
 * above; an emanation reaches out from a creature and goes where it goes.
 */
export type AreaShape = 'circle' | 'emanation' | 'cone' | 'line' | 'square'

/** Shapes whose caster can choose to be in their own area: an emanation, which comes from them. */
export function canIncludeCaster(shape: AreaShape): boolean {
  return shape === 'emanation'
}

export const AREA_SHAPES: ReadonlyArray<{ id: AreaShape; label: string; title: string }> = [
  { id: 'circle', label: 'Circle', title: 'A sphere, cylinder or radius: press on the grid corner at its centre, drag out' },
  {
    id: 'emanation',
    label: 'Emanation',
    title: 'Out from a creature in every direction, and moves with it: press on its token, drag out',
  },
  {
    id: 'cone',
    label: 'Cone',
    title: 'A cone, as wide at its end as it is long: press on the caster, drag straight or diagonally',
  },
  { id: 'line', label: 'Line', title: 'A line: press on the caster, drag the way it runs' },
  { id: 'square', label: 'Cube', title: 'A cube or square: press on the caster, drag out the side it grows on' },
]

export const AREA_MIN_FEET = 5
export const AREA_MAX_FEET = 200
export const LINE_MAX_WIDTH = 25
const MAX_RULER_POINTS = 64
/** The biggest token footprint an emanation from someone else is believed to have. */
const MAX_EMANATION_TOKEN = 8

/** A measured run of cells, with any turns pinned along the way. */
export interface Ruler {
  kind: 'ruler'
  floorId: string
  points: Cell[]
}

/**
 * A spell's area. `origin` is in grid units (cells are 1 wide, so 2.5 is the
 * middle of cell 2); `angle` is the aim in grid space, in radians.
 */
export interface AreaMark {
  kind: 'area'
  floorId: string
  shape: AreaShape
  /** Radius of a circle, length of a cone or line, side of a cube (centred on `origin`). */
  feet: number
  /** How wide a line is. */
  width: number
  origin: { x: number; y: number }
  angle: number
  /**
   * An emanation's creature: its token, and how many squares a side it was. The
   * area follows the token wherever it goes; `origin` is where it stood (its
   * top-left square) when the area was laid down.
   */
  playerId?: string
  tokenSize?: number
  /** An emanation or cube covers its own caster too. */
  includeSelf?: boolean
  /** Which of `AREA_COLORS` it is washed in, or its caster's token colour as hex; missing is the first. */
  color?: string
  /** What it is ("Spirit Guardians", "Pit trap"), shown on the map; missing for none. */
  name?: string
  /** Only the DM sees it (a trap, say); it still goes off for whoever walks in. */
  hidden?: boolean
  /** Moving through it costs twice as much, unless flying. */
  difficult?: boolean
  /** How long it lasts; missing is until taken away. */
  duration?: AreaDuration
  /** Damage it does to whoever enters it or starts their turn in it; missing for none. */
  damage?: AreaDamage
  /** Whose side it is on, for damage that only hurts enemies; missing is the monsters' (the DM's). */
  side?: AreaSide
  /**
   * Set once it has been laid down for good, so the live copy shown while it was
   * dragged out can step aside when the placed one arrives.
   */
  id?: string
}

/**
 * How long an area lasts. `rounds` ends at the start of the turn it was laid down
 * on, that many rounds later (`endsRound` and `endsOn` are set once combat is
 * counting rounds); `concentration` lasts while its caster keeps concentrating.
 */
export type AreaDuration =
  | { kind: 'rounds'; rounds: number; endsRound?: number; endsOn?: string | null }
  | { kind: 'concentration'; casterId: string }

/** When an area's damage goes off: as a creature enters it, as it starts its turn there, or both. */
export type AreaTrigger = 'enter' | 'start' | 'both'

/** Damage an area does, with the save that resists it. */
export interface AreaDamage {
  count: number
  faces: number
  bonus: number
  /** A damage type, or the DM's own words; empty for none. */
  type: string
  trigger: AreaTrigger
  save: { ability: AbilityKey; dc: number; onSave: 'half' | 'none' } | null
  /** Who it hurts: every creature, or only the enemies (or allies) of the side the area is on (see `AreaMark.side`). */
  affects: AreaAffects
}

/** Who an area takes in: every creature, or only the enemies, or only the allies, of the side it is on. */
export type AreaAffects = 'all' | 'enemies' | 'allies'

/**
 * Whose side an area is on, for an area that only hurts enemies: the party's
 * (enemies are monsters) or the monsters' (enemies are characters and companions).
 */
export type AreaSide = 'party' | 'foes'

/** Whether an area that hurts only enemies hurts this token: a monster on the party's side's, anyone else on the monsters'. */
export function isEnemyOf(side: AreaSide, token: { kind?: string }): boolean {
  const monster = token.kind === 'monster'
  return side === 'party' ? monster : !monster
}

export const MAX_AREA_ROUNDS = 100
const MAX_AREA_NAME = 40

/** "1d6 fire", "2d8+3 radiant": the damage as dice. */
export function areaDamageFormula(damage: AreaDamage): string {
  const bonus = damage.bonus ? (damage.bonus > 0 ? `+${damage.bonus}` : `${damage.bonus}`) : ''
  return `${damage.count}d${damage.faces}${bonus}${damage.type ? ` ${damage.type}` : ''}`
}

/** Fresh damage for an area: a 2d6 fire hazard anyone entering or starting there takes, DEX save for half. */
export function newAreaDamage(): AreaDamage {
  return {
    count: 2,
    faces: 6,
    bonus: 0,
    type: 'fire',
    trigger: 'both',
    save: { ability: 'dex', dc: 13, onSave: 'half' },
    affects: 'all',
  }
}

/**
 * Rounds left on an area that lasts rounds, while combat counts them: 1 means it
 * ends when its turn next comes round. Null when it doesn't last rounds, or
 * combat hasn't started counting it.
 */
export function roundsLeft(area: AreaMark, round: number | undefined): number | null {
  const duration = area.duration
  if (duration?.kind !== 'rounds') return null
  if (duration.endsRound == null || round == null) return duration.rounds
  return Math.max(1, duration.endsRound - round)
}

/**
 * A spell area laid down on the map: saved with it, seen by everyone, and kept
 * until whoever made it (or the DM) takes it away.
 */
export interface PlacedArea extends AreaMark {
  id: string
  color: string
  /** Who laid it down: `dm`, or a player (see `areaOwner` in the session store). */
  owner: string
}

/** The colours an area can be washed in, as "r, g, b". */
export const AREA_COLORS: ReadonlyArray<{ id: string; label: string; rgb: string }> = [
  { id: 'red', label: 'Red', rgb: '229, 72, 77' },
  { id: 'orange', label: 'Orange', rgb: '240, 140, 46' },
  { id: 'yellow', label: 'Yellow', rgb: '232, 196, 104' },
  { id: 'green', label: 'Green', rgb: '70, 179, 123' },
  { id: 'blue', label: 'Blue', rgb: '74, 144, 226' },
  { id: 'purple', label: 'Purple', rgb: '155, 107, 214' },
]

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/** One of `AREA_COLORS` by id, or a token's own hex colour; anything else is the first. */
export function areaColor(id: string | undefined): (typeof AREA_COLORS)[number] {
  if (id && HEX_COLOR.test(id)) {
    const hex = id.length === 4 ? id.replace(/[0-9a-f]/gi, (digit) => digit + digit) : id
    const n = parseInt(hex.slice(1), 16)
    return { id: hex.toLowerCase(), label: 'Token', rgb: `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}` }
  }
  return AREA_COLORS.find((color) => color.id === id) ?? AREA_COLORS[0]
}

/** The colour an area is laid down in: the one picked in the area tool, else its caster's token colour. */
export function areaColorFor(picked: string | null, caster: { color: string } | undefined): string {
  return areaColor(picked ?? caster?.color).id
}

/** How many areas a map keeps at most, so a stuck mouse can't bury it. */
export const MAX_PLACED_AREAS = 200

/** A pulse on one square for the table to look at, with who sent it. */
export interface Ping {
  floorId: string
  x: number
  y: number
  name: string
  /** A CSS colour: the sender's token colour, or the table gold. */
  color: string
}

/** How long a ping pulses on the map. */
export const PING_MS = 2600

/** A ping from someone else at the table, checked over; null if it isn't one. */
export function normalizePing(raw: unknown): Ping | null {
  if (!raw || typeof raw !== 'object') return null
  const ping = raw as Record<string, unknown>
  if (typeof ping.floorId !== 'string' || !finite(ping.x) || !finite(ping.y)) return null
  const name = typeof ping.name === 'string' ? ping.name.trim().slice(0, 40) : ''
  // Only a plain hex colour, since it goes straight into the canvas.
  const color = typeof ping.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(ping.color) ? ping.color : '#e8c468'
  return { floorId: ping.floorId, x: Math.round(ping.x), y: Math.round(ping.y), name: name || 'Someone', color }
}

export type TableMark = Ruler | AreaMark
export type MarkKind = TableMark['kind']

export function rulerFeet(ruler: Ruler): number {
  return pathFeet(ruler.points)
}

/**
 * Where an area anchors near grid point `at`. A circle is centred on the
 * nearest grid corner, as the rules lay a radius on a grid: a 5-foot radius is a
 * 2×2 block, 10 feet a 4×4 block without its corners. Everything else starts from
 * the middle of the square it is in: the caster's.
 */
export function snapAreaOrigin(shape: AreaShape, at: { x: number; y: number }): { x: number; y: number } {
  if (shape === 'circle') return { x: Math.round(at.x), y: Math.round(at.y) }
  // An emanation is held by its creature's top-left square.
  if (shape === 'emanation') return { x: Math.floor(at.x), y: Math.floor(at.y) }
  return { x: Math.floor(at.x) + 0.5, y: Math.floor(at.y) + 0.5 }
}

const EIGHTH = Math.PI / 4

/** Closer than this (in squares) to where a drag started, it doesn't yet say which way it points. */
const AIM_DEADZONE = 0.35

/**
 * The size an area takes from a drag out of `origin` to `to` (grid units), in
 * whole squares: a circle's radius, a cone's or line's length, a cube's side.
 * `angle` is null while the drag is too short to point anywhere.
 */
export function sizeFromDrag(
  shape: AreaShape,
  origin: { x: number; y: number },
  to: { x: number; y: number },
): { feet: number; angle: number | null } {
  const dx = to.x - origin.x
  const dy = to.y - origin.y
  const dist = Math.hypot(dx, dy)
  const angle = dist > AIM_DEADZONE ? Math.atan2(dy, dx) : null
  // Squares out from the starting square to the one under the pointer, counted as moving is: a diagonal step is one.
  const squares = Math.round(Math.max(Math.abs(dx), Math.abs(dy)))
  if (shape === 'cone') {
    return { feet: clampAreaFeet(squares * FEET_PER_TILE), angle: angle === null ? null : Math.round(angle / EIGHTH) * EIGHTH }
  }
  if (shape === 'line') return { feet: clampAreaFeet(squares * FEET_PER_TILE), angle }
  // A cube laid down anywhere takes in the square it starts on, so it reaches one past the drag.
  if (shape === 'square') return { feet: clampAreaFeet((squares + 1) * FEET_PER_TILE), angle }
  // A circle's radius is as the crow flies, so it stays round.
  return { feet: clampAreaFeet(Math.round(dist) * FEET_PER_TILE), angle }
}

/**
 * How far an emanation reaches when dragged out to grid point `to`: squares from
 * the edge of its creature's footprint (top-left square `anchor`, `size` a side),
 * counted as moving is.
 */
export function emanationFromDrag(anchor: Cell, size: number, to: { x: number; y: number }): number {
  const cell = { x: Math.floor(to.x), y: Math.floor(to.y) }
  const gap = (at: number, low: number) => Math.max(0, low - at, at - (low + size - 1))
  const squares = Math.max(gap(cell.x, anchor.x), gap(cell.y, anchor.y))
  return clampAreaFeet(squares * FEET_PER_TILE)
}

/**
 * An emanation as it is laid on a grid: every square within its reach of its
 * creature's squares, counted as moving is (so it runs out square, like a token's
 * move), leaving the creature itself out unless it chose to be in it.
 */
function emanationCells(area: AreaMark): Cell[] {
  const size = Math.max(1, Math.round(area.tokenSize ?? 1))
  const x0 = Math.round(area.origin.x)
  const y0 = Math.round(area.origin.y)
  const reach = Math.round(area.feet / FEET_PER_TILE)
  const cells: Cell[] = []
  for (let y = y0 - reach; y < y0 + size + reach; y++) {
    for (let x = x0 - reach; x < x0 + size + reach; x++) {
      const self = x >= x0 && x < x0 + size && y >= y0 && y < y0 + size
      if (!self || area.includeSelf) cells.push({ x, y })
    }
  }
  return cells
}

const EPS = 1e-6

/**
 * A cone as it is laid on a grid, out of the caster's square and pointing
 * straight or diagonally, one rank of squares per 5 feet, each rank as wide as it
 * is far out. Diagonally (from the caster's corner) ranks 1, 2 and 3 are 1, 2 and
 * 3 squares along the diagonal. Straight out (from the caster's side) a rank
 * can't be centred on an even count, so it rounds up to the odd one: 1, 3, 3, 5, 5…
 */
function coneCells(area: AreaMark): Cell[] {
  const cx = Math.floor(area.origin.x)
  const cy = Math.floor(area.origin.y)
  const dx = Math.round(Math.cos(area.angle))
  const dy = Math.round(Math.sin(area.angle))
  const ranks = Math.round(area.feet / FEET_PER_TILE)
  const cells: Cell[] = []
  if (dx !== 0 && dy !== 0) {
    for (let a = 0; a < ranks; a++) {
      for (let b = 0; a + b < ranks; b++) cells.push({ x: cx + dx * (1 + a), y: cy + dy * (1 + b) })
    }
    return cells
  }
  for (let rank = 1; rank <= ranks; rank++) {
    const half = Math.floor(rank / 2)
    for (let side = -half; side <= half; side++) {
      cells.push(dx !== 0 ? { x: cx + dx * rank, y: cy + side } : { x: cx + side, y: cy + dy * rank })
    }
  }
  return cells
}

/**
 * A cube as it is laid on a grid. Its point of origin is on one of its faces,
 * and that's the caster's square, which it leaves out: it sits right against
 * the caster on the side it is aimed at, as many squares a side as it is big.
 * One laid down in range rather than out of a caster takes in the square it
 * starts on (`includeSelf`): it is drawn back a square, over that square.
 * Aimed straight out it is centred on the caster's square (a cube an even number
 * of squares wide sits a half-square to one side); aimed off to one side it
 * slides along that face toward where it was dragged, up to having the caster at
 * its corner, which is where a diagonal aim puts it.
 */
function cubeCells(area: AreaMark): Cell[] {
  const cx = Math.floor(area.origin.x)
  const cy = Math.floor(area.origin.y)
  const size = Math.round(area.feet / FEET_PER_TILE)
  const ux = Math.cos(area.angle)
  const uy = Math.sin(area.angle)
  // The square it was aimed at, as many squares out as it is big (counted as moving is).
  const most = Math.max(Math.abs(ux), Math.abs(uy))
  const aim = { x: Math.round((size * ux) / most), y: Math.round((size * uy) / most) }
  // Where the cube runs along one axis: out from the caster if it was aimed that far
  // that way, else across the caster, as near centred as reaching the aim allows.
  const back = area.includeSelf ? 1 : 0
  const span = (toward: number): number => {
    if (toward >= size) return 1 - back
    if (toward <= -size) return -size + back
    const low = Math.max(toward, 0) - size + 1
    const high = Math.min(toward, 0)
    return Math.min(high, Math.max(low, -Math.floor((size - 1) / 2)))
  }
  const x0 = cx + span(aim.x)
  const y0 = cy + span(aim.y)
  const cells: Cell[] = []
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) cells.push({ x, y })
  }
  return cells
}

/**
 * The edges round a set of cells (grid units), each with the cell it belongs to,
 * for outlining an area drawn square by square.
 */
export function cellBorder(cells: readonly Cell[]): { cell: Cell; from: Cell; to: Cell }[] {
  const keys = new Set(cells.map((cell) => `${cell.x},${cell.y}`))
  const has = (x: number, y: number) => keys.has(`${x},${y}`)
  const edges: { cell: Cell; from: Cell; to: Cell }[] = []
  for (const cell of cells) {
    const { x, y } = cell
    if (!has(x, y - 1)) edges.push({ cell, from: { x, y }, to: { x: x + 1, y } })
    if (!has(x + 1, y)) edges.push({ cell, from: { x: x + 1, y }, to: { x: x + 1, y: y + 1 } })
    if (!has(x, y + 1)) edges.push({ cell, from: { x: x + 1, y: y + 1 }, to: { x, y: y + 1 } })
    if (!has(x - 1, y)) edges.push({ cell, from: { x, y: y + 1 }, to: { x, y } })
  }
  return edges
}

/** Whether the point (grid units) lies in the area. */
function covers(area: AreaMark, px: number, py: number): boolean {
  const reach = area.feet / FEET_PER_TILE
  const dx = px - area.origin.x
  const dy = py - area.origin.y
  const ux = Math.cos(area.angle)
  const uy = Math.sin(area.angle)
  switch (area.shape) {
    case 'circle':
      return Math.hypot(dx, dy) <= reach + EPS
    case 'cone':
    case 'square':
    case 'emanation':
      // Laid out square by square instead (see `coneCells`, `cubeCells` and `emanationCells`).
      return false
    case 'line': {
      const along = dx * ux + dy * uy
      const across = Math.abs(-dx * uy + dy * ux)
      const half = area.width / FEET_PER_TILE / 2
      // How far it runs is counted in squares instead (see `areaCells`).
      return along >= 0 && across <= half + EPS
    }
  }
}

/** Points sampled across each side of a square to judge how much of it an area covers. */
const SAMPLES = 4

/**
 * The cells an area touches: a cone or cube by its grid template, anything else,
 * as the rules have it on a grid, every square it covers at least half of. A line runs
 * out of the caster's square (never over it) for as many squares as it is long,
 * counted as moving is, so a diagonal line is as long as a straight one.
 */
export function areaCells(area: AreaMark): Cell[] {
  if (area.shape === 'cone') return coneCells(area)
  if (area.shape === 'square') return cubeCells(area)
  if (area.shape === 'emanation') return emanationCells(area)
  const reach = Math.max(area.feet, area.width) / FEET_PER_TILE + 1
  const cells: Cell[] = []
  const minX = Math.floor(area.origin.x - reach)
  const maxX = Math.ceil(area.origin.x + reach)
  const minY = Math.floor(area.origin.y - reach)
  const maxY = Math.ceil(area.origin.y + reach)
  const half = (SAMPLES * SAMPLES) / 2
  const cx = Math.floor(area.origin.x)
  const cy = Math.floor(area.origin.y)
  const length = Math.round(area.feet / FEET_PER_TILE)
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (area.shape === 'line') {
        const steps = Math.max(Math.abs(x - cx), Math.abs(y - cy))
        if (steps < 1 || steps > length) continue
      }
      let hits = 0
      for (let i = 0; i < SAMPLES && hits < half; i++) {
        for (let j = 0; j < SAMPLES; j++) {
          if (covers(area, x + (i + 0.5) / SAMPLES, y + (j + 0.5) / SAMPLES)) hits++
        }
      }
      if (hits >= half) cells.push({ x, y })
    }
  }
  return cells
}

/**
 * The area's true outline in grid units, for drawing over the cells it touches.
 * Empty for a cone, line or cube, which are their squares (see `cellBorder`).
 */
export function areaOutline(area: AreaMark): { x: number; y: number }[] {
  if (area.shape !== 'circle') return []
  const reach = area.feet / FEET_PER_TILE
  const steps = 64
  return Array.from({ length: steps }, (_, i) => {
    const angle = (i / steps) * Math.PI * 2
    return { x: area.origin.x + Math.cos(angle) * reach, y: area.origin.y + Math.sin(angle) * reach }
  })
}

export function areaLabel(area: AreaMark): string {
  const name = AREA_SHAPES.find((item) => item.id === area.shape)?.label.toLowerCase() ?? area.shape
  if (area.shape === 'circle') return `${area.feet} ft radius`
  if (area.shape === 'line') return `${area.feet} × ${area.width} ft line`
  return `${area.feet} ft ${name}`
}

export function clampAreaFeet(feet: number): number {
  const steps = Math.round(feet / FEET_PER_TILE)
  return Math.min(AREA_MAX_FEET, Math.max(AREA_MIN_FEET, steps * FEET_PER_TILE))
}

/** A line's width: an odd number of squares, so it runs down the middle of the caster's square. */
export function clampLineWidth(feet: number): number {
  const squares = Math.round(feet / FEET_PER_TILE)
  const odd = squares % 2 === 1 ? squares : squares + 1
  return Math.min(LINE_MAX_WIDTH, Math.max(AREA_MIN_FEET, odd * FEET_PER_TILE))
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** A mark from someone else at the table, checked over; null if it isn't one. */
export function normalizeMark(raw: unknown): TableMark | null {
  if (!raw || typeof raw !== 'object') return null
  const mark = raw as Record<string, unknown>
  if (typeof mark.floorId !== 'string') return null
  if (mark.kind === 'ruler') {
    if (!Array.isArray(mark.points)) return null
    const points: Cell[] = []
    for (const point of mark.points.slice(0, MAX_RULER_POINTS)) {
      const cell = point as Record<string, unknown> | null
      if (!cell || !finite(cell.x) || !finite(cell.y)) return null
      points.push({ x: Math.round(cell.x), y: Math.round(cell.y) })
    }
    return points.length > 0 ? { kind: 'ruler', floorId: mark.floorId, points } : null
  }
  if (mark.kind === 'area') {
    const origin = mark.origin as Record<string, unknown> | null
    if (!AREA_SHAPES.some((item) => item.id === mark.shape)) return null
    if (!origin || !finite(origin.x) || !finite(origin.y) || !finite(mark.feet) || !finite(mark.angle)) return null
    const area: AreaMark = {
      kind: 'area',
      floorId: mark.floorId,
      shape: mark.shape as AreaShape,
      feet: clampAreaFeet(mark.feet),
      width: clampLineWidth(finite(mark.width) ? mark.width : FEET_PER_TILE),
      origin: { x: origin.x, y: origin.y },
      angle: mark.angle,
    }
    if (area.shape === 'emanation') {
      if (typeof mark.playerId !== 'string') return null
      area.playerId = mark.playerId
      area.tokenSize = finite(mark.tokenSize) ? Math.min(MAX_EMANATION_TOKEN, Math.max(1, Math.round(mark.tokenSize))) : 1
    }
    if (area.shape === 'emanation' || area.shape === 'square') area.includeSelf = mark.includeSelf === true
    area.color = areaColor(typeof mark.color === 'string' ? mark.color : undefined).id
    if (typeof mark.id === 'string' && mark.id) area.id = mark.id.slice(0, 64)
    const name = typeof mark.name === 'string' ? mark.name.trim().slice(0, MAX_AREA_NAME) : ''
    if (name) area.name = name
    if (mark.hidden === true) area.hidden = true
    if (mark.difficult === true) area.difficult = true
    const duration = normalizeDuration(mark.duration)
    if (duration) area.duration = duration
    const damage = normalizeAreaDamage(mark.damage)
    if (damage) area.damage = damage
    if (mark.side === 'party' || mark.side === 'foes') area.side = mark.side
    return area
  }
  return null
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
}

function normalizeDuration(raw: unknown): AreaDuration | null {
  if (!raw || typeof raw !== 'object') return null
  const duration = raw as Record<string, unknown>
  if (duration.kind === 'concentration') {
    return typeof duration.casterId === 'string' && duration.casterId ? { kind: 'concentration', casterId: duration.casterId } : null
  }
  if (duration.kind !== 'rounds') return null
  const rounds: AreaDuration = { kind: 'rounds', rounds: clampInt(duration.rounds, 1, MAX_AREA_ROUNDS, 1) }
  if (finite(duration.endsRound)) {
    rounds.endsRound = Math.round(duration.endsRound)
    rounds.endsOn = typeof duration.endsOn === 'string' ? duration.endsOn : null
  }
  return rounds
}

function normalizeAreaDamage(raw: unknown): AreaDamage | null {
  if (!raw || typeof raw !== 'object') return null
  const damage = raw as Record<string, unknown>
  const save = damage.save as Record<string, unknown> | null | undefined
  return {
    count: clampInt(damage.count, 1, 40, 1),
    faces: [4, 6, 8, 10, 12, 20].includes(Number(damage.faces)) ? Number(damage.faces) : 6,
    bonus: clampInt(damage.bonus, -50, 50, 0),
    type: typeof damage.type === 'string' ? damage.type.trim().slice(0, 30) : '',
    trigger: damage.trigger === 'enter' || damage.trigger === 'start' ? damage.trigger : 'both',
    affects: damage.affects === 'enemies' || damage.affects === 'allies' ? damage.affects : 'all',
    save:
      save && typeof save === 'object'
        ? {
            ability: ABILITY_KEYS.find((key) => key === save.ability) ?? 'dex',
            dc: clampInt(save.dc, 1, 40, 13),
            onSave: save.onSave === 'none' ? 'none' : 'half',
          }
        : null,
  }
}

/** An area laid down on the map, as saved or sent; null if it isn't one. */
export function normalizePlacedArea(raw: unknown): PlacedArea | null {
  const area = normalizeMark(raw)
  const fields = raw as Record<string, unknown>
  if (!area || area.kind !== 'area' || !area.id || typeof fields.owner !== 'string') return null
  return { ...area, id: area.id, color: area.color ?? AREA_COLORS[0].id, owner: fields.owner.slice(0, 80) }
}

/** A map's areas, each checked over; anything that isn't one is dropped. */
export function normalizePlacedAreas(raw: unknown): PlacedArea[] {
  if (!Array.isArray(raw)) return []
  return raw
    .slice(0, MAX_PLACED_AREAS)
    .map(normalizePlacedArea)
    .filter((area): area is PlacedArea => area !== null)
}

/**
 * An area where it is now. An emanation goes with its creature, so it is put on
 * that token's squares (`at` overrides where the token stands, say mid-walk); it
 * is gone if its creature isn't among `players`, those on this floor this view
 * shows.
 */
export function placedArea<T extends AreaMark>(
  area: T,
  players: readonly { id: string; floorId: string; x: number; y: number; size?: number }[],
  at?: (playerId: string) => Cell | undefined,
): T | null {
  if (area.shape !== 'emanation') return area
  const token = players.find((player) => player.id === area.playerId)
  if (!token) return null
  const spot = at?.(token.id) ?? { x: token.x, y: token.y }
  return { ...area, floorId: token.floorId, origin: spot, tokenSize: Math.max(1, Math.round(token.size ?? 1)) }
}
