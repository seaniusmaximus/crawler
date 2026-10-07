import { create } from 'zustand'
import * as api from '../net/api.ts'
import type { Account } from '../net/api.ts'
import { setLibraryObjectSource, type ObjectDef } from '../objects/catalog.ts'
import { cleanObject, MAX_LIBRARY_OBJECTS, parseObject } from '../objects/custom.ts'
import { useAccountStore } from './accountStore.ts'
import { useDungeonStore } from './dungeonStore.ts'
import { untracked } from './history.ts'

/**
 * The DM's Custom objects: every object they've built in the object editor,
 * ready for any map. Kept with their account when signed in, and in this
 * browser otherwise; signing in moves the browser's ones up to the account.
 */
interface ObjectLibraryState {
  objects: ObjectDef[]
  /** Where the collection is kept right now. */
  where: 'account' | 'browser'
  error: string | null
  /** Add or replace an object, cleaned; null when it has no parts or the collection is full. */
  save: (def: ObjectDef) => ObjectDef | null
  /** Take an object out of the collection. Maps it was placed on keep their own copies. */
  remove: (id: string) => void
}

const STORAGE_KEY = 'crawler.customObjects'

export const useObjectLibraryStore = create<ObjectLibraryState>((set, get) => ({
  objects: readBrowser(),
  where: 'browser',
  error: null,

  save: (def) => {
    const clean = cleanObject(def)
    if (!clean) return null
    const { objects, where } = get()
    const exists = objects.some((item) => item.id === clean.id)
    if (!exists && objects.length >= MAX_LIBRARY_OBJECTS) {
      set({ error: `Custom objects holds at most ${MAX_LIBRARY_OBJECTS}` })
      return null
    }
    const next = exists ? objects.map((item) => (item.id === clean.id ? clean : item)) : [...objects, clean]
    set({ objects: next, error: null })
    if (where === 'account') {
      api.putCustomObject(clean).catch((error: unknown) => set({ error: message(error) }))
    } else {
      writeBrowser(next)
    }
    refreshMapCopies()
    return clean
  },

  remove: (id) => {
    const { objects, where } = get()
    const next = objects.filter((item) => item.id !== id)
    set({ objects: next, error: null })
    if (where === 'account') {
      api.deleteCustomObject(id).catch((error: unknown) => set({ error: message(error) }))
    } else {
      writeBrowser(next)
    }
  },
}))

/** Bumped on every load, so a slow answer for a user who has since signed out is dropped. */
let loading = 0

async function load(user: Account | null): Promise<void> {
  const token = ++loading
  const local = readBrowser()
  if (!user) {
    useObjectLibraryStore.setState({ objects: local, where: 'browser', error: null })
    refreshMapCopies()
    return
  }
  try {
    const stored = (await api.listCustomObjects()).map(parseObject).filter((def): def is ObjectDef => def !== null)
    const moving = local.filter((def) => !stored.some((item) => item.id === def.id))
    for (const def of moving) await api.putCustomObject(def)
    if (token !== loading) return
    writeBrowser([])
    useObjectLibraryStore.setState({ objects: [...stored, ...moving], where: 'account', error: null })
  } catch (error) {
    if (token !== loading) return
    // The account can't be reached: keep working in this browser, and move them up next time.
    useObjectLibraryStore.setState({ objects: local, where: 'browser', error: message(error) })
  }
  refreshMapCopies()
}

/**
 * Maps keep a copy of each custom object placed on them. When the DM's own
 * version is newer, the open map's copy follows it, so players see the change.
 * Upkeep rather than an edit of the map, so it isn't an undo step.
 */
function refreshMapCopies(): void {
  const objects = useObjectLibraryStore.getState().objects
  untracked(() => useDungeonStore.getState().refreshObjectCopies(objects))
}

function readBrowser(): ObjectDef[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.map(parseObject).filter((def): def is ObjectDef => def !== null) : []
  } catch {
    return []
  }
}

function writeBrowser(objects: readonly ObjectDef[]): void {
  try {
    if (objects.length) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(objects))
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage blocked: the collection lasts until reload.
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}

// Placing and drawing look objects up by kind alone; the collection comes from here.
setLibraryObjectSource(() => useObjectLibraryStore.getState().objects)

useAccountStore.subscribe((state, prev) => {
  if (state.loaded && (!prev.loaded || state.user?.id !== prev.user?.id)) void load(state.user)
})

// A map opened (or switched to) may hold older copies of the DM's objects.
useDungeonStore.subscribe((state, prev) => {
  if (state.dungeon.id !== prev.dungeon.id) refreshMapCopies()
})
