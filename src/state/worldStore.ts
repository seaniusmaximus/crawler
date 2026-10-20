import { create } from 'zustand'
import type { NetMessage } from '../net/protocol.ts'
import { normalizeWorld, type World, type WorldMark } from '../model/worlds.ts'

/** Edits go to the table once dragging and typing rest this long. */
const SAVE_MS = 500

/** What a click on the picture does: look around and pick marks, or put a new one down. */
export type WorldTool = 'select' | 'pin' | 'label' | 'route'

interface WorldState {
  /** DM: whether the table has sent the campaign's world maps. */
  ready: boolean
  /** DM: every world map in the campaign. */
  worlds: World[]
  /** The world map the table is shown: its id for the DM, the map itself (as players see it) for a player. */
  shownId: string | null
  shown: World | null
  /** The world map on this screen, over the battle map; null when looking at the battle map. */
  viewingId: string | null
  tool: WorldTool
  selected: WorldMark | null
  /** DM: a route being drawn, point by point. */
  draft: [number, number][] | null
  /** DM: a pin whose battle map they asked to go to, waiting on "are you sure?" since players would switch too. */
  travelAsk: { pinId: string; mapId: string } | null
  error: string | null

  /** Look at a world map (the DM any of theirs; a player the one shown). */
  view: (id: string | null) => void
  setTool: (tool: WorldTool) => void
  select: (mark: WorldMark | null) => void
  setDraft: (draft: [number, number][] | null) => void
  askTravel: (ask: { pinId: string; mapId: string } | null) => void
  /** Add a world map, open it, and save it. */
  create: (world: World) => void
  update: (id: string, change: (world: World) => Partial<World>) => void
  remove: (id: string) => void
  /** Put a world map on everyone's screen, or (null) take it down. */
  show: (id: string | null) => void
  dismissError: () => void
  /** A message about world maps from the table; true when it was one. */
  receive: (message: NetMessage, host: boolean) => boolean
  /** Leaving the table: forget its world maps. */
  reset: () => void
}

type Sender = (message: NetMessage) => boolean
let sender: Sender = () => false

/** The session store hands over its socket, without the two importing each other. */
export function setWorldSender(send: Sender): void {
  sender = send
}

const timers = new Map<string, number>()
/** World maps changed while the table couldn't hear; sent again once the list comes back. */
const unsent = new Set<string>()

function flush(id: string): void {
  window.clearTimeout(timers.get(id))
  timers.delete(id)
  const world = useWorldStore.getState().worlds.find((item) => item.id === id)
  if (!world) return
  if (sender({ type: 'worldSave', world })) unsent.delete(id)
  else unsent.add(id)
}

function scheduleSave(id: string): void {
  window.clearTimeout(timers.get(id))
  timers.set(id, window.setTimeout(() => flush(id), SAVE_MS))
}

export const useWorldStore = create<WorldState>((set, get) => ({
  ready: false,
  worlds: [],
  shownId: null,
  shown: null,
  viewingId: null,
  tool: 'select',
  selected: null,
  draft: null,
  travelAsk: null,
  error: null,

  view: (id) => set({ viewingId: id, tool: 'select', selected: null, draft: null, travelAsk: null }),
  setTool: (tool) => set({ tool, draft: null, ...(tool === 'select' ? {} : { selected: null }) }),
  select: (selected) => set({ selected }),
  askTravel: (travelAsk) => set({ travelAsk }),
  setDraft: (draft) => set({ draft }),

  create: (world) => {
    set((state) => ({ worlds: [...state.worlds, world], viewingId: world.id, tool: 'select', selected: null, draft: null }))
    flush(world.id)
  },

  update: (id, change) => {
    let changed = false
    set((state) => ({
      worlds: state.worlds.map((world) => {
        if (world.id !== id) return world
        changed = true
        return { ...world, ...change(world), updatedAt: Date.now() }
      }),
    }))
    if (changed) scheduleSave(id)
  },

  remove: (id) => {
    window.clearTimeout(timers.get(id))
    timers.delete(id)
    unsent.delete(id)
    sender({ type: 'worldDelete', id })
    set((state) => ({
      worlds: state.worlds.filter((world) => world.id !== id),
      viewingId: state.viewingId === id ? null : state.viewingId,
      shownId: state.shownId === id ? null : state.shownId,
    }))
  },

  show: (id) => {
    // Whatever the table is about to see goes out first, so it isn't a step behind.
    if (id && timers.has(id)) flush(id)
    if (!sender({ type: 'worldShow', id })) {
      set({ error: 'Not connected to the table' })
      return
    }
    // Shown here at once; the relay's answer confirms it.
    set({ shownId: id })
  },

  dismissError: () => set({ error: null }),

  receive: (message, host) => {
    switch (message.type) {
      case 'worlds': {
        const worlds = (Array.isArray(message.worlds) ? message.worlds : [])
          .map(normalizeWorld)
          .filter((world): world is World => world !== null)
        // Changes this tab made while the table couldn't hear keep their place, and go again.
        const local = new Map(get().worlds.map((world) => [world.id, world]))
        const merged = worlds.map((world) => (unsent.has(world.id) ? (local.get(world.id) ?? world) : world))
        for (const id of unsent) {
          const world = local.get(id)
          if (world && !merged.some((item) => item.id === id)) merged.push(world)
        }
        set((state) => ({
          ready: true,
          worlds: merged,
          shownId: typeof message.shown === 'string' ? message.shown : null,
          viewingId: merged.some((world) => world.id === state.viewingId) ? state.viewingId : null,
        }))
        for (const id of [...unsent]) flush(id)
        return true
      }
      case 'worldShown': {
        const world = message.world ? normalizeWorld(message.world) : null
        if (host) {
          set({ shownId: world?.id ?? null })
          return true
        }
        set((state) => {
          // A newly shown world map opens on the player's screen; an update to it leaves them where they are.
          const fresh = world && world.id !== state.shown?.id
          const viewingId = !world ? null : fresh ? world.id : state.viewingId
          return {
            shown: world,
            shownId: world?.id ?? null,
            viewingId,
            selected: fresh || !world ? null : state.selected,
          }
        })
        return true
      }
      case 'worldError':
        set({ error: typeof message.message === 'string' ? message.message.slice(0, 200) : 'Could not save that world map' })
        return true
      default:
        return false
    }
  },

  reset: () => {
    for (const timer of timers.values()) window.clearTimeout(timer)
    timers.clear()
    unsent.clear()
    set({ ready: false, worlds: [], shownId: null, shown: null, viewingId: null, selected: null, draft: null, travelAsk: null, error: null })
  },
}))

/** The world map on this screen, if any: the DM's own copy, or what a player is shown. */
export function useViewedWorld(host: boolean): World | null {
  return useWorldStore((state) => {
    if (!state.viewingId) return null
    if (host) return state.worlds.find((world) => world.id === state.viewingId) ?? null
    return state.shown?.id === state.viewingId ? state.shown : null
  })
}
