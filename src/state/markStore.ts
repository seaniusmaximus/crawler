import { create } from 'zustand'
import { normalizeMark, PING_MS, type AreaMark, type MarkKind, type Ping, type Ruler, type TableMark } from '../model/marks.ts'

/** At most this many pings pulse at once, so someone holding the mouse down can't flood the map. */
const MAX_PINGS = 12
let pingCount = 0

/** Someone else's ruler or spell area, as last heard from them. Never saved. */
export interface RemoteMark {
  /** Client id of the sender, so departed players' marks can be dropped. */
  from: string
  fromHost: boolean
  mark: TableMark
}

interface MarkState {
  /** This tab's own ruler and spell area; set them through `reportMark` so the table sees them too. */
  mine: { ruler: Ruler | null; area: AreaMark | null }
  /** Keyed by sender and kind: one ruler and one area each. */
  remote: Record<string, RemoteMark>
  /** Pings pulsing now, from anyone (this tab too), with when each arrived. */
  pings: (Ping & { id: number; at: number })[]
  addPing: (ping: Ping) => void
  /** Let go of pings that have finished pulsing. */
  prunePings: (now: number) => void
  setMine: (kind: MarkKind, mark: TableMark | null) => void
  receive: (from: string, fromHost: boolean, kind: MarkKind, mark: unknown) => void
  /** Drop marks from people who left. */
  prune: (present: { guests: readonly string[]; host: boolean }) => void
  clear: () => void
}

export const useMarkStore = create<MarkState>((set, get) => ({
  mine: { ruler: null, area: null },
  remote: {},
  pings: [],

  addPing: (ping) => set((state) => ({ pings: [...state.pings, { ...ping, id: ++pingCount, at: performance.now() }].slice(-MAX_PINGS) })),

  prunePings: (now) => {
    const pings = get().pings
    const live = pings.filter((ping) => now - ping.at < PING_MS)
    if (live.length !== pings.length) set({ pings: live })
  },

  setMine: (kind, mark) => set((state) => ({ mine: { ...state.mine, [kind]: mark } })),

  receive: (from, fromHost, kind, raw) => {
    const remote = { ...get().remote }
    const key = `${from}:${kind}`
    const mark = normalizeMark(raw)
    if (mark && mark.kind === kind) remote[key] = { from, fromHost, mark }
    else if (remote[key]) delete remote[key]
    else return
    set({ remote })
  },

  prune: ({ guests, host }) => {
    const remote = get().remote
    const keep = Object.entries(remote).filter(([, item]) => (item.fromHost ? host : guests.includes(item.from)))
    if (keep.length !== Object.keys(remote).length) set({ remote: Object.fromEntries(keep) })
  },

  clear: () => {
    const { mine, remote } = get()
    if (mine.ruler || mine.area || Object.keys(remote).length) set({ mine: { ruler: null, area: null }, remote: {} })
  },
}))

/**
 * Every mark on a floor, this tab's own last so they draw on top. Emanations go
 * wherever their creature is, so they are all passed on for the map to place.
 */
export function floorMarks(floorId: string): TableMark[] {
  const { mine, remote } = useMarkStore.getState()
  const marks = Object.values(remote).map((item) => item.mark)
  if (mine.area) marks.push(mine.area)
  if (mine.ruler) marks.push(mine.ruler)
  return marks.filter((mark) => mark.floorId === floorId || (mark.kind === 'area' && mark.shape === 'emanation'))
}
