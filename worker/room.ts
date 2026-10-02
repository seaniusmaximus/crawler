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

/** Sent straight to everyone, never through the DM's browser: rolls and live token paths. */
const BROADCAST = new Set(['dice', 'travel'])

/** Close codes the client treats as final — no reconnect. */
const CLOSE_REPLACED = 4001
const CLOSE_SIGNED_OUT = 4002
const CLOSE_NOT_HOST = 4003
const CLOSE_NO_TABLE = 4004

/** Stay under the 2 MB per-row limit; snapshots carry PNG portraits. */
const CHUNK = 1_000_000

/** An automatic save point at most this often while the DM is editing. */
const AUTO_EVERY_MS = 10 * 60 * 1000
/** How many of each kind of save point to keep; the oldest go first. */
const KEEP = { auto: 20, restore: 10, named: 50 } as const

export type SaveKind = keyof typeof KEEP

/** One map in the campaign, with a few details for the maps list. */
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
  kind: SaveKind
  createdAt: number
  /** Characters of JSON, roughly bytes. */
  size: number
}

const HOST_SENDS = new Set(['snapshot', 'patch', 'focus', 'dice', 'travel', 'switchMap'])
const GUEST_SENDS = new Set(['hello', 'claim', 'spawn', 'move', 'player', 'opening', 'dice', 'travel', 'resync'])

/**
 * One campaign, kept for as long as its DM wants it. The DM's browser stays
 * authoritative while playing; the room checks who may say what, keeps the
 * latest snapshot for late joiners and a returning DM, and tells everyone who
 * is connected.
 */
export class TableRoom extends DurableObject<RoomEnv> {
  private migrated = false

  /** Created on demand: deleteAll() drops them, and the instance may live on. */
  private ensureTables(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshot (idx INTEGER PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS saves (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        map_id TEXT
      );
      CREATE TABLE IF NOT EXISTS save_chunks (
        save_id INTEGER NOT NULL,
        idx INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (save_id, idx)
      );
      CREATE TABLE IF NOT EXISTS assets (
        hash TEXT PRIMARY KEY,
        mime TEXT NOT NULL,
        data BLOB NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS maps (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sort INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        floors INTEGER NOT NULL DEFAULT 0,
        rooms INTEGER NOT NULL DEFAULT 0,
        monsters INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS map_chunks (
        map_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (map_id, idx)
      );
    `)
    if (this.migrated) return
    this.migrated = true
    // Campaigns from before maps: their save points gain a map column.
    const columns = this.ctx.storage.sql.exec<{ name: string }>('PRAGMA table_info(saves)').toArray()
    if (!columns.some((column) => column.name === 'map_id')) {
      this.ctx.storage.sql.exec('ALTER TABLE saves ADD COLUMN map_id TEXT')
    }
  }

  // ---------- Maps ----------
  //
  // The live map (the one players see) is kept in `snapshot`, exactly as before
  // maps existed; every other map's data sits in `map_chunks`. Switching swaps
  // them. Save points belong to the map they were taken on.

  /** The live map's id; a campaign from before maps gets its one map, "Map 1", here. */
  private liveMapId(): string {
    const id = this.meta('liveMapId')
    if (id) return id
    const created = crypto.randomUUID()
    const now = Date.now()
    this.ctx.storage.sql.exec(
      'INSERT INTO maps (id, name, sort, created_at, updated_at) VALUES (?, ?, 0, ?, ?)',
      created,
      'Map 1',
      now,
      now,
    )
    this.setMeta('liveMapId', created)
    this.ctx.storage.sql.exec('UPDATE saves SET map_id = ? WHERE map_id IS NULL', created)
    const snapshot = this.loadSnapshot()
    if (snapshot) this.recordSummary(created, snapshot)
    return created
  }

  listMaps(): MapInfo[] {
    this.ensureTables()
    const live = this.liveMapId()
    return this.ctx.storage.sql
      .exec<{
        id: string
        name: string
        floors: number
        rooms: number
        monsters: number
        created_at: number
        updated_at: number
      }>('SELECT id, name, floors, rooms, monsters, created_at, updated_at FROM maps ORDER BY sort, created_at')
      .toArray()
      .map((row) => ({
        id: row.id,
        name: row.name,
        live: row.id === live,
        floors: row.floors,
        rooms: row.rooms,
        monsters: row.monsters,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }))
  }

  /** A new map: blank, or a copy of another map (`from`). */
  createMap(name: string, from: string | null): MapInfo {
    this.ensureTables()
    const live = this.liveMapId()
    const sql = this.ctx.storage.sql
    if (from && !sql.exec('SELECT 1 FROM maps WHERE id = ?', from).toArray().length) throw new Error('Map not found')
    const id = crypto.randomUUID()
    const now = Date.now()
    const sort = sql.exec<{ n: number | null }>('SELECT MAX(sort) AS n FROM maps').one().n ?? 0
    this.ctx.storage.transactionSync(() => {
      sql.exec(
        'INSERT INTO maps (id, name, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        id,
        name,
        sort + 1,
        now,
        now,
      )
      if (!from) return
      if (from === live) sql.exec('INSERT INTO map_chunks (map_id, idx, data) SELECT ?, idx, data FROM snapshot', id)
      else sql.exec('INSERT INTO map_chunks (map_id, idx, data) SELECT ?, idx, data FROM map_chunks WHERE map_id = ?', id, from)
      const source = sql
        .exec<{ floors: number; rooms: number; monsters: number }>('SELECT floors, rooms, monsters FROM maps WHERE id = ?', from)
        .one()
      sql.exec('UPDATE maps SET floors = ?, rooms = ?, monsters = ? WHERE id = ?', source.floors, source.rooms, source.monsters, id)
    })
    return this.listMaps().find((map) => map.id === id)!
  }

  renameMap(id: string, name: string): void {
    this.ensureTables()
    this.ctx.storage.sql.exec('UPDATE maps SET name = ? WHERE id = ?', name, id)
  }

  /** Delete a map that isn't live, with its save points. */
  deleteMap(id: string): void {
    this.ensureTables()
    if (id === this.liveMapId()) throw new Error("The map the party is on can't be deleted; move them first")
    const sql = this.ctx.storage.sql
    this.ctx.storage.transactionSync(() => {
      sql.exec('DELETE FROM map_chunks WHERE map_id = ?', id)
      sql.exec('DELETE FROM save_chunks WHERE save_id IN (SELECT id FROM saves WHERE map_id = ?)', id)
      sql.exec('DELETE FROM saves WHERE map_id = ?', id)
      sql.exec('DELETE FROM maps WHERE id = ?', id)
    })
  }

  /** Make `mapId` live and hand its saved map to the DM's browser, which brings the party over. */
  private switchMap(ws: WebSocket, mapId: string): void {
    const live = this.liveMapId()
    const sql = this.ctx.storage.sql
    if (!sql.exec('SELECT 1 FROM maps WHERE id = ?', mapId).toArray().length) {
      ws.send(JSON.stringify({ type: 'mapError', message: 'That map no longer exists' }))
      return
    }
    if (mapId !== live) {
      this.ctx.storage.transactionSync(() => {
        sql.exec('DELETE FROM map_chunks WHERE map_id = ?', live)
        sql.exec('INSERT INTO map_chunks (map_id, idx, data) SELECT ?, idx, data FROM snapshot', live)
        sql.exec('DELETE FROM snapshot')
        sql.exec('INSERT INTO snapshot (idx, data) SELECT idx, data FROM map_chunks WHERE map_id = ?', mapId)
        sql.exec('DELETE FROM map_chunks WHERE map_id = ?', mapId)
        this.setMeta('liveMapId', mapId)
      })
    }
    const snapshot = this.loadSnapshot()
    ws.send(`{"type":"mapLoad","mapId":${JSON.stringify(mapId)},"snapshot":${snapshot ?? 'null'}}`)
  }

  /** Floors, rooms and monsters for the maps list, read from a saved snapshot. */
  private recordSummary(mapId: string, snapshot: string): void {
    let floors = 0
    let rooms = 0
    let monsters = 0
    try {
      const dungeon = (JSON.parse(snapshot) as { dungeon?: { floors?: { rooms?: unknown[] }[]; players?: { kind?: string }[] } }).dungeon
      floors = dungeon?.floors?.length ?? 0
      rooms = (dungeon?.floors ?? []).reduce((sum, floor) => sum + (floor.rooms?.length ?? 0), 0)
      monsters = (dungeon?.players ?? []).filter((player) => player.kind === 'monster').length
    } catch {
      return
    }
    this.ctx.storage.sql.exec(
      'UPDATE maps SET floors = ?, rooms = ?, monsters = ?, updated_at = ? WHERE id = ?',
      floors,
      rooms,
      monsters,
      Date.now(),
      mapId,
    )
  }

  // ---------- Save points ----------

  /** The live map's save points. */
  listSaves(): SavePoint[] {
    this.ensureTables()
    const live = this.liveMapId()
    return this.ctx.storage.sql
      .exec<{ id: number; name: string; kind: SaveKind; created_at: number; size: number }>(
        `SELECT s.id, s.name, s.kind, s.created_at, COALESCE(SUM(LENGTH(c.data)), 0) AS size
         FROM saves s LEFT JOIN save_chunks c ON c.save_id = s.id
         WHERE s.map_id = ?
         GROUP BY s.id ORDER BY s.created_at DESC, s.id DESC`,
        live,
      )
      .toArray()
      .map((row) => ({ id: row.id, name: row.name, kind: row.kind, createdAt: row.created_at, size: row.size }))
  }

  /** A save point of the map as it is now: named by the DM, or a 'restore' safety copy. */
  createSave(name: string, kind: 'named' | 'restore' = 'named'): SavePoint {
    this.ensureTables()
    if (!this.hasSnapshot()) throw new Error('Nothing saved yet — open the campaign first')
    if (kind === 'named') {
      const count = this.ctx.storage.sql
        .exec<{ n: number }>("SELECT COUNT(*) AS n FROM saves WHERE kind = 'named' AND map_id = ?", this.liveMapId())
        .one().n
      if (count >= KEEP.named) throw new Error(`You can keep up to ${KEEP.named} named save points; delete one first`)
    }
    const id = this.ctx.storage.transactionSync(() => this.copyCurrent(name, kind))
    return this.listSaves().find((save) => save.id === id)!
  }

  /** Put a save point back as the current map, keeping what it replaces as its own save point. */
  restoreSave(id: number): void {
    this.ensureTables()
    const save = this.ctx.storage.sql
      .exec<{ name: string }>('SELECT name FROM saves WHERE id = ? AND map_id = ?', id, this.liveMapId())
      .toArray()[0]
    if (!save) throw new Error('Save point not found on this map')
    this.ctx.storage.transactionSync(() => {
      if (this.hasSnapshot()) this.copyCurrent(`Before restoring “${save.name}”`, 'restore')
      this.ctx.storage.sql.exec('DELETE FROM snapshot')
      this.ctx.storage.sql.exec('INSERT INTO snapshot (idx, data) SELECT idx, data FROM save_chunks WHERE save_id = ?', id)
    })
    const snapshot = this.loadSnapshot()
    if (!snapshot) return
    // Players just see the map change; the DM's browser adopts it as its own.
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(seatOf(ws)?.role === 'host' ? `{"type":"restore","snapshot":${snapshot}}` : snapshot)
      } catch {
        // Going away.
      }
    }
  }

  deleteSave(id: number): void {
    this.ensureTables()
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec('DELETE FROM save_chunks WHERE save_id = ?', id)
      this.ctx.storage.sql.exec('DELETE FROM saves WHERE id = ?', id)
    })
  }

  private hasSnapshot(): boolean {
    return this.ctx.storage.sql.exec('SELECT 1 FROM snapshot LIMIT 1').toArray().length > 0
  }

  /** Copy the current snapshot into a new save point (inside a transaction), then prune. */
  private copyCurrent(name: string, kind: SaveKind): number {
    const sql = this.ctx.storage.sql
    const live = this.liveMapId()
    sql.exec('INSERT INTO saves (name, kind, created_at, map_id) VALUES (?, ?, ?, ?)', name, kind, Date.now(), live)
    const id = sql.exec<{ id: number }>('SELECT last_insert_rowid() AS id').one().id
    sql.exec('INSERT INTO save_chunks (save_id, idx, data) SELECT ?, idx, data FROM snapshot', id)
    if (kind !== 'named') {
      const stale = sql
        .exec<{ id: number }>(
          'SELECT id FROM saves WHERE kind = ? AND map_id = ? ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?',
          kind,
          live,
          KEEP[kind],
        )
        .toArray()
      for (const row of stale) {
        sql.exec('DELETE FROM save_chunks WHERE save_id = ?', row.id)
        sql.exec('DELETE FROM saves WHERE id = ?', row.id)
      }
    }
    return id
  }

  /** Every so often while the DM edits, keep a copy they can go back to. */
  private maybeAutoSave(): void {
    const last = this.ctx.storage.sql
      .exec<{ at: number | null }>("SELECT MAX(created_at) AS at FROM saves WHERE kind = 'auto' AND map_id = ?", this.liveMapId())
      .one().at
    if (last !== null && Date.now() - last < AUTO_EVERY_MS) return
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    this.copyCurrent(`Autosave ${stamp} UTC`, 'auto')
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

  // ---------- Images (portraits), stored once per campaign by content hash ----------

  /** Store an image and return its hash; the same bytes always land on the same row. */
  async putAsset(bytes: ArrayBuffer, mime: string): Promise<string> {
    this.ensureTables()
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    const hash = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    this.ctx.storage.sql.exec(
      'INSERT OR IGNORE INTO assets (hash, mime, data, created_at) VALUES (?, ?, ?, ?)',
      hash,
      mime,
      bytes,
      Date.now(),
    )
    return hash
  }

  getAsset(hash: string): { mime: string; data: ArrayBuffer } | null {
    this.ensureTables()
    const row = this.ctx.storage.sql
      .exec<{ mime: string; data: ArrayBuffer }>('SELECT mime, data FROM assets WHERE hash = ?', hash)
      .toArray()[0]
    return row ? { mime: row.mime, data: row.data } : null
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
    let parsed: { type?: unknown; clientId?: unknown; seq?: unknown; fromHost?: unknown; quiet?: unknown; mapId?: unknown }
    try {
      parsed = JSON.parse(message)
    } catch {
      return
    }
    const type = typeof parsed?.type === 'string' ? parsed.type : ''
    const allowed = seat.role === 'host' ? HOST_SENDS : GUEST_SENDS
    if (!allowed.has(type)) return
    if ('clientId' in parsed && parsed.clientId !== seat.id) return
    if (parsed.fromHost && seat.role !== 'host') return

    if (type === 'switchMap') {
      if (typeof parsed.mapId === 'string') this.switchMap(ws, parsed.mapId)
      return
    }

    if (type === 'snapshot') {
      this.saveSnapshot(message)
      this.recordSummary(this.liveMapId(), message)
      // Tell the DM this exact version is safe, so the page can say "Saved".
      if (typeof parsed.seq === 'number') ws.send(JSON.stringify({ type: 'saved', seq: parsed.seq }))
      // A save-only copy: players already have these changes as patches.
      if (parsed.quiet) return
    }

    // The DM speaks to everyone; players speak to the DM, except rolls and live
    // token paths, which everyone sees straight away (even while the DM is away).
    const targets =
      seat.role === 'guest' && !BROADCAST.has(type) ? this.ctx.getWebSockets('host') : this.ctx.getWebSockets()
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
      this.maybeAutoSave()
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
