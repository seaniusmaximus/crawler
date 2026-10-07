import { DurableObject } from 'cloudflare:workers'

export interface Campaign {
  id: string
  name: string
  createdAt: number
  playedAt: number
}

/** One per DM (keyed by Google account id): the index of their campaigns, and their Custom objects. */
export class DmLibrary extends DurableObject<object> {
  constructor(ctx: DurableObjectState, env: object) {
    super(ctx, env)
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        played_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS objects (
        id TEXT PRIMARY KEY,
        def TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
  }

  list(): Campaign[] {
    return this.ctx.storage.sql
      .exec<{ id: string; name: string; created_at: number; played_at: number }>(
        'SELECT id, name, created_at, played_at FROM campaigns ORDER BY played_at DESC',
      )
      .toArray()
      .map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at, playedAt: row.played_at }))
  }

  owns(id: string): boolean {
    return this.ctx.storage.sql.exec('SELECT 1 FROM campaigns WHERE id = ?', id).toArray().length > 0
  }

  add(id: string, name: string): Campaign {
    const now = Date.now()
    this.ctx.storage.sql.exec(
      'INSERT INTO campaigns (id, name, created_at, played_at) VALUES (?, ?, ?, ?)',
      id,
      name,
      now,
      now,
    )
    return { id, name, createdAt: now, playedAt: now }
  }

  rename(id: string, name: string): void {
    this.ctx.storage.sql.exec('UPDATE campaigns SET name = ? WHERE id = ?', name, id)
  }

  touch(id: string): void {
    this.ctx.storage.sql.exec('UPDATE campaigns SET played_at = ? WHERE id = ?', Date.now(), id)
  }

  remove(id: string): void {
    this.ctx.storage.sql.exec('DELETE FROM campaigns WHERE id = ?', id)
  }

  /** The DM's custom objects, oldest first, each as the JSON the client sent (already cleaned). */
  listObjects(): unknown[] {
    return this.ctx.storage.sql
      .exec<{ def: string }>('SELECT def FROM objects ORDER BY rowid')
      .toArray()
      .map((row) => JSON.parse(row.def) as unknown)
  }

  objectCount(): number {
    return this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM objects').one().n
  }

  hasObject(id: string): boolean {
    return this.ctx.storage.sql.exec('SELECT 1 FROM objects WHERE id = ?', id).toArray().length > 0
  }

  putObject(id: string, def: unknown): void {
    // An upsert keeps the row (and so its place in the list) when an object is edited.
    this.ctx.storage.sql.exec(
      'INSERT INTO objects (id, def, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET def = excluded.def, updated_at = excluded.updated_at',
      id,
      JSON.stringify(def),
      Date.now(),
    )
  }

  removeObject(id: string): void {
    this.ctx.storage.sql.exec('DELETE FROM objects WHERE id = ?', id)
  }
}
