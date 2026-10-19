import { create } from 'zustand'
import type { SpellCard } from '../model/spellCard.ts'

/** At most this many spells wait to be looked at, so a flood of them can't pile up. */
const MAX_WAITING = 5

/**
 * A spell up on screen: one this player sent over from D&D Beyond (`sent`),
 * with what to do with it, or one someone showed the table (`shown`), to read.
 */
export interface OpenSpellCard {
  card: SpellCard
  mode: 'sent' | 'shown'
}

interface SpellCardState {
  /** The first is on screen; the rest wait their turn. */
  cards: OpenSpellCard[]
  open: (card: SpellCard, mode: OpenSpellCard['mode']) => void
  /** Put the one on screen away; the next comes up. */
  close: () => void
}

export const useSpellCardStore = create<SpellCardState>((set) => ({
  cards: [],
  // The same card again (shown twice) is already waiting; past the limit, newer ones are dropped, not the one being read.
  open: (card, mode) =>
    set((state) =>
      state.cards.some((item) => item.card.id === card.id) || state.cards.length >= MAX_WAITING
        ? state
        : { cards: [...state.cards, { card, mode }] },
    ),
  close: () => set((state) => ({ cards: state.cards.slice(1) })),
}))
