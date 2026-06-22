import sqlite3 from 'sqlite3'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

// Resolve path to the server/database folder regardless of dist layout
// (flat: dist/*.js  vs  nested: dist/server/src/*.js).
// IMPORTANT: This must always return the SAME canonical path to avoid
// accidentally creating or using a second empty database somewhere else.
function resolveServerAsset(relative: string): string {
  // Walk up from __dirname until we find the server directory by its package.json
  let dir = __dirname
  while (dir !== path.dirname(dir)) {
    const pkgPath = path.join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
        if (pkg.name === 'budget-app-server') {
          const resolved = path.join(dir, relative)
          if (existsSync(resolved)) {
            console.log(`[DB] Resolved asset "${relative}" -> ${resolved} (found server package.json in ${dir})`)
            return resolved
          }
        }
      } catch {
        // not our package.json
      }
    }
    dir = path.dirname(dir)
  }

  // Fallback 1: canonical server tree even when package.json is missing
  const fallback1 = path.resolve(__dirname, '..', '..', '..', relative)
  if (existsSync(fallback1)) {
    console.log(`[DB] Resolved asset "${relative}" -> ${fallback1} (fallback path)`)
    return fallback1
  }

  // Fallback 2: Electron assets directory (unpacked or outside asar)
  const resourcesPath = (process as any).resourcesPath as string | undefined
  if (resourcesPath) {
    const fallback2 = path.join(resourcesPath, 'assets', relative)
    if (existsSync(fallback2)) {
      console.log(`[DB] Resolved asset "${relative}" -> ${fallback2} (assets fallback)`)
      return fallback2
    }
  }

  // Fallback 3: assets bundled inside app.asar (Electron packs files[] into asar)
  if (resourcesPath) {
    const fallback3 = path.join(resourcesPath, 'app.asar', 'assets', relative)
    if (existsSync(fallback3)) {
      console.log(`[DB] Resolved asset "${relative}" -> ${fallback3} (asar assets fallback)`)
      return fallback3
    }
  }

  // Fallback 4: deeper server tree walk (some builds nest extraResources deeper)
  const fallback4 = path.resolve(__dirname, '..', '..', '..', '..', relative)
  if (existsSync(fallback4)) {
    console.log(`[DB] Resolved asset "${relative}" -> ${fallback4} (deep fallback)`)
    return fallback4
  }

  // Last resort: return fallback1 so the error message points to the expected location
  console.warn(`[DB] WARNING: Could not find "${relative}". Expected at: ${fallback1}`)
  return fallback1
}

export class Database {
  private db: sqlite3.Database

  constructor(dbPath: string) {
    this.db = new sqlite3.Database(dbPath)
  }

  async initialize(): Promise<void> {
    // 1) Apply the declarative schema (CREATE TABLE IF NOT EXISTS …).
    await new Promise<void>((resolve, reject) => {
      const schema = readFileSync(resolveServerAsset('database/schema.sql'), 'utf8')
      this.db.exec(schema, (err) => {
        if (err) {
          console.error('Error initializing database:', err)
          reject(err)
        } else {
          resolve()
        }
      })
    })

    // 2) Forward migrations for columns added after the initial release.
    //    `ALTER TABLE ADD COLUMN` is not idempotent on SQLite, so we guard
    //    each step with a PRAGMA table_info() existence check.
    await this.ensureColumn(
      'historical_transactions',
      'is_manual_edit',
      'INTEGER NOT NULL DEFAULT 0'
    )
    await this.ensureColumn(
      'historical_transactions',
      'is_suppressed',
      'INTEGER NOT NULL DEFAULT 0'
    )
    await this.ensureColumn(
      'historical_transactions',
      'is_posted',
      'INTEGER NOT NULL DEFAULT 1'
    )
    await this.ensureColumn(
      'transactions',
      'transfer_to_account_id',
      'TEXT'
    )
    await this.ensureColumn(
      'historical_transactions',
      'transfer_to_account_id',
      'TEXT'
    )
    await this.ensureColumn(
      'transactions',
      'is_transfer',
      'INTEGER DEFAULT 0'
    )
    await this.ensureColumn(
      'historical_transactions',
      'is_transfer',
      'INTEGER DEFAULT 0'
    )
    await this.ensureColumn(
      'historical_transactions',
      'is_excluded',
      'INTEGER NOT NULL DEFAULT 0'
    )
    await this.ensureColumn(
      'historical_transactions',
      'bank_description',
      'TEXT'
    )

    // 2b) Recreate transaction_rules if it is using the old schema (missing
    //     the transaction_id column added in the Phase 3 rules engine).
    //     There are no user-created rules in the old schema, so this is safe.
    const ruleCols: any[] = await this.all('PRAGMA table_info(transaction_rules)')
    const hasTransactionId = ruleCols.some((c: any) => c.name === 'transaction_id')
    if (!hasTransactionId) {
      await this.run('DROP TABLE IF EXISTS transaction_rules')
      await this.run(`
        CREATE TABLE transaction_rules (
          id TEXT PRIMARY KEY,
          transaction_id TEXT,
          account_id TEXT,
          restrict_to_account INTEGER NOT NULL DEFAULT 0,
          pattern TEXT NOT NULL,
          category_id TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          match_count INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL,
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
          FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
        )
      `)
      console.log('Migration: recreated transaction_rules with new schema')
    }

    // 3) Fix any rows in `transactions` that have a NULL id (can happen if
    //    rows were inserted before the id column existed or via raw SQL).
    const nullIdRows = await this.all("SELECT rowid FROM transactions WHERE id IS NULL")
    for (const row of nullIdRows) {
      const newId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      await this.run('UPDATE transactions SET id = ? WHERE rowid = ?', [newId, row.rowid])
      console.log(`Migration: assigned id ${newId} to transaction rowid ${row.rowid}`)
    }
    if (nullIdRows.length > 0) {
      console.log(`Migration: fixed ${nullIdRows.length} transaction(s) with null id`)
    }

    console.log('Database initialized successfully')
  }

  /** Add `column` to `table` with `definition` if it doesn't already exist. */
  private async ensureColumn(table: string, column: string, definition: string): Promise<void> {
    const cols: any[] = await this.all(`PRAGMA table_info(${table})`)
    if (cols.some(c => c.name === column)) return
    await this.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    console.log(`Migration: added ${table}.${column}`)
  }

  // Helper to run queries with promises
  async all(query: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.db.all(query, params, (err, rows) => {
        if (err) reject(err)
        else resolve(rows)
      })
    })
  }

  async get(query: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      this.db.get(query, params, (err, row) => {
        if (err) reject(err)
        else resolve(row)
      })
    })
  }

  async run(query: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      this.db.run(query, params, function(err) {
        if (err) reject(err)
        else resolve(this)
      })
    })
  }

  // Helper function to convert database rows to camelCase
  static toCamelCase(row: any): any {
    if (!row) return row
    const camelRow: any = {}
    for (const key in row) {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
      camelRow[camelKey] = row[key]
    }
    return camelRow
  }

  static toCamelCaseRows(rows: any[]): any[] {
    return rows.map(row => Database.toCamelCase(row))
  }

  close(): void {
    this.db.close()
  }
}

// Singleton instance
let databaseInstance: Database | null = null

export function getDatabase(): Database {
  if (!databaseInstance) {
    const dbPath = process.env.BUDGET_DB_PATH || resolveServerAsset('database/budget.db')
    console.log(`[DB] Using database path: ${dbPath}`)
    databaseInstance = new Database(dbPath)
  }
  return databaseInstance
}

export async function initializeDatabase(): Promise<void> {
  const db = getDatabase()
  await db.initialize()
}
