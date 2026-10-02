import { DurableObject } from 'cloudflare:workers'

export interface Campaign {
  id: string
  name: string
  createdAt: number
  playedAt: number
}

/** One per DM (keyed by Google account id): the index of their campaigns. */
export class DmLibrary extends DurableObject<object> {
  constructor(ctx: DurableObjectState, env: object) {
    super(ctx, env)
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        played_at INTEGER NOT NULL
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
}
