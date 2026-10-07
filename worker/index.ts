import { configured, currentUser, finishSignIn, signOut, startSignIn, type AuthEnv, type User } from './auth.ts'
import { MAX_LIBRARY_OBJECTS, parseObject } from '../src/objects/custom.ts'
import { DmLibrary } from './library.ts'
import { TableRoom, USER_HEADER } from './room.ts'

export { DmLibrary, TableRoom }

export interface Env extends Partial<AuthEnv> {
  TABLE: DurableObjectNamespace<TableRoom>
  LIBRARY: DurableObjectNamespace<DmLibrary>
}

const ROOM_ID = /^[a-z0-9]{4,32}$/
/** Raster images only: an SVG could carry script. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
/** Portraits are small cutouts; this leaves room under the 2 MB row limit. */
const MAX_ASSET_BYTES = 1_500_000
const MAX_NAME = 80
/** A custom object of the most parts, with long colour names, is well under this. */
const MAX_OBJECT_BYTES = 32_000

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/crawler-sync/info') {
      return Response.json({ origins: [url.origin] })
    }
    if (path === '/crawler-sync') return openRoom(request, env, url)
    if (path.startsWith('/crawler-sync/asset/')) return asset(request, env, url)

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

/**
 * GET  /crawler-sync/asset/:room/:hash — an image, to anyone with the campaign's link.
 * POST /crawler-sync/asset/:room       — the campaign's DM stores one; answers { url }.
 */
async function asset(request: Request, env: Env, url: URL): Promise<Response> {
  const [, , , room, hash] = url.pathname.split('/')
  if (!room || !ROOM_ID.test(room)) return new Response(null, { status: 404 })
  const table = env.TABLE.get(env.TABLE.idFromName(room))

  if (request.method === 'GET' && hash && /^[0-9a-f]{64}$/.test(hash)) {
    if (request.headers.get('If-None-Match') === `"${hash}"`) return new Response(null, { status: 304 })
    const found = await table.getAsset(hash)
    if (!found) return new Response(null, { status: 404 })
    return new Response(found.data, {
      headers: {
        'Content-Type': found.mime,
        // Content-addressed: these bytes never change, so browsers keep them.
        'Cache-Control': 'public, max-age=31536000, immutable',
        ETag: `"${hash}"`,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }

  if (request.method === 'POST' && !hash) {
    const user = await signedIn(request, env)
    if (!user) return Response.json({ error: 'Sign in first' }, { status: 401 })
    if (!sameOrigin(request, url)) return forbidden()
    const owns = await env.LIBRARY.get(env.LIBRARY.idFromName(user.id)).owns(room)
    if (!owns) return Response.json({ error: 'Not found' }, { status: 404 })
    const mime = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase()
    if (!IMAGE_TYPES.has(mime)) return Response.json({ error: 'Images only (PNG, JPEG, WebP, GIF)' }, { status: 415 })
    const bytes = await request.arrayBuffer()
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ASSET_BYTES) {
      return Response.json({ error: 'Image is empty or larger than 1.5 MB' }, { status: 413 })
    }
    const stored = await table.putAsset(bytes, mime)
    return Response.json({ url: `/crawler-sync/asset/${room}/${stored}` }, { status: 201 })
  }

  return new Response(null, { status: 405 })
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

  if (path === '/api/objects') {
    if (request.method === 'GET') return Response.json({ objects: await library.listObjects() })
    return new Response(null, { status: 405 })
  }
  const objectMatch = /^\/api\/objects\/([^/]+)$/.exec(path)
  if (objectMatch) return customObject(request, library, decodeURIComponent(objectMatch[1]))

  const match = /^\/api\/campaigns\/([a-z0-9]{4,32})(\/.*)?$/.exec(path)
  if (match) {
    const id = match[1]
    const rest = match[2] ?? ''
    if (!(await library.owns(id))) return Response.json({ error: 'Not found' }, { status: 404 })
    if (rest.startsWith('/maps')) return maps(request, env.TABLE.get(env.TABLE.idFromName(id)), rest)
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

/**
 * /api/campaigns/:id/maps[/:mapId] — the campaign's maps. Moving the party to a
 * map goes through the DM's live connection instead, since their browser brings
 * the party over.
 */
async function maps(request: Request, room: DurableObjectStub<TableRoom>, rest: string): Promise<Response> {
  const match = /^\/maps(?:\/([0-9a-f-]{36}))?$/.exec(rest)
  if (!match) return new Response(null, { status: 404 })
  const mapId = match[1] ?? null
  try {
    if (!mapId) {
      if (request.method === 'GET') return Response.json({ maps: await room.listMaps() })
      if (request.method === 'POST') {
        const body = await jsonBody(request)
        const from = typeof body.from === 'string' ? body.from : null
        return Response.json({ map: await room.createMap(cleanName(body.name, 'New map'), from) }, { status: 201 })
      }
    } else if (request.method === 'PATCH') {
      await room.renameMap(mapId, cleanName((await jsonBody(request)).name, 'Map'))
      return new Response(null, { status: 204 })
    } else if (request.method === 'DELETE') {
      await room.deleteMap(mapId)
      return new Response(null, { status: 204 })
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 400 })
  }
  return new Response(null, { status: 405 })
}

/** /api/objects/:id — one object in the DM's Custom objects collection, put whole or deleted. */
async function customObject(request: Request, library: DurableObjectStub<DmLibrary>, id: string): Promise<Response> {
  if (request.method === 'DELETE') {
    await library.removeObject(id)
    return new Response(null, { status: 204 })
  }
  if (request.method !== 'PUT') return new Response(null, { status: 405 })
  const text = await request.text()
  if (text.length > MAX_OBJECT_BYTES) return Response.json({ error: 'That object is too big' }, { status: 413 })
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = null
  }
  const def = parseObject(body)
  if (!def || def.id !== id) return Response.json({ error: "That isn't an object" }, { status: 400 })
  if (!(await library.hasObject(id)) && (await library.objectCount()) >= MAX_LIBRARY_OBJECTS) {
    return Response.json({ error: `Custom objects holds at most ${MAX_LIBRARY_OBJECTS}` }, { status: 400 })
  }
  await library.putObject(id, def)
  return Response.json({ object: def })
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
