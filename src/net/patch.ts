import { normalizePlayer } from '../model/players.ts'
import type { Dungeon, Floor, Player, Room } from '../model/types.ts'

/**
 * The difference between two versions of the map, small enough to send on every
 * change. Players change field by field, so moving a token never resends its
 * portrait; floors change room by room. `travel` is never included: live paths
 * travel separately.
 */
export interface DungeonPatch {
  top?: { id?: string; name?: string; tileset?: string | null; combat?: Dungeon['combat'] }
  players?: KeyedPatch<Partial<Player> & { id: string }>
  floors?: KeyedPatch<FloorPatch>
}

/** Changed or added items, removed ids, and the full id order when it changed. */
export interface KeyedPatch<T> {
  set: T[]
  remove: string[]
  order: string[] | null
}

export interface FloorPatch {
  id: string
  name?: string
  order?: number
  links?: Floor['links']
  ramps?: Floor['ramps']
  rooms?: KeyedPatch<Room>
}

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b)

function sameOrder<T extends { id: string }>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, i) => item.id === b[i]?.id)
}

/** Diff two id-keyed lists; `change` returns the patch for one item, or null when unchanged. */
function diffKeyed<T extends { id: string }, P>(
  prev: readonly T[],
  next: readonly T[],
  change: (before: T | undefined, after: T) => P | null,
): KeyedPatch<P> | undefined {
  const before = new Map(prev.map((item) => [item.id, item]))
  const ids = new Set(next.map((item) => item.id))
  const set: P[] = []
  for (const item of next) {
    const old = before.get(item.id)
    if (old === item) continue
    const patch = change(old, item)
    if (patch) set.push(patch)
  }
  const remove = prev.filter((item) => !ids.has(item.id)).map((item) => item.id)
  const order = sameOrder(prev, next) ? null : next.map((item) => item.id)
  return set.length || remove.length || order ? { set, remove, order } : undefined
}

function diffPlayer(before: Player | undefined, after: Player, force: boolean): (Partial<Player> & { id: string }) | null {
  if (!before) return after
  const fields: Partial<Player> & { id: string } = { id: after.id }
  let changed = false
  for (const key of Object.keys(after) as (keyof Player)[]) {
    // A forced player resends where it stands, so a refused move snaps back on the mover's screen.
    const pinned = force && (key === 'x' || key === 'y' || key === 'floorId')
    if (!pinned && same(before[key], after[key])) continue
    ;(fields as Record<string, unknown>)[key] = after[key]
    changed = true
  }
  return changed ? fields : null
}

function diffFloor(before: Floor | undefined, after: Floor): FloorPatch | null {
  if (!before) {
    const { rooms, ...rest } = after
    return { ...rest, rooms: { set: rooms, remove: [], order: rooms.map((room) => room.id) } }
  }
  const patch: FloorPatch = { id: after.id }
  if (before.name !== after.name) patch.name = after.name
  if (before.order !== after.order) patch.order = after.order
  if (!same(before.links, after.links)) patch.links = after.links
  if (!same(before.ramps, after.ramps)) patch.ramps = after.ramps
  const rooms = diffKeyed(before.rooms, after.rooms, (old, room) => (old && same(old, room) ? null : room))
  if (rooms) patch.rooms = rooms
  return Object.keys(patch).length > 1 ? patch : null
}

/** What changed from `prev` to `next`; null when nothing did. `force` lists players to resend. */
export function diffDungeon(prev: Dungeon, next: Dungeon, force: ReadonlySet<string> = new Set()): DungeonPatch | null {
  const patch: DungeonPatch = {}
  const top: NonNullable<DungeonPatch['top']> = {}
  if (prev.id !== next.id) top.id = next.id
  if (prev.name !== next.name) top.name = next.name
  if ((prev.tileset ?? null) !== (next.tileset ?? null)) top.tileset = next.tileset ?? null
  if (!same(prev.combat, next.combat)) top.combat = next.combat
  if (Object.keys(top).length) patch.top = top

  const prevPlayers = prev.players ?? []
  const nextPlayers = next.players ?? []
  const players = diffKeyed(prevPlayers, nextPlayers, (old, player) => diffPlayer(old, player, force.has(player.id)))
  // Forced players whose object didn't change at all still go out.
  const extra = nextPlayers
    .filter((player) => force.has(player.id) && !players?.set.some((item) => item.id === player.id))
    .map((player) => ({ id: player.id, floorId: player.floorId, x: player.x, y: player.y }))
  if (players || extra.length) {
    patch.players = players ?? { set: [], remove: [], order: null }
    patch.players.set.push(...extra)
  }

  const floors = diffKeyed(prev.floors, next.floors, diffFloor)
  if (floors) patch.floors = floors
  return Object.keys(patch).length ? patch : null
}

function applyKeyed<T extends { id: string }, P extends { id: string }>(
  items: readonly T[],
  patch: KeyedPatch<P> | undefined,
  merge: (before: T | undefined, change: P) => T,
): T[] {
  if (!patch) return [...items]
  const byId = new Map(items.map((item) => [item.id, item]))
  for (const change of patch.set) byId.set(change.id, merge(byId.get(change.id), change))
  for (const id of patch.remove) byId.delete(id)
  if (patch.order) {
    const ordered = patch.order.map((id) => byId.get(id)).filter((item): item is T => item !== undefined)
    // Anything the order didn't mention keeps its place at the end rather than vanishing.
    const listed = new Set(patch.order)
    return [...ordered, ...[...byId.values()].filter((item) => !listed.has(item.id))]
  }
  const kept = items.filter((item) => byId.has(item.id)).map((item) => byId.get(item.id) as T)
  const added = patch.set.filter((change) => !items.some((item) => item.id === change.id))
  return [...kept, ...added.map((change) => byId.get(change.id) as T)]
}

/** Apply a patch made by `diffDungeon`. Unchanged parts keep their identity. */
export function applyDungeonPatch(dungeon: Dungeon, patch: DungeonPatch): Dungeon {
  const top = patch.top ?? {}
  const next: Dungeon = { ...dungeon }
  if (top.id !== undefined) next.id = top.id
  if (top.name !== undefined) next.name = top.name
  if (top.tileset !== undefined) next.tileset = top.tileset ?? undefined
  if (top.combat !== undefined) next.combat = top.combat
  if (patch.players) {
    next.players = applyKeyed(dungeon.players ?? [], patch.players, (before, change) =>
      normalizePlayer({ ...(before ?? {}), ...change } as Player),
    )
  }
  if (patch.floors) {
    next.floors = applyKeyed(dungeon.floors, patch.floors, (before, change) => {
      const { rooms, ...fields } = change
      const base = before ?? ({ id: change.id, name: '', order: 0, rooms: [], links: [], ramps: [] } as Floor)
      return { ...base, ...fields, rooms: applyKeyed(base.rooms, rooms, (_old, room) => room) }
    })
  }
  return next
}
