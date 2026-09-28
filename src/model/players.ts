import { rampAt } from './ramps.ts'
import { interiorRect, rectContains } from './rect.ts'
import { FEET_PER_TILE } from './scale.ts'
import { uniqueStatuses } from './status.ts'
import type { StatusId } from './status.ts'
import { cellKey } from './tiles.ts'
import { showsWall } from './walls.ts'
import { normalizeInitiativeRoll } from './combat.ts'
import { normalizeStats } from './stats.ts'
import type { Cell, ElevationRamp, Floor, Player, Room } from './types.ts'

export const MIN_TOKEN_SIZE = 1
export const MAX_TOKEN_SIZE = 8
export const MIN_TOKEN_HOVER = 0
export const MAX_TOKEN_HOVER = 8

export const PLAYER_COLORS = [
  '#e5484d',
  '#e8c468',
  '#78d39b',
  '#6bb0d6',
  '#c084fc',
  '#f0a070',
  '#f472b6',
  '#94a3b8',
] as const

export function occupantRoom(rooms: readonly Room[], x: number, y: number): Room | undefined {
  let best: Room | undefined
  let bestIndex = -1
  rooms.forEach((room, index) => {
    if (!rectContains(room.rect, x, y)) return
    if (
      !best ||
      room.elevation > best.elevation ||
      (room.elevation === best.elevation && index > bestIndex)
    ) {
      best = room
      bestIndex = index
    }
  })
  return best
}

/** Tokens stand on floor, including ramp treads — never walls, doors, or windows. */
export function isStandable(
  rooms: readonly Room[],
  x: number,
  y: number,
  ramps: readonly ElevationRamp[] = [],
): boolean {
  if (rampAt(ramps, x, y)) return true
  const room = occupantRoom(rooms, x, y)
  if (!room) return false
  return !showsWall(rooms, room, x, y)
}

export function playerSize(player: Pick<Player, 'size'>): number {
  const size = Math.round(player.size ?? 1)
  return Math.max(MIN_TOKEN_SIZE, Math.min(MAX_TOKEN_SIZE, size))
}

export function playerHover(player: Pick<Player, 'hover'>): number {
  const hover = Math.round(player.hover ?? 0)
  return Math.max(MIN_TOKEN_HOVER, Math.min(MAX_TOKEN_HOVER, hover))
}

export function playerStatuses(player: Pick<Player, 'statuses'>): StatusId[] {
  return uniqueStatuses(player.statuses)
}

export function tokenKind(player: Pick<Player, 'kind'>): 'player' | 'monster' {
  return player.kind === 'monster' ? 'monster' : 'player'
}

export function isMonster(player: Pick<Player, 'kind'>): boolean {
  return tokenKind(player) === 'monster'
}

export function partyMembers(tokens: readonly Player[]): Player[] {
  return tokens.filter((token) => !isMonster(token))
}

export function monsterMembers(tokens: readonly Player[]): Player[] {
  return tokens.filter(isMonster)
}

export function normalizePlayer(player: Player): Player {
  const kind = tokenKind(player)
  const fallback = kind === 'monster' ? 'Monster' : 'Player'
  const characterFallback = kind === 'monster' ? fallback : 'Character'
  return {
    ...player,
    kind,
    name: player.name || fallback,
    characterName: player.characterName || player.name || characterFallback,
    portrait: player.portrait ?? null,
    visible: kind === 'monster' ? player.visible === true : player.visible !== false,
    size: playerSize(player),
    hover: playerHover(player),
    statuses: player.statuses ?? [],
    characterId: player.characterId ?? null,
    stats: normalizeStats(player.stats),
    statsManual: player.statsManual ?? {},
    initiativeRoll: normalizeInitiativeRoll(player.initiativeRoll),
  }
}

export function playerAirFeet(player: Pick<Player, 'hover'>): number {
  return playerHover(player) * FEET_PER_TILE
}

/** Northwest cell of the size×size footprint. */
export function playerFootprint(x: number, y: number, size: number): Cell[] {
  const cells: Cell[] = []
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) cells.push({ x: x + dx, y: y + dy })
  }
  return cells
}

/**
 * Grid point the figure stands on. Odd footprints sit on a tile center;
 * even footprints sit on the vertex where the tiles meet.
 */
export function playerVisualCenter(x: number, y: number, size: number): { x: number; y: number } {
  return { x: x + size / 2, y: y + size / 2 }
}

/** Cell-space point that `tokenCenter` maps to the visual stand. */
export function playerCenter(x: number, y: number, size: number): { x: number; y: number } {
  return { x: x + (size - 1) / 2, y: y + (size - 1) / 2 }
}

export function snapTokenCenter(gx: number, gy: number, size: number): { x: number; y: number } {
  if (size % 2 === 1) {
    return { x: Math.floor(gx) + 0.5, y: Math.floor(gy) + 0.5 }
  }
  return { x: Math.round(gx), y: Math.round(gy) }
}

/** Place the NW anchor so the token center snaps to a tile or a vertex. */
export function anchorFromGrid(gx: number, gy: number, size: number): Cell {
  const center = snapTokenCenter(gx, gy, size)
  return {
    x: Math.round(center.x - size / 2),
    y: Math.round(center.y - size / 2),
  }
}

export function footprintsOverlap(
  ax: number,
  ay: number,
  aSize: number,
  bx: number,
  by: number,
  bSize: number,
): boolean {
  return ax < bx + bSize && ax + aSize > bx && ay < by + bSize && ay + aSize > by
}

export function occupiedCells(players: readonly Player[], floorId: string, exceptId?: string): Set<string> {
  const taken = new Set<string>()
  for (const player of players) {
    if (player.floorId !== floorId) continue
    if (exceptId && player.id === exceptId) continue
    for (const cell of playerFootprint(player.x, player.y, playerSize(player))) {
      taken.add(cellKey(cell.x, cell.y))
    }
  }
  return taken
}

export function canPlacePlayer(
  rooms: readonly Room[],
  players: readonly Player[],
  floorId: string,
  x: number,
  y: number,
  size: number,
  ramps: readonly ElevationRamp[] = [],
  exceptId?: string,
): boolean {
  for (const cell of playerFootprint(x, y, size)) {
    if (!isStandable(rooms, cell.x, cell.y, ramps)) return false
  }
  return !players.some(
    (player) =>
      player.id !== exceptId &&
      player.floorId === floorId &&
      footprintsOverlap(x, y, size, player.x, player.y, playerSize(player)),
  )
}

export function findStandable(
  rooms: readonly Room[],
  occupied: ReadonlySet<string>,
  ramps: readonly ElevationRamp[] = [],
): Cell | null {
  for (const room of rooms) {
    const area = interiorRect(room.rect)
    for (let y = area.minY; y <= area.maxY; y++) {
      for (let x = area.minX; x <= area.maxX; x++) {
        if (occupied.has(cellKey(x, y))) continue
        if (isStandable(rooms, x, y, ramps)) return { x, y }
      }
    }
  }
  return null
}

export function nextPlayerName(players: readonly Player[]): string {
  const used = new Set(partyMembers(players).map((player) => player.name))
  let n = 1
  while (used.has(`Player ${n}`)) n++
  return `Player ${n}`
}

export function nextCharacterName(players: readonly Player[]): string {
  const used = new Set(partyMembers(players).map((player) => player.characterName))
  let n = 1
  while (used.has(`Character ${n}`)) n++
  return `Character ${n}`
}

export function nextMonsterName(tokens: readonly Player[]): string {
  const used = new Set(monsterMembers(tokens).map((token) => characterNameOf(token)))
  let n = 1
  while (used.has(`Monster ${n}`)) n++
  return `Monster ${n}`
}

export function characterNameOf(player: Player): string {
  const named = player.characterName?.trim()
  return named ? named : player.name
}

export function nextPlayerColor(players: readonly Player[]): string {
  const used = new Set(players.map((player) => player.color))
  return PLAYER_COLORS.find((color) => !used.has(color)) ?? PLAYER_COLORS[players.length % PLAYER_COLORS.length] ?? '#e8c468'
}

export function playerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) {
    const word = parts[0] ?? ''
    return word.slice(0, 2).toUpperCase()
  }
  const first = parts[0]?.[0] ?? ''
  const last = parts[parts.length - 1]?.[0] ?? ''
  return (first + last).toUpperCase()
}

export function playersOnFloor(players: readonly Player[], floorId: string): Player[] {
  return players.filter((player) => player.floorId === floorId)
}

export function playersInRoom(players: readonly Player[], floor: Floor, roomId: string): Player[] {
  return players.filter((player) => {
    if (player.floorId !== floor.id) return false
    return occupantRoom(floor.rooms, player.x, player.y)?.id === roomId
  })
}

export function standOnFloor(floor: Floor, players: readonly Player[], exceptId?: string): Cell | null {
  return findStandable(floor.rooms, occupiedCells(players, floor.id, exceptId), floor.ramps ?? [])
}
