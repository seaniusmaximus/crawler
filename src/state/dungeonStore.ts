import { create } from 'zustand'
import { applyDungeonPatch, type DungeonPatch } from '../net/patch.ts'
import { floorAtOrder, floorName } from '../model/floors.ts'
import { linkedFloors, roomStairLandings, stairLandings, stripStairs } from '../model/stairs.ts'
import type { StairLanding } from '../model/stairs.ts'
import {
  interiorRect,
  intersectRect,
  rectContains,
  rectsOverlap,
  sameRect,
  tileKindIn,
  topmostRoomAt,
  translateRect,
} from '../model/rect.ts'
import { linkedGroup, makeLink, roomsThrough, sameLink } from '../model/links.ts'
import {
  anchorFromGrid,
  canPlacePlayer,
  isMonster,
  MAX_TOKEN_HOVER,
  MAX_TOKEN_SIZE,
  MIN_TOKEN_HOVER,
  MIN_TOKEN_SIZE,
  nextCharacterName,
  nextMonsterName,
  nextPlayerColor,
  nextPlayerName,
  normalizePlayer,
  playerFootprint,
  playerHover,
  playerSize,
  playerStatuses,
  playerVisualCenter,
  standOnFloor,
} from '../model/players.ts'
import {
  emptyCombat,
  nextTurnPlayerId,
  normalizeCombat,
  normalizeInitiativeRoll,
  playerForInitiativeRoll,
  sortByInitiative,
} from '../model/combat.ts'
import type { DiceRoll } from '../model/dice.ts'
import { normalizeTravel, sameTravel } from '../model/travel.ts'
import type { TokenTravel } from '../model/travel.ts'
import { emptyStats, isTextStat, mergeDdbStats, normalizeStats } from '../model/stats.ts'
import type { CharacterStats, StatKey } from '../model/stats.ts'
import type { StatusId } from '../model/status.ts'
import { shiftRamp } from '../model/ramps.ts'
import type { ElevationRamp } from '../model/types.ts'
import { connectedOpenings } from '../model/openings.ts'
import type { OpeningSpot } from '../model/openings.ts'
import { cellKey, openingAt, parseCellKey } from '../model/tiles.ts'
import type {
  Cell,
  CellRect,
  Dungeon,
  Floor,
  Link,
  Opening,
  Player,
  Room,
  StairsBlock,
  StairsDir,
} from '../model/types.ts'

function uid(): string {
  return crypto.randomUUID()
}

function nextRoomName(rooms: readonly Room[]): string {
  const used = new Set(rooms.map((room) => room.name))
  let n = 1
  while (used.has(`Room ${n}`)) n++
  return `Room ${n}`
}

function createFloor(order: number): Floor {
  return { id: uid(), name: floorName(order), order, rooms: [], links: [], ramps: [] }
}

function createDungeon(): Dungeon {
  return {
    id: uid(),
    name: 'Dungeon',
    floors: [createFloor(0)],
    players: [],
    combat: emptyCombat(),
    travel: null,
  }
}

function shiftOpenings(
  openings: Record<string, Opening>,
  dx: number,
  dy: number,
): Record<string, Opening> {
  if (dx === 0 && dy === 0) return openings
  const shifted: Record<string, Opening> = {}
  for (const [key, value] of Object.entries(openings)) {
    const cell = parseCellKey(key)
    shifted[cellKey(cell.x + dx, cell.y + dy)] = value
  }
  return shifted
}

function shiftBlocks(blocks: readonly StairsBlock[], dx: number, dy: number): StairsBlock[] {
  if (dx === 0 && dy === 0) return [...blocks]
  return blocks.map((block) => ({ ...block, rect: translateRect(block.rect, dx, dy) }))
}

function shiftFlags(
  flags: Record<string, boolean>,
  dx: number,
  dy: number,
): Record<string, boolean> {
  if (dx === 0 && dy === 0) return flags
  const shifted: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(flags)) {
    const cell = parseCellKey(key)
    shifted[cellKey(cell.x + dx, cell.y + dy)] = value
  }
  return shifted
}

// Openings and stairs are absolute, so a move carries them along.
function shiftRoom(room: Room, dx: number, dy: number): Room {
  return {
    ...room,
    rect: translateRect(room.rect, dx, dy),
    openings: shiftOpenings(room.openings, dx, dy),
    openingOpen: shiftFlags(room.openingOpen ?? {}, dx, dy),
    stairs: shiftBlocks(room.stairs, dx, dy),
  }
}

function mapFloor(dungeon: Dungeon, floorId: string, change: (floor: Floor) => Floor): Dungeon {
  return {
    ...dungeon,
    floors: dungeon.floors.map((floor) => (floor.id === floorId ? change(floor) : floor)),
  }
}

function mapRoom(floor: Floor, roomId: string, change: (room: Room) => Room): Floor {
  return {
    ...floor,
    rooms: floor.rooms.map((room) => (room.id === roomId ? change(room) : room)),
  }
}

/** A new staircase takes over the space, so blocks never overlap. */
function placeBlock(blocks: readonly StairsBlock[], rect: CellRect, dir: StairsDir): StairsBlock[] {
  return [...blocks.filter((block) => !rectsOverlap(block.rect, rect)), { rect, dir }]
}

/**
 * A mirrored staircase landing on one the user already built merges instead of
 * replacing it: stairs down plus stairs up in the same spot means both ways.
 */
function mergeBlock(blocks: readonly StairsBlock[], rect: CellRect, dir: StairsDir): StairsBlock[] {
  const twin = blocks.find((block) => sameRect(block.rect, rect))
  if (twin) {
    return blocks.map((block) =>
      block === twin ? { ...block, dir: block.dir === dir ? dir : 'both' } : block,
    )
  }
  return placeBlock(blocks, rect, dir)
}

/**
 * Mirrors a staircase onto the floor at `order`, creating that floor when it
 * does not exist yet. A room already covering the spot gains the landing, clipped
 * to its own floor area; otherwise the source room is cloned so the landing has
 * somewhere to sit. Repeat placements never stack duplicate rooms.
 */
function mirrorOnto(
  floors: Floor[],
  order: number,
  source: Room,
  region: CellRect,
  inverse: StairsDir,
): Floor[] {
  const existing = floorAtOrder(floors, order)
  const floor = existing ?? createFloor(order)
  const target = topmostRoomAt(floor.rooms, region.minX, region.minY)
  const landing = target ? intersectRect(region, interiorRect(target.rect)) : null

  let rooms: Room[]
  if (target && landing) {
    rooms = floor.rooms.map((room) =>
      room.id === target.id ? { ...room, stairs: mergeBlock(room.stairs, landing, inverse) } : room,
    )
  } else {
    const taken = floor.rooms.some((room) => room.name === source.name)
    rooms = [
      ...floor.rooms,
      {
        id: uid(),
        name: taken ? nextRoomName(floor.rooms) : source.name,
        rect: source.rect,
        openings: {},
        openingOpen: {},
        stairs: [{ rect: region, dir: inverse }],
        visible: source.visible,
        elevation: source.elevation,
      },
    ]
  }

  const updated = { ...floor, rooms }
  return existing
    ? floors.map((item) => (item.id === updated.id ? updated : item))
    : [...floors, updated]
}

/**
 * A doorway onto a neighbouring room links the two: from here on they drag as a
 * unit until the user clicks the link badge apart. Windows only look through, so
 * they join nothing.
 */
function linksThrough(floor: Floor, roomId: string, cells: readonly Cell[]): Link[] {
  const room = floor.rooms.find((item) => item.id === roomId)
  if (!room) return floor.links
  const links = [...floor.links]
  for (const cell of cells) {
    for (const partner of roomsThrough(floor.rooms, room, cell)) {
      const link = makeLink(roomId, partner.id)
      if (!links.some((item) => sameLink(item, link))) links.push(link)
    }
  }
  return links
}

interface DungeonState {
  dungeon: Dungeon
  addRoom: (floorId: string, rect: CellRect) => string
  moveRoom: (floorId: string, roomId: string, rect: CellRect) => void
  resizeRoom: (floorId: string, roomId: string, rect: CellRect) => void
  setOpenings: (
    floorId: string,
    roomId: string,
    cells: readonly Cell[],
    opening: Opening | null,
  ) => void
  /** `region` is floor-area cells; a null `dir` clears staircases it touches. */
  setStairs: (
    floorId: string,
    roomId: string,
    region: CellRect,
    dir: StairsDir | null,
  ) => StairLanding[]
  /** Strip leftover landings after stairs on another floor were erased. */
  clearStairLandings: (landings: readonly StairLanding[]) => void
  /** Stamp wall or floor onto existing room tiles without creating a link. */
  paintWalls: (floorId: string, roomId: string, cells: readonly Cell[], add: boolean) => void
  /** Frees two rooms to move apart again; their doorway stays put. */
  unlinkRooms: (floorId: string, link: Link) => void
  /** Join two rooms so they drag together, or split them if they already do. */
  toggleLink: (floorId: string, a: string, b: string) => void
  /** Visual elevation stairs between rooms; overlapping ramps are replaced. */
  addRamp: (floorId: string, ramp: Omit<ElevationRamp, 'id'>) => void
  /** Drop every ramp the rect touches. */
  eraseRamps: (floorId: string, rect: CellRect) => void
  deleteRoom: (floorId: string, roomId: string) => StairLanding[]
  renameRoom: (floorId: string, roomId: string, name: string) => void
  nudgeRoomElevation: (floorId: string, roomId: string, delta: number) => void
  setRoomVisible: (floorId: string, roomId: string, visible: boolean) => void
  setOpeningOpen: (floorId: string, spots: readonly OpeningSpot[], open: boolean) => void
  toggleConnectedOpenings: (floorId: string, roomId: string, x: number, y: number) => void
  addPlayer: (floorId: string) => string | null
  addMonster: (floorId: string) => string | null
  movePlayer: (playerId: string, floorId: string, x: number, y: number) => boolean
  renamePlayer: (playerId: string, name: string) => void
  renameCharacter: (playerId: string, characterName: string) => void
  setPlayerPortrait: (playerId: string, portrait: string | null) => void
  setPlayerVisible: (playerId: string, visible: boolean) => void
  nudgePlayerSize: (playerId: string, delta: number) => void
  nudgePlayerHover: (playerId: string, delta: number) => void
  togglePlayerStatus: (playerId: string, status: StatusId) => void
  deletePlayer: (playerId: string) => void
  replaceDungeon: (dungeon: Dungeon) => void
  /** Apply the DM's changes; this tab's own path in progress is kept. */
  applyPatch: (patch: DungeonPatch) => void
  /**
   * Move to another map of the campaign (null: a brand-new one). The party comes
   * along, standing where they last stood there (or in the first room); monsters
   * and the layout are that map's own; combat starts over.
   */
  enterMap: (target: Dungeon | null) => void
  upsertPlayer: (player: Player) => void
  claimCharacter: (info: {
    characterId: string
    name: string
    portrait: string | null
    stats?: Partial<CharacterStats> | null
  }) => string | null
  /** Seat a player without D&D Beyond; reuses `playerId` when that token still exists. */
  spawnPlayer: (name: string, playerId: string | null) => string | null
  setPlayerStat: (playerId: string, key: StatKey, value: number | string | null) => void
  setInitiativeRoll: (playerId: string, total: number | null) => void
  recordInitiativeRoll: (roll: DiceRoll) => void
  advanceTurn: () => void
  clearInitiative: () => void
  setTravel: (travel: TokenTravel | null) => void
  setTileset: (id: string) => void
  playTravel: () => void
  finishTravel: () => void
}

/**
 * Rooms are independent entities. Adjacent or overlapping rooms never merge,
 * steal cells, or share walls — connections come from doors and windows the
 * user places. Later rooms in the array sit on top of earlier ones.
 */
export const useDungeonStore = create<DungeonState>((set, get) => ({
  dungeon: createDungeon(),

  addRoom: (floorId, rect) => {
    const id = uid()
    set({
      dungeon: mapFloor(get().dungeon, floorId, (floor) => ({
        ...floor,
        rooms: [
          ...floor.rooms,
          {
            id,
            name: nextRoomName(floor.rooms),
            rect,
            openings: {},
            openingOpen: {},
            stairs: [],
            visible: false,
            elevation: 0,
          },
        ],
      })),
    })
    return id
  },

  // Linked rooms hold their doorway together, so the whole group travels.
  moveRoom: (floorId, roomId, rect) => {
    set({
      dungeon: (() => {
        const dungeon = get().dungeon
        const floor = dungeon.floors.find((item) => item.id === floorId)
        const room = floor?.rooms.find((item) => item.id === roomId)
        if (!floor || !room) return dungeon
        const dx = rect.minX - room.rect.minX
        const dy = rect.minY - room.rect.minY
        if (dx === 0 && dy === 0) return dungeon
        const group = linkedGroup(floor.rooms, floor.links, roomId)
        const moving = floor.rooms.filter((item) => group.has(item.id))
        const nextFloor = {
          ...floor,
          rooms: floor.rooms.map((item) =>
            group.has(item.id) ? shiftRoom(item, dx, dy) : item,
          ),
          ramps: (floor.ramps ?? []).map((ramp) =>
            moving.some((item) => rectsOverlap(ramp.rect, item.rect))
              ? shiftRamp(ramp, dx, dy)
              : ramp,
          ),
        }
        return {
          ...dungeon,
          floors: dungeon.floors.map((item) => (item.id === floorId ? nextFloor : item)),
          players: (dungeon.players ?? []).map((player) => {
            if (player.floorId !== floorId) return player
            const cells = playerFootprint(player.x, player.y, playerSize(player))
            if (!cells.some((cell) => moving.some((item) => rectContains(item.rect, cell.x, cell.y)))) {
              return player
            }
            return { ...player, x: player.x + dx, y: player.y + dy }
          }),
        }
      })(),
    })
  },

  // A resize leaves markers where they are; ones off their tile stay dormant.
  resizeRoom: (floorId, roomId, rect) => {
    set({
      dungeon: mapFloor(get().dungeon, floorId, (floor) =>
        mapRoom(floor, roomId, (room) => ({ ...room, rect })),
      ),
    })
  },

  // Doors, windows and archways all come through here; a run of cells is one edit.
  setOpenings: (floorId, roomId, cells, opening) => {
    if (cells.length === 0) return
    set({
      dungeon: mapFloor(get().dungeon, floorId, (floor) => {
        const next = mapRoom(floor, roomId, (room) => {
          const openings = { ...room.openings }
          const openingOpen = { ...(room.openingOpen ?? {}) }
          for (const cell of cells) {
            const key = cellKey(cell.x, cell.y)
            if (opening) {
              openings[key] = opening
              if (opening !== 'door' && opening !== 'window') delete openingOpen[key]
            } else if (tileKindIn(room.rect, cell.x, cell.y) === 'floor') {
              // Extra walls live as overrides on floor tiles; removing a door
              // there should put the painted wall back, not a hole.
              openings[key] = 'wall'
              delete openingOpen[key]
            } else {
              delete openings[key]
              delete openingOpen[key]
            }
          }
          return { ...room, openings, openingOpen }
        })
        return { ...next, links: linksThrough(next, roomId, cells) }
      }),
    })
  },

  setStairs: (floorId, roomId, region, dir) => {
    const dungeon = get().dungeon
    const source = dungeon.floors.find((floor) => floor.id === floorId)
    const room = source?.rooms.find((item) => item.id === roomId)
    if (!source || !room) return []

    const orphans = dir ? [] : stairLandings(dungeon.floors, source, room, region)

    let floors = dungeon.floors.map((floor) =>
      floor.id === floorId
        ? mapRoom(floor, roomId, (item) => ({
            ...item,
            stairs: dir
              ? placeBlock(item.stairs, region, dir)
              : item.stairs.filter((block) => !rectsOverlap(block.rect, region)),
          }))
        : floor,
    )

    if (dir) {
      for (const link of linkedFloors(dir)) {
        floors = mirrorOnto(floors, source.order + link.delta, room, region, link.inverse)
      }
    }

    set({ dungeon: { ...dungeon, floors } })
    return orphans
  },

  clearStairLandings: (landings) => {
    if (landings.length === 0) return
    const dungeon = get().dungeon
    set({
      dungeon: {
        ...dungeon,
        floors: dungeon.floors.map((floor) => {
          const hits = landings.filter((item) => item.floorId === floor.id)
          if (hits.length === 0) return floor
          return {
            ...floor,
            rooms: floor.rooms.map((room) => {
              const roomHits = hits.filter((item) => item.roomId === room.id)
              if (roomHits.length === 0) return room
              let stairs = room.stairs
              for (const hit of roomHits) {
                stairs = stripStairs(stairs, hit.rect, hit.inverse)
              }
              return { ...room, stairs }
            }),
          }
        }),
      },
    })
  },

  paintWalls: (floorId, roomId, cells, add) => {
    if (cells.length === 0) return
    set({
      dungeon: mapFloor(get().dungeon, floorId, (floor) =>
        mapRoom(floor, roomId, (room) => {
          const openings = { ...room.openings }
          for (const cell of cells) {
            const key = cellKey(cell.x, cell.y)
            const geometric = tileKindIn(room.rect, cell.x, cell.y)
            if (add) {
              if (geometric === 'wall') delete openings[key]
              else openings[key] = 'wall'
            } else if (geometric === 'wall') {
              openings[key] = 'open'
            } else {
              delete openings[key]
            }
          }
          return { ...room, openings }
        }),
      ),
    })
  },

  unlinkRooms: (floorId, link) => {
    set({
      dungeon: mapFloor(get().dungeon, floorId, (floor) => ({
        ...floor,
        links: floor.links.filter((item) => !sameLink(item, link)),
      })),
    })
  },

  toggleLink: (floorId, a, b) => {
    if (a === b) return
    const link = makeLink(a, b)
    set({
      dungeon: mapFloor(get().dungeon, floorId, (floor) => {
        const linked = floor.links.some((item) => sameLink(item, link))
        return {
          ...floor,
          links: linked
            ? floor.links.filter((item) => !sameLink(item, link))
            : [...floor.links, link],
        }
      }),
    })
  },

  addRamp: (floorId, ramp) => {
    set({
      dungeon: mapFloor(get().dungeon, floorId, (floor) => ({
        ...floor,
        ramps: [
          ...(floor.ramps ?? []).filter((item) => !rectsOverlap(item.rect, ramp.rect)),
          { ...ramp, id: uid() },
        ],
      })),
    })
  },

  eraseRamps: (floorId, rect) => {
    set({
      dungeon: mapFloor(get().dungeon, floorId, (floor) => ({
        ...floor,
        ramps: (floor.ramps ?? []).filter((item) => !rectsOverlap(item.rect, rect)),
      })),
    })
  },

  deleteRoom: (floorId, roomId) => {
    const dungeon = get().dungeon
    const floor = dungeon.floors.find((item) => item.id === floorId)
    const room = floor?.rooms.find((item) => item.id === roomId)
    const orphans = floor && room ? roomStairLandings(dungeon.floors, floor, room) : []
    set({
      dungeon: (() => {
        const next = mapFloor(dungeon, floorId, (item) => ({
          ...item,
          rooms: item.rooms.filter((entry) => entry.id !== roomId),
          links: item.links.filter((link) => link.a !== roomId && link.b !== roomId),
          ramps: room
            ? (item.ramps ?? []).filter((ramp) => !rectsOverlap(ramp.rect, room.rect))
            : (item.ramps ?? []),
        }))
        const nextFloor = next.floors.find((item) => item.id === floorId)
        if (!room || !nextFloor) return next
        const players = [...(next.players ?? [])]
        for (let i = 0; i < players.length; i++) {
          const player = players[i]
          if (!player || player.floorId !== floorId) continue
          if (!rectContains(room.rect, player.x, player.y)) continue
          const spot = standOnFloor(nextFloor, players, player.id)
          if (spot) players[i] = { ...player, x: spot.x, y: spot.y }
        }
        return { ...next, players }
      })(),
    })
    return orphans
  },

  renameRoom: (floorId, roomId, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    set({
      dungeon: mapFloor(get().dungeon, floorId, (floor) =>
        mapRoom(floor, roomId, (room) => ({ ...room, name: trimmed })),
      ),
    })
  },

  nudgeRoomElevation: (floorId, roomId, delta) => {
    set({
      dungeon: mapFloor(get().dungeon, floorId, (floor) =>
        mapRoom(floor, roomId, (room) => ({
          ...room,
          elevation: Math.max(-8, Math.min(8, (room.elevation ?? 0) + delta)),
        })),
      ),
    })
  },

  setRoomVisible: (floorId, roomId, visible) => {
    set({
      dungeon: mapFloor(get().dungeon, floorId, (floor) =>
        mapRoom(floor, roomId, (room) => ({ ...room, visible })),
      ),
    })
  },

  setOpeningOpen: (floorId, spots, open) => {
    if (spots.length === 0) return
    const byRoom = new Map<string, OpeningSpot[]>()
    for (const spot of spots) {
      const list = byRoom.get(spot.roomId) ?? []
      list.push(spot)
      byRoom.set(spot.roomId, list)
    }
    set({
      dungeon: mapFloor(get().dungeon, floorId, (floor) => ({
        ...floor,
        rooms: floor.rooms.map((room) => {
          const hits = byRoom.get(room.id)
          if (!hits) return room
          const openingOpen = { ...(room.openingOpen ?? {}) }
          for (const hit of hits) {
            const kind = openingAt(room, hit.x, hit.y)
            if (kind !== 'door' && kind !== 'window') continue
            openingOpen[cellKey(hit.x, hit.y)] = open
          }
          return { ...room, openingOpen }
        }),
      })),
    })
  },

  toggleConnectedOpenings: (floorId, roomId, x, y) => {
    const floor = get().dungeon.floors.find((item) => item.id === floorId)
    const room = floor?.rooms.find((item) => item.id === roomId)
    if (!floor || !room) return
    const spots = connectedOpenings(floor.rooms, roomId, x, y)
    if (spots.length === 0) return
    const key = cellKey(x, y)
    get().setOpeningOpen(floorId, spots, !room.openingOpen?.[key])
  },

  addPlayer: (floorId) => {
    const dungeon = get().dungeon
    const floor = dungeon.floors.find((item) => item.id === floorId)
    if (!floor) return null
    const players = dungeon.players ?? []
    const spot = standOnFloor(floor, players)
    if (!spot) return null
    const id = uid()
    set({
      dungeon: {
        ...dungeon,
        players: [
          ...players,
          {
            id,
            name: nextPlayerName(players),
            characterName: nextCharacterName(players),
            portrait: null,
            color: nextPlayerColor(players),
            floorId,
            x: spot.x,
            y: spot.y,
            visible: true,
            size: 1,
            hover: 0,
            statuses: [],
            characterId: null,
            stats: emptyStats(),
            statsManual: {},
            initiativeRoll: null,
            kind: 'player',
          },
        ],
      },
    })
    return id
  },

  addMonster: (floorId) => {
    const dungeon = get().dungeon
    const floor = dungeon.floors.find((item) => item.id === floorId)
    if (!floor) return null
    const tokens = dungeon.players ?? []
    const spot = standOnFloor(floor, tokens)
    if (!spot) return null
    const id = uid()
    const name = nextMonsterName(tokens)
    set({
      dungeon: {
        ...dungeon,
        players: [
          ...tokens,
          {
            id,
            name,
            characterName: name,
            portrait: null,
            color: nextPlayerColor(tokens),
            floorId,
            x: spot.x,
            y: spot.y,
            visible: false,
            size: 1,
            hover: 0,
            statuses: [],
            characterId: null,
            stats: emptyStats(),
            statsManual: {},
            initiativeRoll: null,
            kind: 'monster',
          },
        ],
      },
    })
    return id
  },

  movePlayer: (playerId, floorId, x, y) => {
    const dungeon = get().dungeon
    const floor = dungeon.floors.find((item) => item.id === floorId)
    const moving = (dungeon.players ?? []).find((player) => player.id === playerId)
    if (!floor || !moving) return false
    if (
      !canPlacePlayer(
        floor.rooms,
        dungeon.players ?? [],
        floorId,
        x,
        y,
        playerSize(moving),
        floor.ramps ?? [],
        playerId,
      )
    ) {
      return false
    }
    set({
      dungeon: {
        ...dungeon,
        players: (dungeon.players ?? []).map((player) =>
          player.id === playerId ? { ...player, floorId, x, y } : player,
        ),
      },
    })
    return true
  },

  renamePlayer: (playerId, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    set({
      dungeon: {
        ...get().dungeon,
        players: (get().dungeon.players ?? []).map((player) =>
          player.id === playerId ? { ...player, name: trimmed } : player,
        ),
      },
    })
  },

  renameCharacter: (playerId, characterName) => {
    const trimmed = characterName.trim()
    if (!trimmed) return
    set({
      dungeon: {
        ...get().dungeon,
        players: (get().dungeon.players ?? []).map((player) =>
          player.id === playerId ? { ...player, characterName: trimmed } : player,
        ),
      },
    })
  },

  setPlayerPortrait: (playerId, portrait) => {
    set({
      dungeon: {
        ...get().dungeon,
        players: (get().dungeon.players ?? []).map((player) =>
          player.id === playerId ? { ...player, portrait } : player,
        ),
      },
    })
  },

  setPlayerVisible: (playerId, visible) => {
    set({
      dungeon: {
        ...get().dungeon,
        players: (get().dungeon.players ?? []).map((player) =>
          player.id === playerId ? { ...player, visible } : player,
        ),
      },
    })
  },

  nudgePlayerSize: (playerId, delta) => {
    set({
      dungeon: {
        ...get().dungeon,
        players: (get().dungeon.players ?? []).map((player) => {
          if (player.id !== playerId) return player
          const size = Math.max(
            MIN_TOKEN_SIZE,
            Math.min(MAX_TOKEN_SIZE, playerSize(player) + delta),
          )
          if (size === playerSize(player)) return player
          const center = playerVisualCenter(player.x, player.y, playerSize(player))
          const dest = anchorFromGrid(center.x, center.y, size)
          return { ...player, size, x: dest.x, y: dest.y }
        }),
      },
    })
  },

  nudgePlayerHover: (playerId, delta) => {
    set({
      dungeon: {
        ...get().dungeon,
        players: (get().dungeon.players ?? []).map((player) => {
          if (player.id !== playerId) return player
          const hover = Math.max(
            MIN_TOKEN_HOVER,
            Math.min(MAX_TOKEN_HOVER, playerHover(player) + delta),
          )
          return { ...player, hover }
        }),
      },
    })
  },

  togglePlayerStatus: (playerId, status) => {
    set({
      dungeon: {
        ...get().dungeon,
        players: (get().dungeon.players ?? []).map((player) => {
          if (player.id !== playerId) return player
          const current = playerStatuses(player)
          const statuses = current.includes(status)
            ? current.filter((item) => item !== status)
            : [...current, status]
          return { ...player, statuses }
        }),
      },
    })
  },

  deletePlayer: (playerId) => {
    const dungeon = get().dungeon
    const players = (dungeon.players ?? []).filter((player) => player.id !== playerId)
    const turnPlayerId =
      dungeon.combat?.turnPlayerId === playerId
        ? nextTurnPlayerId(players, null)
        : (dungeon.combat?.turnPlayerId ?? null)
    set({
      dungeon: {
        ...dungeon,
        players,
        combat: { turnPlayerId },
        travel: dungeon.travel?.playerId === playerId ? null : dungeon.travel,
      },
    })
  },

  replaceDungeon: (dungeon) => {
    set({
      dungeon: {
        ...dungeon,
        combat: normalizeCombat(dungeon.combat),
        players: (dungeon.players ?? []).map(normalizePlayer),
        // `travel` is this tab's own path in progress; other people's live in the travel store.
        travel: get().dungeon.travel,
      },
    })
  },

  enterMap: (target) => {
    const party = (get().dungeon.players ?? []).filter((player) => !isMonster(player))
    const base = target ?? createDungeon()
    const floors = base.floors.length ? base.floors : [createFloor(0)]
    const ground = floors.find((floor) => floor.order === 0) ?? floors[0]
    const lastStood = new Map(
      (target?.players ?? []).filter((player) => !isMonster(player)).map((player) => [player.id, player]),
    )
    const monsters = (target?.players ?? []).filter(isMonster).map(normalizePlayer)
    const placed: Player[] = [...monsters]
    for (const member of party) {
      const before = lastStood.get(member.id)
      if (before && floors.some((floor) => floor.id === before.floorId)) {
        placed.push({ ...member, floorId: before.floorId, x: before.x, y: before.y })
        continue
      }
      const spot = standOnFloor(ground, placed) ?? { x: 0, y: 0 }
      placed.push({ ...member, floorId: ground.id, x: spot.x, y: spot.y })
    }
    set({
      dungeon: {
        ...base,
        floors,
        // Party first, then this map's monsters.
        players: [...placed.slice(monsters.length), ...monsters],
        combat: emptyCombat(),
        travel: null,
      },
    })
  },

  applyPatch: (patch) => {
    const dungeon = get().dungeon
    set({ dungeon: { ...applyDungeonPatch(dungeon, patch), travel: dungeon.travel } })
  },

  upsertPlayer: (player) => {
    const next = normalizePlayer(player)
    const players = get().dungeon.players ?? []
    const exists = players.some((item) => item.id === next.id)
    set({
      dungeon: {
        ...get().dungeon,
        players: sortByInitiative(
          exists ? players.map((item) => (item.id === next.id ? next : item)) : [...players, next],
        ),
      },
    })
  },

  claimCharacter: (info) => {
    const dungeon = get().dungeon
    const players = dungeon.players ?? []
    const characterId = info.characterId.trim()
    const name = info.name.trim()
    const match =
      players.find((player) => !isMonster(player) && characterId && player.characterId === characterId) ??
      players.find(
        (player) =>
          !isMonster(player) && name && player.characterName.toLowerCase() === name.toLowerCase(),
      )
    if (match) {
      const claimedName = name || match.characterName
      const duplicated =
        match.name.trim().toLowerCase() === match.characterName.trim().toLowerCase() &&
        claimedName &&
        match.name.trim().toLowerCase() === claimedName.toLowerCase()
      set({
        dungeon: {
          ...dungeon,
          players: players.map((player) =>
            player.id === match.id
              ? {
                  ...player,
                  name: duplicated
                    ? nextPlayerName(players.filter((item) => item.id !== match.id))
                    : player.name,
                  characterId: characterId || player.characterId,
                  characterName: claimedName || player.characterName,
                  portrait: info.portrait ?? player.portrait,
                  stats: mergeDdbStats(normalizeStats(player.stats), info.stats, player.statsManual),
                }
              : player,
          ),
        },
      })
      return match.id
    }

    const token = newPartyToken(dungeon, { ...info, characterId, name })
    if (!token) return null
    set({ dungeon: { ...dungeon, players: [...players, token] } })
    return token.id
  },

  spawnPlayer: (name, playerId) => {
    const dungeon = get().dungeon
    const players = dungeon.players ?? []
    const existing = playerId ? players.find((player) => player.id === playerId && !isMonster(player)) : null
    if (existing) return existing.id
    const token = newPartyToken(dungeon, { characterId: '', name: name.trim(), portrait: null })
    if (!token) return null
    set({ dungeon: { ...dungeon, players: [...players, token] } })
    return token.id
  },

  setPlayerStat: (playerId, key, value) => {
    set({
      dungeon: {
        ...get().dungeon,
        players: (get().dungeon.players ?? []).map((player) => {
          if (player.id !== playerId) return player
          const stats = normalizeStats(player.stats)
          if (isTextStat(key)) stats[key] = String(value ?? '').trim()
          else {
            stats[key] = value == null || value === '' ? null : Math.round(Number(value))
            if (!Number.isFinite(stats[key] as number)) stats[key] = null
          }
          return {
            ...player,
            stats,
            statsManual: { ...player.statsManual, [key]: true },
          }
        }),
      },
    })
  },

  setInitiativeRoll: (playerId, total) => {
    const dungeon = get().dungeon
    const players = (dungeon.players ?? []).map((player) =>
      player.id === playerId ? { ...player, initiativeRoll: normalizeInitiativeRoll(total) } : player,
    )
    set({ dungeon: { ...dungeon, players: sortByInitiative(players) } })
  },

  recordInitiativeRoll: (roll) => {
    const dungeon = get().dungeon
    const match = playerForInitiativeRoll(roll, dungeon.players ?? [])
    if (!match) return
    get().setInitiativeRoll(match.id, roll.total)
  },

  advanceTurn: () => {
    const dungeon = get().dungeon
    const players = sortByInitiative(dungeon.players ?? [])
    set({
      dungeon: {
        ...dungeon,
        players,
        combat: { turnPlayerId: nextTurnPlayerId(players, dungeon.combat?.turnPlayerId ?? null) },
      },
    })
  },

  clearInitiative: () => {
    const dungeon = get().dungeon
    set({
      dungeon: {
        ...dungeon,
        combat: emptyCombat(),
        players: (dungeon.players ?? []).map((player) => ({ ...player, initiativeRoll: null })),
      },
    })
  },

  setTileset: (id) => {
    const dungeon = get().dungeon
    if (dungeon.tileset === id) return
    set({ dungeon: { ...dungeon, tileset: id } })
  },

  setTravel: (travel) => {
    const dungeon = get().dungeon
    if (!travel) {
      if (!dungeon.travel) return
      set({ dungeon: { ...dungeon, travel: null } })
      return
    }
    const next = normalizeTravel({
      ...travel,
      seq: Math.max((dungeon.travel?.seq ?? 0) + 1, travel.seq ?? 0),
    })
    if (sameTravel(dungeon.travel, next)) return
    set({ dungeon: { ...dungeon, travel: next } })
  },

  playTravel: () => {
    const travel = get().dungeon.travel
    if (!travel || travel.phase === 'playing' || travel.cells.length < 2) return
    get().setTravel({ ...travel, phase: 'playing', playAt: Date.now() })
  },

  finishTravel: () => {
    const dungeon = get().dungeon
    const travel = dungeon.travel
    if (!travel) return
    get().movePlayer(travel.playerId, travel.floorId, travel.ghostX, travel.ghostY)
    const latest = get().dungeon
    if (latest.travel?.playerId === travel.playerId) {
      set({ dungeon: { ...latest, travel: null } })
    }
  },
}))

/** A fresh party token on the active floor, or null when there is no floor to stand on. */
function newPartyToken(
  dungeon: Dungeon,
  info: { characterId: string; name: string; portrait: string | null; stats?: Partial<CharacterStats> | null },
): Player | null {
  const players = dungeon.players ?? []
  const floor = dungeon.floors.find((item) => item.id === getActiveFloorId(dungeon)) ?? dungeon.floors[0]
  if (!floor) return null
  const spot = standOnFloor(floor, players) ?? { x: 0, y: 0 }
  return {
    id: uid(),
    name: nextPlayerName(players),
    characterName: info.name || nextCharacterName(players),
    portrait: info.portrait,
    color: nextPlayerColor(players),
    floorId: floor.id,
    x: spot.x,
    y: spot.y,
    visible: true,
    size: 1,
    hover: 0,
    statuses: [],
    characterId: info.characterId || null,
    stats: mergeDdbStats(emptyStats(), info.stats),
    statsManual: {},
    initiativeRoll: null,
    kind: 'player',
  }
}

function getActiveFloorId(dungeon: Dungeon): string | null {
  return dungeon.floors.find((floor) => floor.order === 0)?.id ?? dungeon.floors[0]?.id ?? null
}
