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
          console.log(`[DB] Resolved asset "${relative}" -> ${resolved} (found server package.json in ${dir})`)
          return resolved
        }
      } catch {
        // not our package.json
      }
    }
    dir = path.dirname(dir)
  }
  // Fallback should never happen, but preserves old behavior with clear warning
  const fallback = path.resolve(__dirname, '..', '..', '..')
  const resolved = path.join(fallback, relative)
  console.warn(`[DB] WARNING: Could not find server package.json. Fallback for "${relative}" -> ${resolved}`)
  return resolved
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
    const dbPath = resolveServerAsset('database/budget.db')
    databaseInstance = new Database(dbPath)
  }
  return databaseInstance
}

export async function initializeDatabase(): Promise<void> {
  const db = getDatabase()
  await db.initialize()
}
