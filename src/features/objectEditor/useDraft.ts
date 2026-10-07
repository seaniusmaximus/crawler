import { useMemo, useRef, useState } from 'react'
import type { ObjectDef } from '../../objects/catalog.ts'

const LIMIT = 100

export interface Draft {
  draft: ObjectDef
  canUndo: boolean
  canRedo: boolean
  /** The draft right now, for handlers that outlive a render. */
  get: () => ObjectDef
  /**
   * Open an edit that may change the draft many times (a drag, a field being
   * typed in) but undoes as one step. Opening one already open does nothing.
   */
  begin: () => void
  /** Change the draft; one undo step only once `end` closes the edit. */
  set: (next: ObjectDef | ((draft: ObjectDef) => ObjectDef)) => void
  end: () => void
  /** One change, one undo step. */
  commit: (next: ObjectDef | ((draft: ObjectDef) => ObjectDef)) => void
  undo: () => void
  redo: () => void
}

/** The object being built, with its own undo and redo apart from the map's. */
export function useDraft(initial: ObjectDef): Draft {
  // Handlers outlive renders, so the history lives in a ref; what renders is copied into state.
  const history = useRef({ draft: initial, past: [] as ObjectDef[], future: [] as ObjectDef[], open: null as ObjectDef | null })
  const [view, setView] = useState({ draft: initial, canUndo: false, canRedo: false })

  const api = useMemo(() => {
    const h = history.current
    const rerender = () => setView({ draft: h.draft, canUndo: h.past.length > 0, canRedo: h.future.length > 0 })
    const begin = () => {
      if (!h.open) h.open = h.draft
    }
    const set = (next: ObjectDef | ((draft: ObjectDef) => ObjectDef)) => {
      const value = typeof next === 'function' ? next(h.draft) : next
      if (value === h.draft) return
      h.draft = value
      rerender()
    }
    const end = () => {
      if (h.open && h.open !== h.draft) {
        h.past = [...h.past.slice(1 - LIMIT), h.open]
        h.future = []
      }
      h.open = null
      rerender()
    }
    return {
      get: () => h.draft,
      begin,
      set,
      end,
      commit: (next: ObjectDef | ((draft: ObjectDef) => ObjectDef)) => {
        begin()
        set(next)
        end()
      },
      undo: () => {
        end()
        const previous = h.past.pop()
        if (!previous) return
        h.future.push(h.draft)
        h.draft = previous
        rerender()
      },
      redo: () => {
        end()
        const next = h.future.pop()
        if (!next) return
        h.past.push(h.draft)
        h.draft = next
        rerender()
      },
    }
  }, [])

  return { ...view, ...api }
}
