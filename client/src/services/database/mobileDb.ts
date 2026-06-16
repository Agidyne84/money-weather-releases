// Mobile Database — Capacitor SQLite connection and initialization
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite'
import { Preferences } from '@capacitor/preferences'

const DB_NAME = 'budget.db'
let dbConnection: SQLiteDBConnection | null = null
let sqliteConnection: SQLiteConnection | null = null

// Embedded schema — avoids fetch() issues in Capacitor WebView
const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT CHECK(type IN ('checking', 'savings', 'credit', 'investment')) NOT NULL,
    starting_balance REAL NOT NULL DEFAULT 0,
    current_balance REAL NOT NULL DEFAULT 0,
    include_in_low_balance_analysis BOOLEAN DEFAULT TRUE,
    import_settings TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT,
    color TEXT NOT NULL DEFAULT '#3B82F6',
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    amount REAL NOT NULL,
    frequency_value INTEGER NOT NULL DEFAULT 1,
    frequency_unit TEXT CHECK(frequency_unit IN ('days', 'weeks', 'months', 'years', 'custom')) NOT NULL DEFAULT 'months',
    custom_frequency_pattern TEXT,
    start_date DATE NOT NULL,
    end_date DATE,
    pause_start_date DATE,
    pause_end_date DATE,
    category_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    type TEXT CHECK(type IN ('income', 'expense', 'administrative')) NOT NULL,
    transfer_to_account_id TEXT,
    is_transfer INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
    FOREIGN KEY (transfer_to_account_id) REFERENCES accounts(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS forecast_overrides (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL,
    date DATE NOT NULL,
    original_amount REAL NOT NULL,
    override_amount REAL NOT NULL,
    is_posted BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transaction_rules (
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
);

CREATE TABLE IF NOT EXISTS historical_transactions (
    id TEXT PRIMARY KEY,
    transaction_id TEXT,
    account_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    date DATE NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    type TEXT CHECK(type IN ('income', 'expense', 'administrative')) NOT NULL,
    transfer_to_account_id TEXT,
    is_transfer INTEGER DEFAULT 0,
    is_excluded INTEGER NOT NULL DEFAULT 0,
    is_manual_edit INTEGER NOT NULL DEFAULT 0,
    is_suppressed INTEGER NOT NULL DEFAULT 0,
    is_posted INTEGER NOT NULL DEFAULT 1,
    bank_description TEXT,
    archived_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS user_preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO categories (id, name, parent_id, color, sort_order) VALUES
    ('cat-income', 'Income', NULL, '#10B981', 1),
    ('cat-housing', 'Housing', NULL, '#EF4444', 2),
    ('cat-transportation', 'Transportation', NULL, '#6B7280', 3),
    ('cat-food', 'Food', NULL, '#F59E0B', 4),
    ('cat-utilities', 'Utilities', NULL, '#3B82F6', 5),
    ('cat-healthcare', 'Healthcare', NULL, '#EC4899', 6),
    ('cat-savings', 'Savings', NULL, '#14B8A6', 7),
    ('cat-entertainment', 'Entertainment', NULL, '#8B5CF6', 8),
    ('cat-other', 'Other', NULL, '#6B7280', 9);

INSERT OR IGNORE INTO categories (id, name, parent_id, color, sort_order) VALUES
    ('cat-groceries', 'Groceries', 'cat-food', '#F59E0B', 1),
    ('cat-restaurants', 'Restaurants', 'cat-food', '#F59E0B', 2),
    ('cat-rent', 'Rent/Mortgage', 'cat-housing', '#EF4444', 1),
    ('cat-home-insurance', 'Home Insurance', 'cat-housing', '#EF4444', 2),
    ('cat-property-tax', 'Property Tax', 'cat-housing', '#EF4444', 3),
    ('cat-gas', 'Gas/Fuel', 'cat-transportation', '#6B7280', 1),
    ('cat-car-insurance', 'Car Insurance', 'cat-transportation', '#6B7280', 2),
    ('cat-car-maintenance', 'Car Maintenance', 'cat-transportation', '#6B7280', 3),
    ('cat-electric', 'Electric', 'cat-utilities', '#3B82F6', 1),
    ('cat-water', 'Water', 'cat-utilities', '#3B82F6', 2),
    ('cat-gas-utility', 'Gas Utility', 'cat-utilities', '#3B82F6', 3),
    ('cat-internet', 'Internet', 'cat-utilities', '#3B82F6', 4),
    ('cat-phone', 'Phone', 'cat-utilities', '#3B82F6', 5);

INSERT OR IGNORE INTO user_preferences (key, value) VALUES
    ('currency', 'USD'),
    ('date_format', 'MM/DD/YYYY'),
    ('forecast_start_date', DATE('now')),
    ('low_balance_tracking_count', '10'),
    ('include_net_worth_in_analysis', 'true');
`;

export async function getDbConnection(): Promise<SQLiteDBConnection> {
  if (dbConnection) return dbConnection

  sqliteConnection = new SQLiteConnection(CapacitorSQLite)

  // Check if connection exists and retrieve it, otherwise create new
  const isConn = await sqliteConnection.isConnection(DB_NAME, false)
  if (isConn.result) {
    dbConnection = await sqliteConnection.retrieveConnection(DB_NAME, false)
  } else {
    dbConnection = await sqliteConnection.createConnection(
      DB_NAME,
      false,
      'no-encryption',
      1,
      false
    )
    await dbConnection.open()
  }

  return dbConnection
}

export async function initializeDatabase(): Promise<void> {
  const db = await getDbConnection()

  // Execute embedded schema — idempotent (CREATE TABLE IF NOT EXISTS)
  const statements = SCHEMA
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'))

  for (const stmt of statements) {
    try {
      await db.execute(stmt + ';')
    } catch (err) {
      const msg = String(err)
      if (!msg.includes('already exists')) {
        console.warn('[Mobile DB] Schema init warning:', msg)
      }
    }
  }

  // Forward migrations — run every time, check table existence first
  await ensureColumn(db, 'historical_transactions', 'is_manual_edit', 'INTEGER NOT NULL DEFAULT 0')
  await ensureColumn(db, 'historical_transactions', 'is_suppressed', 'INTEGER NOT NULL DEFAULT 0')
  await ensureColumn(db, 'historical_transactions', 'is_posted', 'INTEGER NOT NULL DEFAULT 1')
  await ensureColumn(db, 'transactions', 'transfer_to_account_id', 'TEXT')
  await ensureColumn(db, 'historical_transactions', 'transfer_to_account_id', 'TEXT')
  await ensureColumn(db, 'transactions', 'is_transfer', 'INTEGER DEFAULT 0')
  await ensureColumn(db, 'historical_transactions', 'is_transfer', 'INTEGER DEFAULT 0')
  await ensureColumn(db, 'historical_transactions', 'is_excluded', 'INTEGER NOT NULL DEFAULT 0')

  await Preferences.set({ key: 'db_initialized', value: 'true' })
}

async function tableExists(db: SQLiteDBConnection, table: string): Promise<boolean> {
  const result = await db.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    [table]
  )
  return (result.values || []).length > 0
}

async function ensureColumn(
  db: SQLiteDBConnection,
  table: string,
  column: string,
  def: string
): Promise<void> {
  if (!(await tableExists(db, table))) {
    console.warn(`[Mobile DB] Skipping migration: table "${table}" does not exist yet`)
    return
  }

  const result = await db.query(`PRAGMA table_info(${table})`)
  const columns = result.values || []
  const exists = columns.some((c: any) => c.name === column)
  if (!exists) {
    try {
      await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${def};`)
    } catch (err) {
      console.warn(`[Mobile DB] Failed to add column ${column} to ${table}:`, err)
    }
  }
}

export async function closeDatabase(): Promise<void> {
  if (dbConnection) {
    try {
      // Try to clear any stuck plugin transaction state before closing
      try { await dbConnection.execute('ROLLBACK') } catch {}
      try { await dbConnection.rollbackTransaction() } catch {}
      await dbConnection.close()
    } catch (err) {
      console.warn('[Mobile DB] dbConnection.close() failed:', err)
    }
    dbConnection = null
  }
  if (sqliteConnection) {
    try {
      await sqliteConnection.closeConnection(DB_NAME, false)
    } catch (err) {
      console.warn('[Mobile DB] closeConnection failed:', err)
    }
    sqliteConnection = null
  }
}
