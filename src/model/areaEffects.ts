import type { Combat } from './combat.ts'
import { areaCells, isEnemyOf, placedArea, type AreaMark, type AreaSide, type PlacedArea } from './marks.ts'
import { playerFootprint, playerHover, playerSize, playerStatuses } from './players.ts'
import type { Cell, Player } from './types.ts'

/**
 * What spell areas do besides sit on the map: run out after so many rounds or
 * when their caster stops concentrating, make the ground hard going, and hurt
 * whoever enters them or starts a turn in them.
 */

/**
 * An area as it is laid down: one lasting rounds starts counting at once if
 * combat is under way (it ends at the start of this turn's token's turn that many
 * rounds on); otherwise it waits for combat to start.
 */
export function stampDuration<T extends AreaMark>(area: T, combat: Combat | undefined): T {
  const duration = area.duration
  if (duration?.kind !== 'rounds' || duration.endsRound != null || !combat?.turnPlayerId) return area
  return {
    ...area,
    duration: { ...duration, endsRound: (combat.round ?? 1) + duration.rounds, endsOn: combat.turnPlayerId },
  }
}

/**
 * The areas left once the turn has moved on to `turn` in `round`: ones whose
 * rounds are up are gone, and ones still waiting on combat start counting.
 */
export function tickDurations(areas: readonly PlacedArea[], round: number, turn: string | null): PlacedArea[] {
  const kept: PlacedArea[] = []
  for (const area of areas) {
    const duration = area.duration
    if (duration?.kind !== 'rounds' || !turn) {
      kept.push(area)
      continue
    }
    if (duration.endsRound == null) {
      kept.push({ ...area, duration: { ...duration, endsRound: round + duration.rounds, endsOn: turn } })
      continue
    }
    const over = round > duration.endsRound || (round === duration.endsRound && turn === duration.endsOn)
    if (!over) kept.push(area)
  }
  return kept
}

/**
 * Areas once combat ends: those lasting rounds stop counting, keeping what they
 * had left, and pick up again when the next fight starts.
 */
export function pauseDurations(areas: readonly PlacedArea[], round: number | undefined): PlacedArea[] {
  return areas.map((area) => {
    const duration = area.duration
    if (duration?.kind !== 'rounds' || duration.endsRound == null) return area
    const rounds = Math.max(1, duration.endsRound - (round ?? 1))
    return { ...area, duration: { kind: 'rounds', rounds } }
  })
}

/** The token an area is concentrated on, if it is. */
export function concentrationCaster(area: AreaMark): string | null {
  return area.duration?.kind === 'concentration' ? area.duration.casterId : null
}

/**
 * Areas whose caster is no longer concentrating (or is gone), which end with it.
 */
export function brokenConcentration(areas: readonly PlacedArea[], players: readonly Player[]): string[] {
  return areas
    .filter((area) => {
      const casterId = concentrationCaster(area)
      if (!casterId) return false
      const caster = players.find((player) => player.id === casterId)
      return !caster || !playerStatuses(caster).includes('concentrating')
    })
    .map((area) => area.id)
}

/**
 * Whose side an area is on: its caster's when it has one (a monster's is the
 * monsters', a character's or companion's the party's), else whoever laid it
 * down (the DM's the monsters', a player's the party's).
 */
export function areaSide(caster: Pick<Player, 'kind'> | undefined, owner: string): AreaSide {
  if (caster) return caster.kind === 'monster' ? 'foes' : 'party'
  return owner === 'dm' ? 'foes' : 'party'
}

/** Every square a token covers standing at (x, y). */
function footprintKeys(x: number, y: number, size: number): string[] {
  return playerFootprint(x, y, size).map((cell) => `${cell.x},${cell.y}`)
}

/** The squares of an area where it is now (an emanation on its creature), on `floorId`; null if not there. */
export function areaCellsOn(area: PlacedArea, players: readonly Player[], floorId: string): Set<string> | null {
  const here = placedArea(area, players)
  if (!here || here.floorId !== floorId) return null
  return new Set(areaCells(here).map((cell) => `${cell.x},${cell.y}`))
}

/** Whether a token standing at (x, y) is in an area's squares. */
export function standsIn(cells: ReadonlySet<string>, x: number, y: number, size: number): boolean {
  return footprintKeys(x, y, size).some((key) => cells.has(key))
}

/**
 * How a token's step onto a square is costed: 2 in difficult terrain (any area
 * marked so, that players can see) unless it flies, else 1.
 */
export function stepCost(
  areas: readonly PlacedArea[],
  players: readonly Player[],
  floorId: string,
  mover: Player | undefined,
): ((cell: Cell) => number) | undefined {
  if (mover && playerHover(mover) > 0) return undefined
  const difficult = new Set<string>()
  for (const area of areas) {
    if (!area.difficult || area.hidden) continue
    for (const key of areaCellsOn(area, players, floorId) ?? []) difficult.add(key)
  }
  if (difficult.size === 0) return undefined
  const size = mover ? playerSize(mover) : 1
  return (cell) => (footprintKeys(cell.x, cell.y, size).some((key) => difficult.has(key)) ? 2 : 1)
}

/** A spell area going off on a token. */
export interface AreaHit {
  area: PlacedArea
  token: Player
  why: 'enter' | 'start'
}

/** Whether an area's damage goes off for this. */
function triggers(area: PlacedArea, why: 'enter' | 'start'): boolean {
  return area.damage != null && (area.damage.trigger === 'both' || area.damage.trigger === why)
}

/** Whether an area's damage hurts this token: anyone, or only the enemies (or allies) of the area's side. */
export function affects(area: PlacedArea, token: Player): boolean {
  const who = area.damage?.affects ?? 'all'
  if (who === 'all') return true
  const enemy = isEnemyOf(area.side ?? 'foes', token)
  return who === 'enemies' ? enemy : !enemy
}

/**
 * Areas a token walked into: those it touches somewhere along `path` (its
 * top-left squares, start to end) but not where it set out. An area hurts a token
 * on entering only once a turn (`hits`).
 */
export function enteredAreas(
  areas: readonly PlacedArea[],
  players: readonly Player[],
  token: Player,
  floorId: string,
  path: readonly Cell[],
  hits: readonly string[],
): AreaHit[] {
  const size = playerSize(token)
  const start = path[0]
  if (!start) return []
  const found: AreaHit[] = []
  for (const area of areas) {
    if (!triggers(area, 'enter') || !affects(area, token) || hits.includes(`${area.id}:${token.id}`)) continue
    // A token doesn't walk into its own emanation.
    if (area.shape === 'emanation' && area.playerId === token.id) continue
    const cells = areaCellsOn(area, players, floorId)
    if (!cells || standsIn(cells, start.x, start.y, size)) continue
    if (path.some((cell) => standsIn(cells, cell.x, cell.y, size))) found.push({ area, token, why: 'enter' })
  }
  return found
}

/**
 * Tokens an emanation swept onto as its creature moved: in it where it is now,
 * not where it was. An emanation moving onto a creature counts as it entering.
 */
export function sweptTokens(
  area: PlacedArea,
  players: readonly Player[],
  before: readonly Player[],
  floorId: string,
  hits: readonly string[],
): AreaHit[] {
  if (area.shape !== 'emanation' || !triggers(area, 'enter')) return []
  const now = areaCellsOn(area, players, floorId)
  const then = areaCellsOn(area, before, floorId)
  if (!now) return []
  return players
    .filter(
      (token) =>
        token.floorId === floorId &&
        token.id !== area.playerId &&
        affects(area, token) &&
        !hits.includes(`${area.id}:${token.id}`),
    )
    .filter((token) => {
      const was = before.find((item) => item.id === token.id) ?? token
      const size = playerSize(token)
      return standsIn(now, token.x, token.y, size) && !(then && standsIn(then, was.x, was.y, size))
    })
    .map((token) => ({ area, token, why: 'enter' as const }))
}

/** Areas a token starting its turn stands in, that hurt it for that. */
export function turnStartAreas(areas: readonly PlacedArea[], players: readonly Player[], token: Player): AreaHit[] {
  const size = playerSize(token)
  return areas
    .filter((area) => triggers(area, 'start') && affects(area, token))
    .filter((area) => {
      const cells = areaCellsOn(area, players, token.floorId)
      return cells != null && standsIn(cells, token.x, token.y, size)
    })
    .map((area) => ({ area, token, why: 'start' as const }))
}
