import { floorAtOrder } from './floors.ts'
import { roomsBeyond } from './links.ts'
import type { OpeningSpot } from './openings.ts'
import { isMonster, occupantRoom, playerStatuses } from './players.ts'
import { roomContains, roomTileKind } from './rect.ts'
import { cellKey, openingAt, openingIsOpen, parseCellKey } from './tiles.ts'
import type { Cell, Dungeon, Floor, Player, Room } from './types.ts'

export type ViewMode = 'dm' | 'player'

/**
 * How player view draws a room: in sight, remembered (explored, but nothing is
 * open to see into it now, so it is greyed out), or not at all.
 */
export type RoomShade = 'clear' | 'fog' | 'hidden'

const STEPS: readonly Cell[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]

/** The party has seen this room; it stays on their map from then on. */
export function roomExplored(room: Room): boolean {
  return room.visible === true
}

interface Openness {
  /** Rooms that see into each other through an open door, window or archway. */
  edges: Map<string, Set<string>>
  /** Rooms with at least one way in or out standing open. */
  open: Set<string>
}

const opennessCache = new WeakMap<readonly Room[], Openness>()

function openness(rooms: readonly Room[]): Openness {
  const known = opennessCache.get(rooms)
  if (known) return known
  const edges = new Map<string, Set<string>>()
  const open = new Set<string>()
  const join = (a: string, b: string) => {
    let set = edges.get(a)
    if (!set) edges.set(a, (set = new Set()))
    set.add(b)
  }
  for (const room of rooms) {
    for (const [key, opening] of Object.entries(room.openings)) {
      if (opening === 'wall') continue
      const cell = parseCellKey(key)
      if (!roomContains(room, cell.x, cell.y)) continue
      // An archway is a gap in a wall; on the floor it marks nothing.
      if (opening === 'open' && roomTileKind(room, cell.x, cell.y) !== 'wall') continue
      if (!openingIsOpen(room, cell.x, cell.y)) continue
      open.add(room.id)
      for (const other of roomsBeyond(rooms, room, cell)) {
        open.add(other.id)
        join(room.id, other.id)
        join(other.id, room.id)
      }
    }
  }
  const computed = { edges, open }
  opennessCache.set(rooms, computed)
  return computed
}

/** Rooms a party token stands in on this floor. */
function partyRooms(floor: Floor, players: readonly Player[]): Set<string> {
  const found = new Set<string>()
  for (const player of players) {
    if (player.floorId !== floor.id || isMonster(player)) continue
    const room = occupantRoom(floor.rooms, player.x, player.y)
    if (room) found.add(room.id)
  }
  return found
}

const sightCache = new WeakMap<readonly Room[], WeakMap<readonly Player[], Set<string>>>()

/**
 * Explored rooms the party can see into right now: the ones with a door,
 * window or archway standing open, and the ones they stand in.
 */
export function floorSight(floor: Floor, players: readonly Player[]): ReadonlySet<string> {
  let byPlayers = sightCache.get(floor.rooms)
  if (!byPlayers) sightCache.set(floor.rooms, (byPlayers = new WeakMap()))
  const known = byPlayers.get(players)
  if (known) return known
  const { open } = openness(floor.rooms)
  const party = partyRooms(floor, players)
  const sight = new Set<string>()
  for (const room of floor.rooms) {
    if (roomExplored(room) && (open.has(room.id) || party.has(room.id))) sight.add(room.id)
  }
  byPlayers.set(players, sight)
  return sight
}

export function roomShade(room: Room, sight: ReadonlySet<string>): RoomShade {
  if (!roomExplored(room)) return 'hidden'
  return sight.has(room.id) ? 'clear' : 'fog'
}

/**
 * Everything the party can see from where they stand, following open doors,
 * windows and archways from room to room, marked explored. The same floor comes
 * back when nothing new came into view.
 */
export function exploreFloor(floor: Floor, players: readonly Player[]): Floor {
  const queue = [...partyRooms(floor, players)]
  if (queue.length === 0) return floor
  const { edges } = openness(floor.rooms)
  const reached = new Set(queue)
  while (queue.length > 0) {
    const id = queue.pop()
    if (!id) break
    for (const next of edges.get(id) ?? []) {
      if (reached.has(next)) continue
      reached.add(next)
      queue.push(next)
    }
  }
  if (floor.rooms.every((room) => !reached.has(room.id) || roomExplored(room))) return floor
  return {
    ...floor,
    rooms: floor.rooms.map((room) => (reached.has(room.id) && !roomExplored(room) ? { ...room, visible: true } : room)),
  }
}

/** `exploreFloor` across the map; the same dungeon comes back when nothing changed. */
export function exploreDungeon(dungeon: Dungeon): Dungeon {
  const players = dungeon.players ?? []
  let changed = false
  const floors = dungeon.floors.map((floor) => {
    const next = exploreFloor(floor, players)
    if (next !== floor) changed = true
    return next
  })
  return changed ? { ...dungeon, floors } : dungeon
}

interface PlayerRooms {
  rooms: Room[]
  /** A door borrowed onto an explored room's wall, keyed `roomId|x,y`, back to the room that owns it. */
  aliases: Map<string, OpeningSpot>
}

const playerRoomsCache = new WeakMap<readonly Room[], PlayerRooms>()
const aliasesOf = new WeakMap<readonly Room[], Map<string, OpeningSpot>>()

/**
 * The rooms player view draws: the explored ones. A door or window held by an
 * unexplored neighbour would vanish with it, leaving a blank wall where the way
 * on should be, so it is copied onto the explored room's side of that wall.
 */
export function playerRooms(rooms: readonly Room[]): Room[] {
  const known = playerRoomsCache.get(rooms)
  if (known) return known.rooms
  const shown = rooms.filter(roomExplored)
  const copies = new Map<string, Room>()
  const aliases = new Map<string, OpeningSpot>()
  for (const hidden of rooms) {
    if (roomExplored(hidden)) continue
    for (const [key, opening] of Object.entries(hidden.openings)) {
      if (opening !== 'door' && opening !== 'window') continue
      const cell = parseCellKey(key)
      if (!roomContains(hidden, cell.x, cell.y)) continue
      const target = wallFacing(shown, hidden, cell)
      if (!target) continue
      const host = copies.get(target.room.id) ?? target.room
      const at = cellKey(target.cell.x, target.cell.y)
      if (host.openings[at] !== undefined) continue
      copies.set(host.id, {
        ...host,
        openings: { ...host.openings, [at]: opening },
        openingOpen: { ...host.openingOpen, [at]: Boolean(hidden.openingOpen?.[key]) },
        openingLocked: { ...host.openingLocked, [at]: Boolean(hidden.openingLocked?.[key]) },
      })
      aliases.set(`${host.id}|${at}`, { roomId: hidden.id, x: cell.x, y: cell.y, kind: opening })
    }
  }
  const result = shown.map((room) => copies.get(room.id) ?? room)
  playerRoomsCache.set(rooms, { rooms: result, aliases })
  aliasesOf.set(result, aliases)
  return result
}

/** An explored room's wall that this doorway sits in, or sits right against. */
function wallFacing(shown: readonly Room[], owner: Room, cell: Cell): { room: Room; cell: Cell } | null {
  for (const room of shown) {
    if (roomContains(room, cell.x, cell.y) && roomTileKind(room, cell.x, cell.y) === 'wall') return { room, cell }
  }
  for (const step of STEPS) {
    const next = { x: cell.x + step.x, y: cell.y + step.y }
    if (roomContains(owner, next.x, next.y)) continue
    for (const room of shown) {
      if (!roomContains(room, next.x, next.y)) continue
      if (roomTileKind(room, next.x, next.y) !== 'wall' || openingAt(room, next.x, next.y)) continue
      return { room, cell: next }
    }
  }
  return null
}

/** The real door behind one picked from `playerRooms`, which may be a borrowed copy. */
export function realOpening(viewRooms: readonly Room[], spot: OpeningSpot): OpeningSpot {
  return aliasesOf.get(viewRooms)?.get(`${spot.roomId}|${cellKey(spot.x, spot.y)}`) ?? spot
}

export function shownRooms(rooms: readonly Room[], mode: ViewMode): Room[] {
  return mode === 'player' ? playerRooms(rooms) : [...rooms]
}

/**
 * Whether players can see this token now. A monster shows when its room is in
 * sight, or out of sight when the DM revealed it; never while Invisible. A party
 * token shows unless the DM hid it.
 */
export function tokenSeen(token: Player, floor: Floor | undefined, players: readonly Player[]): boolean {
  if (!floor || token.floorId !== floor.id) return false
  const room = occupantRoom(floor.rooms, token.x, token.y)
  if (!isMonster(token)) return token.visible === true && (!room || roomExplored(room))
  if (playerStatuses(token).includes('invisible')) return false
  if (!room) return token.visible === true
  if (floorSight(floor, players).has(room.id)) return true
  return token.visible === true && roomExplored(room)
}

const unseenCache = new WeakMap<readonly Room[], WeakMap<readonly Player[], Set<string>>>()

/** Tokens on this floor players can't see right now; the DM's map draws them faded. */
export function unseenTokens(floor: Floor, players: readonly Player[]): ReadonlySet<string> {
  let byPlayers = unseenCache.get(floor.rooms)
  if (!byPlayers) unseenCache.set(floor.rooms, (byPlayers = new WeakMap()))
  const known = byPlayers.get(players)
  if (known) return known
  const unseen = new Set<string>()
  for (const player of players) {
    if (player.floorId === floor.id && !tokenSeen(player, floor, players)) unseen.add(player.id)
  }
  byPlayers.set(players, unseen)
  return unseen
}

export function floorRevealed(floor: Floor): boolean {
  return floor.rooms.some(roomExplored)
}

export function shownFloors(floors: readonly Floor[], mode: ViewMode): Floor[] {
  return mode === 'player' ? floors.filter(floorRevealed) : [...floors]
}

export function nextShownFloor(
  floors: readonly Floor[],
  order: number,
  step: 1 | -1,
  mode: ViewMode,
): Floor | undefined {
  let next = order + step
  while (true) {
    const floor = floorAtOrder(floors, next)
    if (!floor) return undefined
    if (mode !== 'player' || floorRevealed(floor)) return floor
    next += step
  }
}
