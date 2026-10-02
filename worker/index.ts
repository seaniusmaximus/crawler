import { configured, currentUser, finishSignIn, signOut, startSignIn, type AuthEnv, type User } from './auth.ts'
import { DmLibrary } from './library.ts'
import { TableRoom, USER_HEADER } from './room.ts'

export { DmLibrary, TableRoom }

export interface Env extends Partial<AuthEnv> {
  TABLE: DurableObjectNamespace<TableRoom>
  LIBRARY: DurableObjectNamespace<DmLibrary>
}

const ROOM_ID = /^[a-z0-9]{4,32}$/
const MAX_NAME = 80

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/crawler-sync/info') {
      return Response.json({ origins: [url.origin] })
    }
    if (path === '/crawler-sync') return openRoom(request, env, url)

    if (path.startsWith('/auth/')) {
      if (!configured(env)) return new Response('Google sign-in is not configured', { status: 503 })
      if (path === '/auth/google') return startSignIn(request, env)
      if (path === '/auth/google/callback') return finishSignIn(request, env)
      if (path === '/auth/logout' && request.method === 'POST') {
        return sameOrigin(request, url) ? signOut(request) : forbidden()
      }
      return new Response(null, { status: 404 })
    }

    if (path.startsWith('/api/')) return api(request, env, url)
    return new Response(null, { status: 404 })
  },
} satisfies ExportedHandler<Env>

async function signedIn(request: Request, env: Env): Promise<User | null> {
  return configured(env) ? currentUser(request, env) : null
}

async function openRoom(request: Request, env: Env, url: URL): Promise<Response> {
  const room = url.searchParams.get('room')?.trim().toLowerCase()
  if (!room || !ROOM_ID.test(room)) return new Response('Missing room', { status: 400 })
  // Only the Worker vouches for who the DM is; drop anything the browser sent.
  const headers = new Headers(request.headers)
  headers.delete(USER_HEADER)
  const user = await signedIn(request, env)
  if (user) headers.set(USER_HEADER, user.id)
  return env.TABLE.get(env.TABLE.idFromName(room)).fetch(new Request(request, { headers }))
}

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname
  const user = await signedIn(request, env)

  if (path === '/api/me') {
    return Response.json({ user, signIn: configured(env) })
  }
  if (!user) return Response.json({ error: 'Sign in first' }, { status: 401 })
  if (request.method !== 'GET' && !sameOrigin(request, url)) return forbidden()

  const library = env.LIBRARY.get(env.LIBRARY.idFromName(user.id))

  if (path === '/api/campaigns') {
    if (request.method === 'GET') return Response.json({ campaigns: await library.list() })
    if (request.method === 'POST') {
      const name = await nameFrom(request)
      const id = campaignId()
      await env.TABLE.get(env.TABLE.idFromName(id)).init(id, user.id)
      return Response.json({ campaign: await library.add(id, name) }, { status: 201 })
    }
    return new Response(null, { status: 405 })
  }

  const match = /^\/api\/campaigns\/([a-z0-9]{4,32})(\/.*)?$/.exec(path)
  if (match) {
    const id = match[1]
    const rest = match[2] ?? ''
    if (!(await library.owns(id))) return Response.json({ error: 'Not found' }, { status: 404 })
    if (rest) return saves(request, env.TABLE.get(env.TABLE.idFromName(id)), rest)
    if (request.method === 'PATCH') {
      await library.rename(id, await nameFrom(request))
      return new Response(null, { status: 204 })
    }
    if (request.method === 'DELETE') {
      await env.TABLE.get(env.TABLE.idFromName(id)).destroy()
      await library.remove(id)
      return new Response(null, { status: 204 })
    }
    return new Response(null, { status: 405 })
  }

  return new Response(null, { status: 404 })
}

/** /api/campaigns/:id/saves[/:saveId[/restore]] — the campaign's save points. */
async function saves(request: Request, room: DurableObjectStub<TableRoom>, rest: string): Promise<Response> {
  const match = /^\/saves(?:\/(\d+)(\/restore)?)?$/.exec(rest)
  if (!match) return new Response(null, { status: 404 })
  const saveId = match[1] ? Number(match[1]) : null
  try {
    if (saveId === null) {
      if (request.method === 'GET') return Response.json({ saves: await room.listSaves() })
      if (request.method === 'POST') {
        const body = await jsonBody(request)
        const save = await room.createSave(cleanName(body.name, 'Save point'), body.kind === 'restore' ? 'restore' : 'named')
        return Response.json({ save }, { status: 201 })
      }
    } else if (match[2] && request.method === 'POST') {
      await room.restoreSave(saveId)
      return new Response(null, { status: 204 })
    } else if (!match[2] && request.method === 'DELETE') {
      await room.deleteSave(saveId)
      return new Response(null, { status: 204 })
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 400 })
  }
  return new Response(null, { status: 405 })
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function cleanName(value: unknown, fallback: string): string {
  return (typeof value === 'string' ? value.trim().slice(0, MAX_NAME) : '') || fallback
}

async function nameFrom(request: Request): Promise<string> {
  return cleanName((await jsonBody(request)).name, 'Untitled campaign')
}

function campaignId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return [...bytes].map((byte) => (byte % 36).toString(36)).join('')
}

/** Cookie-authenticated writes must come from our own pages. */
function sameOrigin(request: Request, url: URL): boolean {
  return request.headers.get('Origin') === url.origin
}

function forbidden(): Response {
  return new Response('Forbidden', { status: 403 })
}
