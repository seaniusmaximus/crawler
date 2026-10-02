/** The DM's Google account and saved campaigns (see worker/index.ts). */

export interface Account {
  id: string
  name: string
  email: string
  picture: string | null
}

export interface Campaign {
  id: string
  name: string
  createdAt: number
  playedAt: number
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Request failed (${response.status})`)
  }
  return (response.status === 204 ? null : await response.json()) as T
}

/** A map in the campaign; exactly one is live (the one players see). */
export interface MapInfo {
  id: string
  name: string
  live: boolean
  floors: number
  rooms: number
  monsters: number
  createdAt: number
  updatedAt: number
}

export interface SavePoint {
  id: number
  name: string
  /** 'auto' every ~10 minutes of editing, 'restore' before a restore or file open, 'named' by the DM. */
  kind: 'auto' | 'restore' | 'named'
  createdAt: number
  size: number
}

export async function fetchMe(): Promise<{ user: Account | null; signIn: boolean }> {
  try {
    return await call('/api/me')
  } catch {
    return { user: null, signIn: false }
  }
}

export async function listCampaigns(): Promise<Campaign[]> {
  return (await call<{ campaigns: Campaign[] }>('/api/campaigns')).campaigns
}

export async function createCampaign(name: string): Promise<Campaign> {
  return (await call<{ campaign: Campaign }>('/api/campaigns', { method: 'POST', body: JSON.stringify({ name }) }))
    .campaign
}

export async function renameCampaign(id: string, name: string): Promise<void> {
  await call(`/api/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) })
}

export async function deleteCampaign(id: string): Promise<void> {
  await call(`/api/campaigns/${id}`, { method: 'DELETE' })
}

export async function listMaps(campaignId: string): Promise<MapInfo[]> {
  return (await call<{ maps: MapInfo[] }>(`/api/campaigns/${campaignId}/maps`)).maps
}

/** A new map: blank, or a copy of `from`. */
export async function createMap(campaignId: string, name: string, from: string | null): Promise<MapInfo> {
  const body = JSON.stringify({ name, from })
  return (await call<{ map: MapInfo }>(`/api/campaigns/${campaignId}/maps`, { method: 'POST', body })).map
}

export async function renameMap(campaignId: string, mapId: string, name: string): Promise<void> {
  await call(`/api/campaigns/${campaignId}/maps/${mapId}`, { method: 'PATCH', body: JSON.stringify({ name }) })
}

export async function deleteMap(campaignId: string, mapId: string): Promise<void> {
  await call(`/api/campaigns/${campaignId}/maps/${mapId}`, { method: 'DELETE' })
}

export async function listSaves(campaignId: string): Promise<SavePoint[]> {
  return (await call<{ saves: SavePoint[] }>(`/api/campaigns/${campaignId}/saves`)).saves
}

/** `safety` keeps it as an automatic "before" copy instead of a named save point. */
export async function createSave(campaignId: string, name: string, safety = false): Promise<SavePoint> {
  const body = JSON.stringify({ name, kind: safety ? 'restore' : 'named' })
  return (await call<{ save: SavePoint }>(`/api/campaigns/${campaignId}/saves`, { method: 'POST', body })).save
}

export async function restoreSave(campaignId: string, saveId: number): Promise<void> {
  await call(`/api/campaigns/${campaignId}/saves/${saveId}/restore`, { method: 'POST' })
}

export async function deleteSave(campaignId: string, saveId: number): Promise<void> {
  await call(`/api/campaigns/${campaignId}/saves/${saveId}`, { method: 'DELETE' })
}

export async function signOut(): Promise<void> {
  await call('/auth/logout', { method: 'POST' })
}

/** Full-page hop to Google; comes back to the page the DM was on. */
export function signInHref(): string {
  const back = `${window.location.pathname}${window.location.search}`
  return `/auth/google?return=${encodeURIComponent(back)}`
}
