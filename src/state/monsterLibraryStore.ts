import { create } from 'zustand'
import * as api from '../net/api.ts'
import type { Account } from '../net/api.ts'
import { inlineImage, isEmbedded } from '../net/assets.ts'
import {
  isInlineImage,
  MAX_LIBRARY_MONSTERS,
  parseTemplate,
  templateFromToken,
  templateKindOf,
  type MonsterTemplate,
} from '../model/monsterTemplates.ts'
import { characterNameOf } from '../model/players.ts'
import type { Player } from '../model/types.ts'
import { useAccountStore } from './accountStore.ts'

/**
 * The DM's Monster and Companion libraries: creatures saved from stat blocks,
 * ready to drop onto any map. One list underneath, each template marked with
 * its library. Kept with their account when signed in, and in this browser
 * otherwise; signing in moves the browser's ones up to the account.
 */
interface MonsterLibraryState {
  monsters: MonsterTemplate[]
  /** Where the library is kept right now. */
  where: 'account' | 'browser'
  error: string | null
  /** The template a token would replace when saved: the one with its name in its library, if any. */
  matchFor: (token: Player) => MonsterTemplate | undefined
  /**
   * Save a monster token, standee and all, replacing the template of the same
   * name. Null when its standee can't be fetched or the library is full.
   */
  saveToken: (token: Player) => Promise<MonsterTemplate | null>
  /** Take a template out of its library. Tokens already placed from it stay as they are. */
  remove: (id: string) => void
}

const STORAGE_KEY = 'crawler.monsterLibrary'

export const useMonsterLibraryStore = create<MonsterLibraryState>((set, get) => ({
  monsters: readBrowser(),
  where: 'browser',
  error: null,

  matchFor: (token) => {
    const name = characterNameOf(token).trim().toLowerCase()
    const kind = templateKindOf(token)
    return get().monsters.find((item) => item.kind === kind && item.name.toLowerCase() === name)
  },

  saveToken: async (token) => {
    let portrait = token.portrait
    // A standee already uploaded to this campaign comes back down as data, so the template works in any campaign.
    if (portrait && !isEmbedded(portrait)) portrait = await inlineImage(portrait)
    if (portrait && !isInlineImage(portrait)) {
      set({ error: "Couldn't fetch the standee image to save with it; try again" })
      return null
    }
    const existing = get().matchFor(token)
    const template = templateFromToken(token, portrait, existing?.id)
    const { monsters, where } = get()
    if (!existing && monsters.length >= MAX_LIBRARY_MONSTERS) {
      set({ error: `Your libraries hold at most ${MAX_LIBRARY_MONSTERS} monsters and companions between them` })
      return null
    }
    const next = existing ? monsters.map((item) => (item.id === existing.id ? template : item)) : [...monsters, template]
    set({ monsters: next, error: null })
    if (where === 'account') {
      api.putMonsterTemplate(template).catch((error: unknown) => set({ error: message(error) }))
    } else if (!writeBrowser(next)) {
      set({ error: 'This browser has no room left to keep it after a reload; sign in to keep your library with your account' })
    }
    return template
  },

  remove: (id) => {
    const { monsters, where } = get()
    const next = monsters.filter((item) => item.id !== id)
    set({ monsters: next, error: null })
    if (where === 'account') {
      api.deleteMonsterTemplate(id).catch((error: unknown) => set({ error: message(error) }))
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
    useMonsterLibraryStore.setState({ monsters: local, where: 'browser', error: null })
    return
  }
  try {
    const stored = (await api.listMonsterTemplates())
      .map(parseTemplate)
      .filter((item): item is MonsterTemplate => item !== null)
    const moving = local.filter((item) => !stored.some((kept) => kept.id === item.id))
    for (const item of moving) await api.putMonsterTemplate(item)
    if (token !== loading) return
    writeBrowser([])
    useMonsterLibraryStore.setState({ monsters: [...stored, ...moving], where: 'account', error: null })
  } catch (error) {
    if (token !== loading) return
    // The account can't be reached: keep working in this browser, and move them up next time.
    useMonsterLibraryStore.setState({ monsters: local, where: 'browser', error: message(error) })
  }
}

function readBrowser(): MonsterTemplate[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.map(parseTemplate).filter((item): item is MonsterTemplate => item !== null) : []
  } catch {
    return []
  }
}

/** False when the browser wouldn't keep it (storage blocked or full): the library then lasts until reload. */
function writeBrowser(monsters: readonly MonsterTemplate[]): boolean {
  try {
    if (monsters.length) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(monsters))
    else window.localStorage.removeItem(STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}

useAccountStore.subscribe((state, prev) => {
  if (state.loaded && (!prev.loaded || state.user?.id !== prev.user?.id)) void load(state.user)
})
// In case the account was known before this module first loaded.
if (useAccountStore.getState().loaded) void load(useAccountStore.getState().user)
