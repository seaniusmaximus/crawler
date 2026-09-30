import { create } from 'zustand'
import { isInitiativeRoll } from '../model/combat.ts'
import {
  MAX_DIE_COUNT,
  MAX_ROLL_LOG,
  normalizeRoll,
  rollLocal,
  sameRoll,
  type DiceRoll,
  type IncomingRoll,
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
  setOpen: (open: boolean) => void
  setCount: (count: number) => void
  setModifier: (modifier: number) => void
  roll: (faces: number) => void
  ingest: (raw: IncomingRoll | IncomingRoll[]) => void
  replaceRolls: (rolls: DiceRoll[]) => void
  markBridge: (connected: boolean) => void
  clear: () => void
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
  setOpen: (open) => set({ open }),
  setCount: (count) =>
    set({ count: Math.max(1, Math.min(MAX_DIE_COUNT, Math.round(count) || 1)) }),
  setModifier: (modifier) =>
    set({
      modifier: Math.max(-30, Math.min(30, Math.round(Number(modifier) || 0))),
    }),
  roll: (faces) =>
    set((state) => ({
      open: true,
      rolls: prepend(state.rolls, rollLocal(state.count, faces, state.modifier)),
    })),
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
      return rolls === state.rolls ? state : { rolls, bridge: 'connected' }
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
