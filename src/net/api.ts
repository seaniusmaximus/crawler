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

export async function signOut(): Promise<void> {
  await call('/auth/logout', { method: 'POST' })
}

/** Full-page hop to Google; comes back to the page the DM was on. */
export function signInHref(): string {
  const back = `${window.location.pathname}${window.location.search}`
  return `/auth/google?return=${encodeURIComponent(back)}`
}
