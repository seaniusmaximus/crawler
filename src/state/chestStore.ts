import { create } from 'zustand'
import { useDiceStore } from './diceStore.ts'
import { useNotesStore } from './notesStore.ts'

/**
 * The chests in the bottom-left row whose panels open above it. Dice and Notes keep
 * their own flags (a roll opens the tray; a note picked on the map opens the notebook).
 */
export type Chest = 'maps' | 'save'

interface ChestState {
  open: Chest | null
  toggle: (chest: Chest) => void
  close: () => void
}

/** One chest's panel at a time: they all open in the same place, above the row. */
export const useChestStore = create<ChestState>((set, get) => ({
  open: null,
  toggle: (chest) => {
    const next = get().open === chest ? null : chest
    if (next) {
      useDiceStore.getState().setOpen(false)
      if (useNotesStore.getState().open) useNotesStore.getState().closePanel()
    }
    set({ open: next })
  },
  close: () => set({ open: null }),
}))

// The dice tray or the notebook opening (by its chest, or by something else) puts the others away.
useDiceStore.subscribe((state, prev) => {
  if (!state.open || prev.open) return
  useChestStore.getState().close()
  if (useNotesStore.getState().open) useNotesStore.getState().closePanel()
})
useNotesStore.subscribe((state, prev) => {
  if (!state.open || prev.open) return
  useChestStore.getState().close()
  useDiceStore.getState().setOpen(false)
})
