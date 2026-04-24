import { describe, it, expect, beforeEach } from 'vitest'
import sqlite3 from 'sqlite3'
import {
  migrateHistoryOnStartDateChange,
  MigrationDb,
  TransactionSnapshot,
} from '../historyMigration'

// Minimal promise-wrapped sqlite3 for testing
function openMemoryDb(): sqlite3.Database {
  return new sqlite3.Database(':memory:')
}

function wrap(db: sqlite3.Database): MigrationDb & {
  all(sql: string, params?: any[]): Promise<any[]>
  exec(sql: string): Promise<void>
} {
  return {
    get: (sql, params = []) =>
      new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
      ),
    run: (sql, params = []) =>
      new Promise<any>((resolve, reject) =>
        db.run(sql, params, function (err) {
          if (err) reject(err)
          else resolve(this)
        })
      ),
    all: (sql, params = []) =>
      new Promise<any[]>((resolve, reject) =>
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
      ),
    exec: (sql) =>
      new Promise<void>((resolve, reject) =>
        db.exec(sql, (err) => (err ? reject(err) : resolve()))
      ),
  }
}

// Schema for testing
const SCHEMA = `
CREATE TABLE historical_transactions (
  id TEXT PRIMARY KEY,
  transaction_id TEXT,
  account_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  date DATE NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  type TEXT NOT NULL,
  is_manual_edit INTEGER NOT NULL DEFAULT 0,
  is_suppressed INTEGER NOT NULL DEFAULT 0,
  archived_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`

const TX_MONTHLY_15TH: TransactionSnapshot = {
  id: 'tx-1',
  account_id: 'acct-1',
  category_id: 'cat-1',
  name: 'Rent',
  amount: -1200,
  type: 'expense',
  start_date: '2026-01-15',
  frequency_value: 1,
  frequency_unit: 'months',
  is_active: 1,
}

describe('migrateHistoryOnStartDateChange', () => {
  let db: ReturnType<typeof wrap>

  beforeEach(async () => {
    db = wrap(openMemoryDb())
    await db.exec(SCHEMA)
  })

  it('no-op when start date unchanged', async () => {
    const r = await migrateHistoryOnStartDateChange(
      db,
      TX_MONTHLY_15TH,
      '2026-01-15',
      '2026-01-15'
    )
    expect(r.direction).toBe('noop')
    expect(r.inserted).toBe(0)
    expect(r.deleted).toBe(0)
  })

  it('advancing startDate archives occurrences', async () => {
    const r = await migrateHistoryOnStartDateChange(
      db,
      TX_MONTHLY_15TH,
      '2026-01-15',
      '2026-05-15'
    )
    expect(r.direction).toBe('advance')
    expect(r.inserted).toBeGreaterThan(0)
  })

  it('rewinding startDate removes auto-archived rows', async () => {
    // First advance
    await migrateHistoryOnStartDateChange(db, TX_MONTHLY_15TH, '2026-01-15', '2026-05-15')
    // Then rewind
    const r = await migrateHistoryOnStartDateChange(
      db,
      { ...TX_MONTHLY_15TH, start_date: '2026-05-15' },
      '2026-05-15',
      '2026-02-15'
    )
    expect(r.direction).toBe('rewind')
  })
})
