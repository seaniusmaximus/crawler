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
  roll: (faces: number, who?: Pick<RollRequest, 'character' | 'characterId'>) => void
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

export const useDiceStore = create<DiceState>((set) => ({
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
  ingest: (raw) =>
    set((state) => {
      const incoming = (Array.isArray(raw) ? raw : [raw])
        .map(normalizeRoll)
        .filter((roll): roll is DiceRoll => roll != null)
      if (incoming.length === 0) return state
      let rolls = state.rolls
      for (const roll of incoming) {
        if (rolls.some((existing) => sameRoll(existing, roll))) continue
        rolls = prepend(rolls, roll)
      }
      if (rolls !== state.rolls) {
        for (const roll of incoming) {
          if (isInitiativeRoll(roll)) useDungeonStore.getState().recordInitiativeRoll(roll)
        }
      }
      if (rolls === state.rolls) return state
      // Only a D&D Beyond roll proves the extension is talking to this page.
      return incoming.some((roll) => roll.source === 'ddb') ? { rolls, bridge: 'connected' } : { rolls }
    }),
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
