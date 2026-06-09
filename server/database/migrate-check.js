const sqlite3 = require('sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'budget.db');
const db = new sqlite3.Database(dbPath);

function run(sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql) {
  return new Promise((resolve, reject) => {
    db.get(sql, function(err, row) {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, function(err, rows) {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function migrate() {
  // Pre-migration: ensure transfer_to_account_id column exists (idempotent)
  const txCols = await all("PRAGMA table_info(transactions)");
  if (!txCols.some(c => c.name === 'transfer_to_account_id')) {
    await run("ALTER TABLE transactions ADD COLUMN transfer_to_account_id TEXT");
    console.log('Added transfer_to_account_id to transactions.');
  }
  const htCols = await all("PRAGMA table_info(historical_transactions)");
  if (!htCols.some(c => c.name === 'transfer_to_account_id')) {
    await run("ALTER TABLE historical_transactions ADD COLUMN transfer_to_account_id TEXT");
    console.log('Added transfer_to_account_id to historical_transactions.');
  }

  // Check if transactions table already has 'transfer' in its CHECK constraint
  const txSchema = await get("SELECT sql FROM sqlite_master WHERE type='table' AND name='transactions'");
  const htSchema = await get("SELECT sql FROM sqlite_master WHERE type='table' AND name='historical_transactions'");

  const txNeedsMigration = txSchema && !txSchema.sql.includes('transfer');
  const htNeedsMigration = htSchema && !htSchema.sql.includes('transfer');

  if (!txNeedsMigration && !htNeedsMigration) {
    console.log('No migration needed: tables already have transfer type support.');
    db.close();
    return;
  }

  await run('PRAGMA foreign_keys = OFF');
  await run('BEGIN TRANSACTION');

  try {
    if (txNeedsMigration) {
      console.log('Migrating transactions table...');
      await run('ALTER TABLE transactions RENAME TO transactions_old');
      await run(`
        CREATE TABLE transactions (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          amount REAL NOT NULL,
          frequency_value INTEGER NOT NULL DEFAULT 1,
          frequency_unit TEXT CHECK(frequency_unit IN ('days', 'weeks', 'months', 'years', 'custom')) NOT NULL DEFAULT 'monthly',
          custom_frequency_pattern TEXT,
          start_date DATE NOT NULL,
          end_date DATE,
          pause_start_date DATE,
          pause_end_date DATE,
          category_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          type TEXT CHECK(type IN ('income', 'expense', 'administrative', 'transfer')) NOT NULL,
          transfer_to_account_id TEXT,
          is_active BOOLEAN DEFAULT TRUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
          FOREIGN KEY (transfer_to_account_id) REFERENCES accounts(id) ON DELETE RESTRICT
        )
      `);
      await run(`INSERT INTO transactions (id, name, amount, frequency_value, frequency_unit, custom_frequency_pattern, start_date, end_date, pause_start_date, pause_end_date, category_id, account_id, type, transfer_to_account_id, is_active, created_at, updated_at)
        SELECT id, name, amount, frequency_value, frequency_unit, custom_frequency_pattern, start_date, end_date, pause_start_date, pause_end_date, category_id, account_id, type, transfer_to_account_id, is_active, created_at, updated_at FROM transactions_old`);
      await run('DROP TABLE transactions_old');
      console.log('transactions table migrated.');
    }

    if (htNeedsMigration) {
      console.log('Migrating historical_transactions table...');
      await run('ALTER TABLE historical_transactions RENAME TO historical_transactions_old');
      await run(`
        CREATE TABLE historical_transactions (
          id TEXT PRIMARY KEY,
          transaction_id TEXT,
          account_id TEXT NOT NULL,
          category_id TEXT NOT NULL,
          date DATE NOT NULL,
          description TEXT NOT NULL,
          amount REAL NOT NULL,
          type TEXT CHECK(type IN ('income', 'expense', 'administrative', 'transfer')) NOT NULL,
          transfer_to_account_id TEXT,
          is_manual_edit INTEGER NOT NULL DEFAULT 0,
          is_suppressed INTEGER NOT NULL DEFAULT 0,
          is_posted INTEGER NOT NULL DEFAULT 1,
          archived_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL,
          FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
          FOREIGN KEY (transfer_to_account_id) REFERENCES accounts(id) ON DELETE RESTRICT
        )
      `);
      // Copy only the columns that existed before (is_posted defaults to 1, transfer_to_account_id defaults to NULL)
      await run(`INSERT INTO historical_transactions (id, transaction_id, account_id, category_id, date, description, amount, type, transfer_to_account_id, is_manual_edit, is_suppressed, archived_at)
        SELECT id, transaction_id, account_id, category_id, date, description, amount, type, transfer_to_account_id,
          COALESCE(is_manual_edit, 0), COALESCE(is_suppressed, 0), archived_at
        FROM historical_transactions_old`);
      await run('DROP TABLE historical_transactions_old');
      console.log('historical_transactions table migrated.');
    }

    await run('COMMIT');
    await run('PRAGMA foreign_keys = ON');
    console.log('Migration complete: CHECK constraints updated to allow administrative type.');
  } catch (err) {
    console.error('Migration failed, rolling back:', err.message);
    try { await run('ROLLBACK'); } catch(e) {}
  } finally {
    db.close();
  }
}

// NOTE: This file is imported by database.ts; do not auto-execute here.
