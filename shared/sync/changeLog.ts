// Sync v2 — change capture schema shared by desktop (server sqlite3) and mobile
// (Capacitor SQLite). Every INSERT / UPDATE / DELETE on a synced table is recorded
// in `_sync_changes` by SQLite triggers, so the capture is identical on both
// platforms and independent of whichever code path performed the write.
//
// Suppression: while the engine applies remote changes it sets
// `_sync_meta.applying = '1'`; the triggers' WHEN clause skips capture so remote
// rows are not echoed back to the cloud.
//
// Coalescing: only the latest pending (unpushed) change per (table,row) is kept.

export const SYNC_CHANGES_TABLE = '_sync_changes'
export const SYNC_META_TABLE = '_sync_meta'
export const SYNC_META_APPLYING = 'applying'

/** Tables replicated to the cloud, in foreign-key-safe apply order. */
export const SYNCED_TABLES: ReadonlyArray<{ table: string; pk: string }> = [
  { table: 'accounts', pk: 'id' },
  { table: 'categories', pk: 'id' },
  { table: 'transactions', pk: 'id' },
  { table: 'forecast_overrides', pk: 'id' },
  { table: 'transaction_rules', pk: 'id' },
  { table: 'historical_transactions', pk: 'id' },
  { table: 'user_preferences', pk: 'key' },
]

export type SyncOp = 'upsert' | 'delete'

export interface SyncChangeRow {
  seq: number
  tbl: string
  row_id: string
  op: SyncOp
  payload: string | null
  wall_ms: number
  pushed: number
}

/** Minimal async DB surface both platforms can satisfy. One statement per call. */
export interface SyncSchemaDb {
  run(sql: string, params?: unknown[]): Promise<unknown>
  all(sql: string, params?: unknown[]): Promise<any[]>
}

function q(ident: string): string {
  return '"' + ident.replace(/"/g, '""') + '"'
}

function lit(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'"
}

/** DDL statements (each a single statement) for the sync bookkeeping tables. */
export function syncSchemaDdl(): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS ${SYNC_META_TABLE} (key TEXT PRIMARY KEY, value TEXT)`,
    `INSERT OR IGNORE INTO ${SYNC_META_TABLE} (key, value) VALUES (${lit(SYNC_META_APPLYING)}, '0')`,
    `CREATE TABLE IF NOT EXISTS ${SYNC_CHANGES_TABLE} (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      tbl TEXT NOT NULL,
      row_id TEXT NOT NULL,
      op TEXT NOT NULL CHECK (op IN ('upsert','delete')),
      payload TEXT,
      wall_ms INTEGER NOT NULL,
      pushed INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sync_changes_pending ON ${SYNC_CHANGES_TABLE} (pushed, seq)`,
    `CREATE INDEX IF NOT EXISTS idx_sync_changes_row ON ${SYNC_CHANGES_TABLE} (tbl, row_id)`,
  ]
}

const WALL_MS_SQL = `CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)`
const NOT_APPLYING = `(SELECT value FROM ${SYNC_META_TABLE} WHERE key = ${lit(SYNC_META_APPLYING)}) IS NOT '1'`

function jsonObjectSql(prefix: 'NEW' | 'OLD', columns: string[]): string {
  return 'json_object(' + columns.map((c) => `${lit(c)}, ${prefix}.${q(c)}`).join(', ') + ')'
}

function triggerNames(table: string): { ins: string; upd: string; del: string } {
  return {
    ins: `_sync_ai_${table}`,
    upd: `_sync_au_${table}`,
    del: `_sync_ad_${table}`,
  }
}

/**
 * Build DROP + CREATE TRIGGER statements for one table. Each returned string is a
 * single SQL statement. Trigger bodies are emitted on one line so naive ';\n'
 * statement splitters (used by some SQLite wrappers) do not break them.
 */
export function buildTriggerSql(table: string, pk: string, columns: string[]): string[] {
  if (!columns.includes(pk)) {
    throw new Error(`Table ${table} has no primary key column ${pk}`)
  }
  const t = lit(table)
  const pkNew = `NEW.${q(pk)}`
  const pkOld = `OLD.${q(pk)}`
  const names = triggerNames(table)
  const insertCols = `INSERT INTO ${SYNC_CHANGES_TABLE} (tbl, row_id, op, payload, wall_ms)`

  const upsertNew =
    `DELETE FROM ${SYNC_CHANGES_TABLE} WHERE tbl = ${t} AND row_id = ${pkNew} AND pushed = 0; ` +
    `${insertCols} VALUES (${t}, ${pkNew}, 'upsert', ${jsonObjectSql('NEW', columns)}, ${WALL_MS_SQL}); `

  const deleteOld =
    `DELETE FROM ${SYNC_CHANGES_TABLE} WHERE tbl = ${t} AND row_id = ${pkOld} AND pushed = 0; ` +
    `${insertCols} VALUES (${t}, ${pkOld}, 'delete', NULL, ${WALL_MS_SQL}); `

  // On UPDATE, a primary-key change is modelled as delete(OLD) + upsert(NEW).
  // The tombstone is only emitted when the key actually changed.
  const tombstoneOldIfKeyChanged =
    `DELETE FROM ${SYNC_CHANGES_TABLE} WHERE tbl = ${t} AND row_id = ${pkOld} AND pushed = 0 AND ${pkNew} IS NOT ${pkOld}; ` +
    `${insertCols} SELECT ${t}, ${pkOld}, 'delete', NULL, ${WALL_MS_SQL} WHERE ${pkNew} IS NOT ${pkOld}; `

  return [
    `DROP TRIGGER IF EXISTS ${q(names.ins)}`,
    `DROP TRIGGER IF EXISTS ${q(names.upd)}`,
    `DROP TRIGGER IF EXISTS ${q(names.del)}`,
    `CREATE TRIGGER ${q(names.ins)} AFTER INSERT ON ${q(table)} WHEN ${NOT_APPLYING} BEGIN ${upsertNew}END`,
    `CREATE TRIGGER ${q(names.upd)} AFTER UPDATE ON ${q(table)} WHEN ${NOT_APPLYING} BEGIN ${tombstoneOldIfKeyChanged}${upsertNew}END`,
    `CREATE TRIGGER ${q(names.del)} AFTER DELETE ON ${q(table)} WHEN ${NOT_APPLYING} BEGIN ${deleteOld}END`,
  ]
}

/**
 * Create bookkeeping tables and (re)install capture triggers for every synced
 * table that exists. Idempotent; call after all schema migrations so the JSON
 * payload includes newly added columns.
 */
export async function installChangeTracking(db: SyncSchemaDb): Promise<void> {
  for (const stmt of syncSchemaDdl()) {
    await db.run(stmt)
  }
  for (const { table, pk } of SYNCED_TABLES) {
    const cols: any[] = await db.all(`PRAGMA table_info(${q(table)})`)
    if (!cols || cols.length === 0) continue
    const columns = cols.map((c) => String(c.name))
    for (const stmt of buildTriggerSql(table, pk, columns)) {
      await db.run(stmt)
    }
  }
}

/** Toggle trigger suppression while applying remote changes. */
export async function setApplyingRemote(db: SyncSchemaDb, applying: boolean): Promise<void> {
  await db.run(
    `INSERT OR REPLACE INTO ${SYNC_META_TABLE} (key, value) VALUES (${lit(SYNC_META_APPLYING)}, ?)`,
    [applying ? '1' : '0']
  )
}

export async function getSyncMeta(db: SyncSchemaDb, key: string): Promise<string | null> {
  const rows = await db.all(`SELECT value FROM ${SYNC_META_TABLE} WHERE key = ?`, [key])
  return rows.length ? (rows[0].value ?? null) : null
}

export async function setSyncMeta(db: SyncSchemaDb, key: string, value: string | null): Promise<void> {
  if (value === null) {
    await db.run(`DELETE FROM ${SYNC_META_TABLE} WHERE key = ?`, [key])
  } else {
    await db.run(`INSERT OR REPLACE INTO ${SYNC_META_TABLE} (key, value) VALUES (?, ?)`, [key, value])
  }
}

export async function getPendingChanges(db: SyncSchemaDb, limit = 5000): Promise<SyncChangeRow[]> {
  return db.all(
    `SELECT seq, tbl, row_id, op, payload, wall_ms, pushed FROM ${SYNC_CHANGES_TABLE} WHERE pushed = 0 ORDER BY seq LIMIT ?`,
    [limit]
  )
}

export async function markChangesPushed(db: SyncSchemaDb, upToSeq: number): Promise<void> {
  await db.run(`UPDATE ${SYNC_CHANGES_TABLE} SET pushed = 1 WHERE pushed = 0 AND seq <= ?`, [upToSeq])
}

export async function prunePushedChanges(db: SyncSchemaDb): Promise<void> {
  await db.run(`DELETE FROM ${SYNC_CHANGES_TABLE} WHERE pushed = 1`)
}
