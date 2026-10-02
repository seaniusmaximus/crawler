import { DurableObject } from 'cloudflare:workers'
import type { DmLibrary } from './library.ts'

export interface RoomEnv {
  LIBRARY: DurableObjectNamespace<DmLibrary>
}

/** Set by the Worker after checking the session cookie; never trusted from the browser. */
export const USER_HEADER = 'X-Crawler-User'

type Role = 'host' | 'guest'

interface Seat {
  role: Role
  id: string
}

/** Close codes the client treats as final — no reconnect. */
const CLOSE_REPLACED = 4001
const CLOSE_SIGNED_OUT = 4002
const CLOSE_NOT_HOST = 4003
const CLOSE_NO_TABLE = 4004

/** Stay under the 2 MB per-row limit; snapshots carry PNG portraits. */
const CHUNK = 1_000_000

const HOST_SENDS = new Set(['snapshot', 'focus', 'dice'])
const GUEST_SENDS = new Set(['hello', 'claim', 'spawn', 'move', 'player', 'opening', 'dice', 'travel'])

/**
 * One campaign, kept for as long as its DM wants it. The DM's browser stays
 * authoritative while playing; the room checks who may say what, keeps the
 * latest snapshot for late joiners and a returning DM, and tells everyone who
 * is connected.
 */
export class TableRoom extends DurableObject<RoomEnv> {
  /** Created on demand: deleteAll() drops them, and the instance may live on. */
  private ensureTables(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshot (idx INTEGER PRIMARY KEY, data TEXT NOT NULL);
    `)
  }

  /** Called once by the Worker when a DM creates the campaign. */
  init(id: string, owner: string): void {
    this.ensureTables()
    if (this.meta('owner') !== null) throw new Error('Campaign already exists')
    this.setMeta('id', id)
    this.setMeta('owner', owner)
  }

  owner(): string | null {
    this.ensureTables()
    return this.meta('owner')
  }

  /** Wipe the campaign and send everyone home. */
  async destroy(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) kick(ws, CLOSE_NO_TABLE, 'This table has ended')
    await this.ctx.storage.deleteAll()
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    const params = new URL(request.url).searchParams
    const role: Role = params.get('role') === 'host' ? 'host' : 'guest'
    const id = params.get('id')?.trim() || crypto.randomUUID()
    const user = request.headers.get(USER_HEADER)

    this.ensureTables()
    const owner = this.meta('owner')
    if (owner === null) {
      // Nobody created this room; don't leave the empty tables behind.
      await this.ctx.storage.deleteAll()
      return refuse(CLOSE_NO_TABLE, 'No table with that code')
    }
    if (role === 'host') {
      if (!user) return refuse(CLOSE_SIGNED_OUT, 'Sign in to host')
      if (user !== owner) return refuse(CLOSE_NOT_HOST, 'This table belongs to another DM')
      // One DM seat: a reload or second tab takes over from the old socket.
      for (const old of this.ctx.getWebSockets('host')) kick(old, CLOSE_REPLACED, 'Opened in another tab')
      const campaignId = this.meta('id')
      if (campaignId) await this.env.LIBRARY.get(this.env.LIBRARY.idFromName(owner)).touch(campaignId)
    }

    const pair = new WebSocketPair()
    const ws = pair[1]
    this.ctx.acceptWebSocket(ws, [role])
    ws.serializeAttachment({ role, id } satisfies Seat)

    const snapshot = this.loadSnapshot()
    if (snapshot) ws.send(snapshot)
    this.broadcastPresence()
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== 'string') return
    const seat = seatOf(ws)
    if (!seat) return
    let parsed: { type?: unknown; clientId?: unknown }
    try {
      parsed = JSON.parse(message)
    } catch {
      return
    }
    const type = typeof parsed?.type === 'string' ? parsed.type : ''
    const allowed = seat.role === 'host' ? HOST_SENDS : GUEST_SENDS
    if (!allowed.has(type)) return
    if ('clientId' in parsed && parsed.clientId !== seat.id) return

    if (type === 'snapshot') this.saveSnapshot(message)

    // The DM speaks to everyone; players speak to the DM, except dice, which
    // everyone sees straight away even while the DM is away.
    const targets =
      seat.role === 'guest' && type !== 'dice' ? this.ctx.getWebSockets('host') : this.ctx.getWebSockets()
    for (const peer of targets) {
      if (peer === ws) continue
      try {
        peer.send(message)
      } catch {
        // A socket mid-close; presence will catch up when it finishes.
      }
    }
  }

  webSocketClose(ws: WebSocket, code: number): void {
    try {
      ws.close(code === 1005 ? 1000 : code, 'done')
    } catch {
      // Already closed.
    }
    this.broadcastPresence(ws)
  }

  webSocketError(ws: WebSocket): void {
    this.broadcastPresence(ws)
  }

  private broadcastPresence(leaving?: WebSocket): void {
    const sockets = this.ctx.getWebSockets().filter((ws) => ws !== leaving)
    const seats = sockets.map(seatOf).filter((seat): seat is Seat => seat !== null)
    const message = JSON.stringify({
      type: 'presence',
      host: seats.some((seat) => seat.role === 'host'),
      guests: seats.filter((seat) => seat.role === 'guest').map((seat) => seat.id),
    })
    for (const ws of sockets) {
      try {
        ws.send(message)
      } catch {
        // Ignore sockets that are already going away.
      }
    }
  }

  private meta(key: string): string | null {
    const row = this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key).toArray()[0]
    return row?.value ?? null
  }

  private setMeta(key: string, value: string): void {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value)
  }

  private saveSnapshot(message: string): void {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec('DELETE FROM snapshot')
      for (let start = 0, idx = 0; start < message.length; idx += 1) {
        let end = Math.min(start + CHUNK, message.length)
        // Never split a surrogate pair across two rows.
        const last = message.charCodeAt(end - 1)
        if (end < message.length && last >= 0xd800 && last <= 0xdbff) end -= 1
        this.ctx.storage.sql.exec('INSERT INTO snapshot (idx, data) VALUES (?, ?)', idx, message.slice(start, end))
        start = end
      }
    })
  }

  private loadSnapshot(): string | null {
    const rows = this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM snapshot ORDER BY idx').toArray()
    return rows.length ? rows.map((row) => row.data).join('') : null
  }
}

/**
 * Send someone away. The reason goes out as a message first: a close frame
 * alone doesn't reliably reach the browser through every proxy in front of
 * the room, but messages do.
 */
function kick(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.send(JSON.stringify({ type: 'kicked', code, reason }))
    ws.serializeAttachment(null)
    ws.close(code, reason)
  } catch {
    // Already gone.
  }
}

function seatOf(ws: WebSocket): Seat | null {
  return (ws.deserializeAttachment() as Seat | null) ?? null
}

/** Finish the upgrade, then close with a code the browser can read. */
function refuse(code: number, reason: string): Response {
  const pair = new WebSocketPair()
  pair[1].accept()
  pair[1].close(code, reason)
  return new Response(null, { status: 101, webSocket: pair[0] })
}
