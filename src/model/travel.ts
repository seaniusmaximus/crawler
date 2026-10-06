import { uniqueTrail } from './movement.ts'
import type { Cell } from './types.ts'

export type TravelPhase = 'preview' | 'playing'

/** Shared token path: a translucent ghost while planning, then a slide replay. */
export interface TokenTravel {
  playerId: string
  floorId: string
  cells: Cell[]
  ghostX: number
  ghostY: number
  feet: number
  phase: TravelPhase
  playAt: number | null
  seq: number
}

const TILE_MS = 72
const SLIDE_MIN_MS = 240
const SLIDE_MAX_MS = 980
const SETTLE_MS = 360
const LEAN = 0.32
const TIP = 0.2
const OVERSHOOT = 0.26

function slideMs(segs: number): number {
  return Math.min(SLIDE_MAX_MS, Math.max(SLIDE_MIN_MS, 160 + segs * TILE_MS))
}

function smooth(t: number): number {
  const u = Math.min(1, Math.max(0, t))
  return u * u * (3 - 2 * u)
}

/** Grid steps a straight leg costs (Chebyshev), so long legs take proportionally longer. */
function legSteps(from: Cell, to: Cell): number {
  return Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y))
}

function totalSteps(trail: readonly Cell[]): number {
  let steps = 0
  for (let i = 1; i < trail.length; i++) {
    const from = trail[i - 1]
    const to = trail[i]
    if (from && to) steps += legSteps(from, to)
  }
  return steps
}

/**
 * Point `u` of the way along the trail, sliding straight between waypoints so the
 * token follows the line that was drawn. dx/dy is the leg's per-step direction.
 */
function samplePath(
  trail: readonly Cell[],
  u: number,
): { x: number; y: number; dx: number; dy: number } {
  const first = trail[0]
  if (!first) return { x: 0, y: 0, dx: 1, dy: 0 }
  const total = totalSteps(trail)
  if (total <= 0) return { x: first.x, y: first.y, dx: 1, dy: 0 }
  let remaining = Math.min(1, Math.max(0, u)) * total
  for (let i = 1; i < trail.length; i++) {
    const from = trail[i - 1]
    const to = trail[i]
    if (!from || !to) continue
    const len = legSteps(from, to)
    if (len === 0) continue
    const isLast = i === trail.length - 1
    if (remaining <= len || isLast) {
      const t = Math.min(1, remaining / len)
      return {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        dx: (to.x - from.x) / len,
        dy: (to.y - from.y) / len,
      }
    }
    remaining -= len
  }
  return { x: first.x, y: first.y, dx: 1, dy: 0 }
}

function lastStep(trail: readonly Cell[]): { x: number; y: number; dx: number; dy: number } {
  return samplePath(trail, 1)
}

/** Screen-right is +x − y in 2:1 iso; lean uses that heading. */
function heading(dx: number, dy: number): number {
  const sx = dx - dy
  return sx === 0 ? 1 : Math.sign(sx)
}

export type TravelPose = {
  x: number
  y: number
  tilt: number
  done: boolean
}

export function normalizeTravel(value: unknown): TokenTravel | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<TokenTravel>
  const playerId = typeof raw.playerId === 'string' ? raw.playerId : ''
  const floorId = typeof raw.floorId === 'string' ? raw.floorId : ''
  const cells = Array.isArray(raw.cells)
    ? raw.cells
        .map((cell) => {
          if (!cell || typeof cell !== 'object') return null
          const x = Number((cell as Cell).x)
          const y = Number((cell as Cell).y)
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null
          return { x: Math.round(x), y: Math.round(y) }
        })
        .filter((cell): cell is Cell => cell !== null)
    : []
  if (!playerId || !floorId || cells.length < 2) return null
  const last = cells[cells.length - 1]
  if (!last) return null
  return {
    playerId,
    floorId,
    cells,
    ghostX: Number.isFinite(raw.ghostX) ? Math.round(Number(raw.ghostX)) : last.x,
    ghostY: Number.isFinite(raw.ghostY) ? Math.round(Number(raw.ghostY)) : last.y,
    feet: Number.isFinite(raw.feet) ? Number(raw.feet) : 0,
    phase: raw.phase === 'playing' ? 'playing' : 'preview',
    playAt: typeof raw.playAt === 'number' && Number.isFinite(raw.playAt) ? raw.playAt : null,
    seq: typeof raw.seq === 'number' && Number.isFinite(raw.seq) ? raw.seq : 0,
  }
}

export function travelPose(travel: TokenTravel, now: number): TravelPose {
  const trail = uniqueTrail(travel.cells)
  const end = lastStep(trail)
  const dest = { x: end.x, y: end.y }
  const segs = totalSteps(trail)
  if (travel.phase !== 'playing' || travel.playAt == null || segs <= 0) {
    return { x: dest.x, y: dest.y, tilt: 0, done: false }
  }
  const slide = slideMs(segs)
  const elapsed = Math.max(0, now - travel.playAt)
  if (elapsed >= slide + SETTLE_MS) return { x: dest.x, y: dest.y, tilt: 0, done: true }

  const arrive = heading(end.dx, end.dy)

  if (elapsed < slide) {
    const u = elapsed / slide
    const along = u * u
    const at = samplePath(trail, along)
    const lean = heading(at.dx, at.dy)
    const wind = Math.min(1, elapsed / 90)
    // Hold the lean-back, then start coming upright as the slide arrives.
    const recover = u < 0.78 ? 1 : 1 - smooth((u - 0.78) / 0.22)
    return {
      x: at.x,
      y: at.y,
      tilt: -lean * LEAN * wind * recover,
      done: false,
    }
  }

  const u = (elapsed - slide) / SETTLE_MS
  const past = Math.sin(u * Math.PI)
  const back = -arrive * LEAN
  const fwd = arrive * TIP
  const tilt = u < 0.4 ? back + (fwd - back) * smooth(u / 0.4) : fwd * (1 - smooth((u - 0.4) / 0.6))
  return {
    x: dest.x + end.dx * OVERSHOOT * past,
    y: dest.y + end.dy * OVERSHOOT * past,
    tilt,
    done: false,
  }
}

export function sameTravel(a: TokenTravel | null, b: TokenTravel | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.playerId === b.playerId &&
    a.floorId === b.floorId &&
    a.phase === b.phase &&
    a.playAt === b.playAt &&
    a.ghostX === b.ghostX &&
    a.ghostY === b.ghostY &&
    a.feet === b.feet &&
    a.seq === b.seq &&
    a.cells.length === b.cells.length &&
    a.cells.every((cell, i) => cell.x === b.cells[i]?.x && cell.y === b.cells[i]?.y)
  )
}
