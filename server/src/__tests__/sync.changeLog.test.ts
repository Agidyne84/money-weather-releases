import { describe, it, expect, beforeEach } from 'vitest'
import sqlite3 from 'sqlite3'
import { readFileSync } from 'fs'
import path from 'path'
import {
  installChangeTracking,
  setApplyingRemote,
  getPendingChanges,
  markChangesPushed,
  prunePushedChanges,
  getSyncMeta,
  setSyncMeta,
  SyncSchemaDb,
  SYNCED_TABLES,
} from '../../../shared/sync/changeLog'

function wrap(db: sqlite3.Database): SyncSchemaDb & { exec(sql: string): Promise<void> } {
  return {
    run: (sql, params = []) =>
      new Promise((resolve, reject) =>
        db.run(sql, params as any[], function (err) {
          if (err) reject(err)
          else resolve(this)
        })
      ),
    all: (sql, params = []) =>
      new Promise<any[]>((resolve, reject) =>
        db.all(sql, params as any[], (err, rows) => (err ? reject(err) : resolve(rows)))
      ),
    exec: (sql) =>
      new Promise<void>((resolve, reject) => db.exec(sql, (err) => (err ? reject(err) : resolve()))),
  }
}

const SCHEMA = `
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  starting_balance REAL NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE user_preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`

describe('sync change log triggers', () => {
  let db: ReturnType<typeof wrap>

  beforeEach(async () => {
    db = wrap(new sqlite3.Database(':memory:'))
    await db.exec(SCHEMA)
    await installChangeTracking(db)
  })

  it('captures insert as upsert with full-row JSON payload', async () => {
    await db.run(`INSERT INTO accounts (id, name, starting_balance) VALUES ('a1', 'Checking', 100.5)`)
    const pending = await getPendingChanges(db)
    expect(pending).toHaveLength(1)
    expect(pending[0].tbl).toBe('accounts')
    expect(pending[0].row_id).toBe('a1')
    expect(pending[0].op).toBe('upsert')
    const payload = JSON.parse(pending[0].payload!)
    expect(payload.id).toBe('a1')
    expect(payload.name).toBe('Checking')
    expect(payload.starting_balance).toBe(100.5)
    expect(typeof payload.created_at).toBe('string')
    expect(pending[0].wall_ms).toBeGreaterThan(1_600_000_000_000)
  })

  it('coalesces multiple pending edits to the same row into one change', async () => {
    await db.run(`INSERT INTO accounts (id, name) VALUES ('a1', 'v1')`)
    await db.run(`UPDATE accounts SET name = 'v2' WHERE id = 'a1'`)
    await db.run(`UPDATE accounts SET name = 'v3' WHERE id = 'a1'`)
    const pending = await getPendingChanges(db)
    expect(pending).toHaveLength(1)
    expect(JSON.parse(pending[0].payload!).name).toBe('v3')
  })

  it('does not coalesce across an already-pushed change', async () => {
    await db.run(`INSERT INTO accounts (id, name) VALUES ('a1', 'v1')`)
    const first = await getPendingChanges(db)
    await markChangesPushed(db, first[0].seq)
    await db.run(`UPDATE accounts SET name = 'v2' WHERE id = 'a1'`)
    const pending = await getPendingChanges(db)
    expect(pending).toHaveLength(1)
    expect(JSON.parse(pending[0].payload!).name).toBe('v2')
    const all = await db.all(`SELECT * FROM _sync_changes ORDER BY seq`)
    expect(all).toHaveLength(2)
    expect(all[0].pushed).toBe(1)
  })

  it('captures delete as tombstone and drops pending upsert for the row', async () => {
    await db.run(`INSERT INTO accounts (id, name) VALUES ('a1', 'v1')`)
    await db.run(`DELETE FROM accounts WHERE id = 'a1'`)
    const pending = await getPendingChanges(db)
    expect(pending).toHaveLength(1)
    expect(pending[0].op).toBe('delete')
    expect(pending[0].payload).toBeNull()
  })

  it('models a primary key change as delete(old) + upsert(new)', async () => {
    await db.run(`INSERT INTO accounts (id, name) VALUES ('a1', 'v1')`)
    const first = await getPendingChanges(db)
    await markChangesPushed(db, first[0].seq)
    await db.run(`UPDATE accounts SET id = 'a2' WHERE id = 'a1'`)
    const pending = await getPendingChanges(db)
    const ops = pending.map((p) => `${p.op}:${p.row_id}`).sort()
    expect(ops).toEqual(['delete:a1', 'upsert:a2'])
  })

  it('does not emit a tombstone when a non-key update leaves the key unchanged', async () => {
    await db.run(`INSERT INTO accounts (id, name) VALUES ('a1', 'v1')`)
    await db.run(`UPDATE accounts SET name = 'v2' WHERE id = 'a1'`)
    const pending = await getPendingChanges(db)
    expect(pending.every((p) => p.op === 'upsert')).toBe(true)
  })

  it('uses the configured primary key for user_preferences', async () => {
    await db.run(`INSERT INTO user_preferences (key, value) VALUES ('currency', 'USD')`)
    const pending = await getPendingChanges(db)
    expect(pending[0].row_id).toBe('currency')
    expect(JSON.parse(pending[0].payload!).value).toBe('USD')
  })

  it('suppresses capture while applying remote changes', async () => {
    await setApplyingRemote(db, true)
    await db.run(`INSERT INTO accounts (id, name) VALUES ('remote', 'from cloud')`)
    await db.run(`UPDATE accounts SET name = 'still remote' WHERE id = 'remote'`)
    await db.run(`DELETE FROM accounts WHERE id = 'remote'`)
    expect(await getPendingChanges(db)).toHaveLength(0)

    await setApplyingRemote(db, false)
    await db.run(`INSERT INTO accounts (id, name) VALUES ('local', 'from user')`)
    expect(await getPendingChanges(db)).toHaveLength(1)
  })

  it('is idempotent and picks up newly added columns on reinstall', async () => {
    await db.run(`ALTER TABLE accounts ADD COLUMN nickname TEXT`)
    await installChangeTracking(db)
    await db.run(`INSERT INTO accounts (id, name, nickname) VALUES ('a1', 'n', 'nick')`)
    const pending = await getPendingChanges(db)
    expect(JSON.parse(pending[0].payload!).nickname).toBe('nick')
  })

  it('prunes pushed changes and keeps pending ones', async () => {
    await db.run(`INSERT INTO accounts (id, name) VALUES ('a1', 'v1')`)
    const first = await getPendingChanges(db)
    await markChangesPushed(db, first[0].seq)
    await db.run(`INSERT INTO accounts (id, name) VALUES ('a2', 'v1')`)
    await prunePushedChanges(db)
    const all = await db.all(`SELECT * FROM _sync_changes`)
    expect(all).toHaveLength(1)
    expect(all[0].row_id).toBe('a2')
  })

  it('installs on the real production schema and captures FK cascades', async () => {
    const real = wrap(new sqlite3.Database(':memory:'))
    await real.exec('PRAGMA foreign_keys = ON')
    await real.exec(readFileSync(path.resolve(__dirname, '../../database/schema.sql'), 'utf8'))
    await installChangeTracking(real)

    // Seed rows inserted by schema.sql (default categories/preferences) are captured;
    // clear them so we can observe only the changes below.
    await real.run(`DELETE FROM _sync_changes`)

    await real.run(`INSERT INTO accounts (id, name, type) VALUES ('acc', 'Chk', 'checking')`)
    await real.run(
      `INSERT INTO transactions (id, name, amount, frequency_unit, start_date, category_id, account_id, type)
       VALUES ('tx', 'Rent', -100, 'months', '2026-01-01', 'cat-rent', 'acc', 'expense')`
    )
    await real.run(
      `INSERT INTO forecast_overrides (id, transaction_id, date, original_amount, override_amount)
       VALUES ('fo', 'tx', '2026-02-01', -100, -90)`
    )
    await real.run(`DELETE FROM transactions WHERE id = 'tx'`)

    const pending = await getPendingChanges(real)
    const ops = pending.map((p) => `${p.op}:${p.tbl}:${p.row_id}`).sort()
    expect(ops).toEqual(['delete:forecast_overrides:fo', 'delete:transactions:tx', 'upsert:accounts:acc'])
    expect(SYNCED_TABLES.map((t) => t.table)).toContain('historical_transactions')
  })

  it('stores and reads sync metadata', async () => {
    expect(await getSyncMeta(db, 'cursor')).toBeNull()
    await setSyncMeta(db, 'cursor', 'abc')
    expect(await getSyncMeta(db, 'cursor')).toBe('abc')
    await setSyncMeta(db, 'cursor', null)
    expect(await getSyncMeta(db, 'cursor')).toBeNull()
  })
})
