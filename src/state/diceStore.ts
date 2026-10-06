import { create } from 'zustand'
import { isInitiativeRoll } from '../model/combat.ts'
import {
  MAX_DIE_COUNT,
  MAX_ROLL_LOG,
  normalizeRoll,
  rollDice,
  sameRoll,
  type DiceRoll,
  type IncomingRoll,
  type RollRequest,
} from '../model/dice.ts'
import { useDungeonStore } from './dungeonStore.ts'
import { untracked } from './history.ts'

export type BridgeStatus = 'disconnected' | 'connected'

interface DiceState {
  rolls: DiceRoll[]
  open: boolean
  count: number
  modifier: number
  bridge: BridgeStatus
  // True once the extension has announced itself this page load; stays true if it later goes stale.
  bridgeSeen: boolean
  /** Throw animated dice on the map for each roll (this browser's choice). */
  physical: boolean
  setPhysical: (on: boolean) => void
  setOpen: (open: boolean) => void
  setCount: (count: number) => void
  setModifier: (modifier: number) => void
  /** Roll the tray's dice; `who` names the roller's character so the roll shows at their token. */
  roll: (faces: number, who?: Pick<RollRequest, 'character' | 'characterId' | 'tokenId'>) => void
  ingest: (raw: IncomingRoll | IncomingRoll[]) => void
  replaceRolls: (rolls: DiceRoll[]) => void
  markBridge: (connected: boolean) => void
  clear: () => void
}

/**
 * At a table, rolls are made by the relay so no browser chooses its own numbers;
 * the session registers how to ask it. Returns false when there's no table to ask.
 */
let tableRoll: ((request: RollRequest) => boolean) | null = null

export function setTableRoller(roller: (request: RollRequest) => boolean): void {
  tableRoll = roller
}

/**
 * Roll dice: by the table's relay when connected (the result arrives with
 * everyone else's), otherwise right here. Both use the cryptographic source.
 */
export function requestRoll(request: RollRequest): void {
  if (tableRoll?.(request)) return
  useDiceStore.getState().ingest(rollDice(request, 'local'))
}

const PHYSICAL_KEY = 'crawler.physicalDice'

function readPhysical(): boolean {
  try {
    return window.localStorage.getItem(PHYSICAL_KEY) !== 'off'
  } catch {
    return true
  }
}

export function getDiceBridge(): Pick<DiceState, 'ingest' | 'markBridge'> {
  return window.__crawlerDice ?? useDiceStore.getState()
}

const arrivals = new EventTarget()

/**
 * Hear each roll as it arrives (rolled here, by the table's relay, or from D&D
 * Beyond), oldest first; not the log a table hands over on join. Returns an unsubscribe.
 */
export function onNewRolls(listener: (rolls: DiceRoll[]) => void): () => void {
  const handle = (event: Event) => listener((event as CustomEvent<DiceRoll[]>).detail)
  arrivals.addEventListener('rolls', handle)
  return () => arrivals.removeEventListener('rolls', handle)
}

export const useDiceStore = create<DiceState>((set, get) => ({
  rolls: [],
  open: false,
  count: 1,
  modifier: 0,
  bridge: 'disconnected',
  bridgeSeen: false,
  physical: readPhysical(),
  setPhysical: (physical) => {
    try {
      window.localStorage.setItem(PHYSICAL_KEY, physical ? 'on' : 'off')
    } catch {
      // Storage blocked: the choice lasts until reload.
    }
    set({ physical })
  },
  setOpen: (open) => set({ open }),
  setCount: (count) =>
    set({ count: Math.max(1, Math.min(MAX_DIE_COUNT, Math.round(count) || 1)) }),
  setModifier: (modifier) =>
    set({
      modifier: Math.max(-30, Math.min(30, Math.round(Number(modifier) || 0))),
    }),
  roll: (faces, who) => {
    const { count, modifier } = useDiceStore.getState()
    set({ open: true })
    requestRoll({ count, faces, modifier, ...who })
  },
  ingest: (raw) => {
    const incoming = (Array.isArray(raw) ? raw : [raw])
      .map(normalizeRoll)
      .filter((roll): roll is DiceRoll => roll != null)
    let rolls = get().rolls
    const added: DiceRoll[] = []
    // A second copy of a roll can know whose it is when the first didn't: in one browser, every
    // tab hears a D&D Beyond roll from the extension, but only the roller's tab knows their token.
    const placed: DiceRoll[] = []
    for (const roll of incoming) {
      const index = rolls.findIndex((existing) => sameRoll(existing, roll))
      if (index < 0) {
        rolls = prepend(rolls, roll)
        added.push(roll)
        continue
      }
      const known = rolls[index]
      if (roll.tokenId && !known.tokenId) {
        const updated = { ...known, tokenId: roll.tokenId }
        rolls = rolls.map((item, at) => (at === index ? updated : item))
        placed.push(updated)
      }
    }
    if (added.length === 0 && placed.length === 0) return
    for (const roll of [...added, ...placed]) {
      // A roll landing isn't an edit to take back.
      if (isInitiativeRoll(roll)) untracked(() => useDungeonStore.getState().recordInitiativeRoll(roll))
    }
    // Only a D&D Beyond roll proves the extension is talking to this page.
    set(incoming.some((roll) => roll.source === 'ddb') ? { rolls, bridge: 'connected' } : { rolls })
    if (added.length > 0) arrivals.dispatchEvent(new CustomEvent('rolls', { detail: added }))
  },
  replaceRolls: (rolls) => set({ rolls: rolls.slice(0, MAX_ROLL_LOG) }),
  markBridge: (connected) =>
    set(connected ? { bridge: 'connected', bridgeSeen: true } : { bridge: 'disconnected' }),
  clear: () => set({ rolls: [] }),
}))

function prepend(rolls: DiceRoll[], next: DiceRoll): DiceRoll[] {
  return [next, ...rolls].slice(0, MAX_ROLL_LOG)
}

window.__crawlerDice = {
  ingest: (raw) => useDiceStore.getState().ingest(raw),
  markBridge: (connected) => useDiceStore.getState().markBridge(connected),
}

declare global {
  interface Window {
    __crawlerDice?: Pick<DiceState, 'ingest' | 'markBridge'>
  }
}
