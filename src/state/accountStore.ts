import { create } from 'zustand'
import * as api from '../net/api.ts'
import type { Account, Campaign } from '../net/api.ts'

interface AccountState {
  /** False until /api/me has answered once. */
  loaded: boolean
  /** Whether this deployment has Google sign-in configured. */
  signInAvailable: boolean
  user: Account | null
  campaigns: Campaign[]
  busy: boolean
  error: string | null
  load: () => Promise<void>
  refreshCampaigns: () => Promise<void>
  createCampaign: (name: string) => Promise<Campaign | null>
  renameCampaign: (id: string, name: string) => Promise<void>
  deleteCampaign: (id: string) => Promise<void>
  signOut: () => Promise<void>
}

export const useAccountStore = create<AccountState>((set, get) => ({
  loaded: false,
  signInAvailable: false,
  user: null,
  campaigns: [],
  busy: false,
  error: null,

  load: async () => {
    const me = await api.fetchMe()
    set({ loaded: true, user: me.user, signInAvailable: me.signIn })
    if (me.user) await get().refreshCampaigns()
  },

  refreshCampaigns: async () => {
    try {
      set({ campaigns: await api.listCampaigns(), error: null })
    } catch (error) {
      set({ error: message(error) })
    }
  },

  createCampaign: async (name) => {
    set({ busy: true, error: null })
    try {
      const campaign = await api.createCampaign(name)
      set({ campaigns: [campaign, ...get().campaigns] })
      return campaign
    } catch (error) {
      set({ error: message(error) })
      return null
    } finally {
      set({ busy: false })
    }
  },

  renameCampaign: async (id, name) => {
    try {
      await api.renameCampaign(id, name)
      set({ campaigns: get().campaigns.map((item) => (item.id === id ? { ...item, name: name.trim() } : item)) })
    } catch (error) {
      set({ error: message(error) })
    }
  },

  deleteCampaign: async (id) => {
    set({ busy: true, error: null })
    try {
      await api.deleteCampaign(id)
      set({ campaigns: get().campaigns.filter((item) => item.id !== id) })
    } catch (error) {
      set({ error: message(error) })
    } finally {
      set({ busy: false })
    }
  },

  signOut: async () => {
    await api.signOut().catch(() => undefined)
    set({ user: null, campaigns: [] })
  },
}))

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}
