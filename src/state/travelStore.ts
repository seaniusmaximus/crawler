import { create } from 'zustand'
import { normalizeTravel, travelPose, type TokenTravel } from '../model/travel.ts'
import type { Player } from '../model/types.ts'

/** Another table member's token path, as last heard from them. Never saved. */
export interface RemoteTravel extends TokenTravel {
  /** Client id of the sender, so departed players' paths can be dropped. */
  from: string
  fromHost: boolean
  /** Set when the sender finished; the token holds its destination until the DM's move lands. */
  endedAt: number | null
}

/** How long a finished walk may hold its destination while waiting for the DM's snapshot. */
const SETTLE_MS = 2000

interface TravelState {
  /** Keyed by player id: one path per token, so several people can move at once. */
  remote: Record<string, RemoteTravel>
  receive: (from: string, fromHost: boolean, playerId: string, travel: TokenTravel | null) => void
  /** Drop paths from people who left, or whose finished walks have landed. */
  prune: (present: { guests: readonly string[]; host: boolean }) => void
  settle: (players: readonly Player[], now: number) => void
  clear: () => void
}

export const useTravelStore = create<TravelState>((set, get) => ({
  remote: {},

  receive: (from, fromHost, playerId, raw) => {
    const remote = { ...get().remote }
    const current = remote[playerId]
    const travel = normalizeTravel(raw)
    if (!travel) {
      if (!current) return
      // A walk that played out stays at its end until the DM's snapshot moves the token there.
      if (current.phase === 'playing') remote[playerId] = { ...current, endedAt: Date.now() }
      else delete remote[playerId]
      set({ remote })
      return
    }
    // Clocks differ between machines: a walk starts playing when it arrives here.
    const playAt = travel.phase === 'playing' ? (current?.phase === 'playing' ? current.playAt : Date.now()) : null
    remote[playerId] = { ...travel, playAt, from, fromHost, endedAt: null }
    set({ remote })
  },

  prune: ({ guests, host }) => {
    const remote = get().remote
    const keep = Object.entries(remote).filter(([, travel]) =>
      travel.fromHost ? host : guests.includes(travel.from),
    )
    if (keep.length !== Object.keys(remote).length) set({ remote: Object.fromEntries(keep) })
  },

  settle: (players, now) => {
    const remote = get().remote
    let changed = false
    const next: Record<string, RemoteTravel> = {}
    for (const [playerId, travel] of Object.entries(remote)) {
      if (travel.endedAt !== null) {
        const player = players.find((item) => item.id === playerId)
        const landed =
          !player || (player.floorId === travel.floorId && player.x === travel.ghostX && player.y === travel.ghostY)
        if (landed || now - travel.endedAt > SETTLE_MS) {
          changed = true
          continue
        }
      }
      next[playerId] = travel
    }
    if (changed) set({ remote: next })
  },

  clear: () => {
    if (Object.keys(get().remote).length) set({ remote: {} })
  },
}))

/** Whether any remote walk is mid-animation (the map must keep redrawing). */
export function remoteTravelAnimating(remote: Record<string, RemoteTravel>, now: number): boolean {
  return Object.values(remote).some(
    (travel) => travel.phase === 'playing' && travel.endedAt === null && !travelPose(travel, now).done,
  )
}
