import { DurableObject } from 'cloudflare:workers'

export interface Env {
  TABLE: DurableObjectNamespace<TableRoom>
}

type Role = 'host' | 'guest'

interface Seat {
  role: Role
  id: string
}

/** Close codes the client treats as final — no reconnect. */
const CLOSE_REPLACED = 4001
const CLOSE_NOT_HOST = 4003
const CLOSE_NO_TABLE = 4004

/** Rooms nobody has touched for this long are wiped by the alarm. */
const IDLE_MS = 30 * 24 * 60 * 60 * 1000

/** Stay under the 2 MB per-row limit; snapshots carry PNG portraits. */
const CHUNK = 1_000_000

const HOST_SENDS = new Set(['snapshot', 'focus', 'dice'])
const GUEST_SENDS = new Set(['hello', 'claim', 'move', 'player', 'opening', 'dice', 'travel'])

/**
 * One hibernating room. The DM's browser stays authoritative; the room checks
 * who may say what, keeps the latest snapshot for late joiners and a returning
 * DM, and tells everyone who is connected.
 */
export class TableRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshot (idx INTEGER PRIMARY KEY, data TEXT NOT NULL);
    `)
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    const params = new URL(request.url).searchParams
    const role: Role = params.get('role') === 'host' ? 'host' : 'guest'
    const id = params.get('id')?.trim() || crypto.randomUUID()
    const token = params.get('token') ?? ''

    const hostToken = this.meta('hostToken')
    if (role === 'host') {
      if (!token) return refuse(CLOSE_NOT_HOST, 'Missing host token')
      if (hostToken === null) this.setMeta('hostToken', token)
      else if (hostToken !== token) return refuse(CLOSE_NOT_HOST, 'This table belongs to another DM')
    } else if (hostToken === null) {
      return refuse(CLOSE_NO_TABLE, 'No table with that code')
    }

    if (role === 'host') {
      // One DM seat: a reload or second tab takes over from the old socket.
      for (const old of this.ctx.getWebSockets('host')) {
        try {
          old.serializeAttachment(null)
          old.close(CLOSE_REPLACED, 'Opened in another tab')
        } catch {
          // Already gone.
        }
      }
    }

    const pair = new WebSocketPair()
    const ws = pair[1]
    this.ctx.acceptWebSocket(ws, [role])
    ws.serializeAttachment({ role, id } satisfies Seat)

    const snapshot = this.loadSnapshot()
    if (snapshot) ws.send(snapshot)
    this.broadcastPresence()
    await this.touch()
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
      seat.role === 'guest' && type !== 'dice'
        ? this.ctx.getWebSockets('host')
        : this.ctx.getWebSockets()
    for (const peer of targets) {
      if (peer === ws) continue
      try {
        peer.send(message)
      } catch {
        // A socket mid-close; presence will catch up when it finishes.
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, 'done')
    } catch {
      // Already closed.
    }
    this.broadcastPresence(ws)
    await this.touch()
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.broadcastPresence(ws)
    await this.touch()
  }

  async alarm(): Promise<void> {
    if (this.ctx.getWebSockets().length > 0) {
      await this.touch()
      return
    }
    await this.ctx.storage.deleteAll()
  }

  private async touch(): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + IDLE_MS)
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

export default {
  fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/crawler-sync/info') {
      return Response.json({ origins: [url.origin] })
    }
    if (url.pathname === '/crawler-sync') {
      const room = url.searchParams.get('room')?.trim().toLowerCase()
      if (!room || !/^[a-z0-9]{4,32}$/.test(room)) return new Response('Missing room', { status: 400 })
      return env.TABLE.get(env.TABLE.idFromName(room)).fetch(request)
    }
    return new Response(null, { status: 404 })
  },
} satisfies ExportedHandler<Env>
