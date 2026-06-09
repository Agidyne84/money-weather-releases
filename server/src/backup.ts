import crypto from 'crypto'
import { getDatabase } from './database'

// Binary file format constants
const MAGIC = Buffer.from('BAPK') // 4 bytes
const FORMAT_VERSION = 1           // 1 byte
const SALT_LENGTH = 16
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const PBKDF2_ITERATIONS = 100_000
const KEY_LENGTH = 32 // 256 bits

interface BackupEnvelope {
  version: number
  exportedAt: string
  tables: {
    accounts: any[]
    categories: any[]
    transactions: any[]
    forecast_overrides: any[]
    transaction_rules: any[]
    historical_transactions: any[]
    user_preferences: any[]
  }
}

/**
 * Derive a 256-bit key from a passphrase and salt using PBKDF2.
 */
function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256')
}

/**
 * Encrypt a plaintext buffer with AES-256-GCM.
 * Returns: salt + iv + ciphertext + authTag
 */
function encrypt(plaintext: Buffer, passphrase: string): Buffer {
  const salt = crypto.randomBytes(SALT_LENGTH)
  const key = deriveKey(passphrase, salt)
  const iv = crypto.randomBytes(IV_LENGTH)

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()

  // Assemble: MAGIC + VERSION + SALT + IV + CIPHERTEXT + AUTH_TAG
  const versionBuf = Buffer.alloc(1)
  versionBuf.writeUInt8(FORMAT_VERSION)

  return Buffer.concat([MAGIC, versionBuf, salt, iv, encrypted, authTag])
}

/**
 * Decrypt a .budgetbackup binary buffer with the given passphrase.
 * Throws on invalid format, wrong passphrase, or tampered data.
 */
function decrypt(fileBuffer: Buffer, passphrase: string): Buffer {
  // Validate minimum size
  const headerSize = MAGIC.length + 1 + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
  if (fileBuffer.length < headerSize) {
    throw new Error('Invalid backup file: too small')
  }

  // Validate magic bytes
  const magic = fileBuffer.subarray(0, 4)
  if (!magic.equals(MAGIC)) {
    throw new Error('Invalid backup file: unrecognized format')
  }

  // Parse version
  const version = fileBuffer.readUInt8(4)
  if (version !== FORMAT_VERSION) {
    throw new Error(`Unsupported backup version: ${version}`)
  }

  // Extract components
  let offset = 5
  const salt = fileBuffer.subarray(offset, offset + SALT_LENGTH)
  offset += SALT_LENGTH
  const iv = fileBuffer.subarray(offset, offset + IV_LENGTH)
  offset += IV_LENGTH
  const ciphertext = fileBuffer.subarray(offset, fileBuffer.length - AUTH_TAG_LENGTH)
  const authTag = fileBuffer.subarray(fileBuffer.length - AUTH_TAG_LENGTH)

  // Derive key and decrypt
  const key = deriveKey(passphrase, salt)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)

  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return decrypted
  } catch {
    throw new Error('Decryption failed: wrong passphrase or corrupted file')
  }
}

/**
 * Export all database tables as a JSON envelope.
 */
export async function exportDatabase(passphrase?: string): Promise<Buffer> {
  const db = getDatabase()

  const [accounts, categories, transactions, forecastOverrides, transactionRules, historicalTransactions, userPreferences] =
    await Promise.all([
      db.all('SELECT * FROM accounts'),
      db.all('SELECT * FROM categories'),
      db.all('SELECT * FROM transactions'),
      db.all('SELECT * FROM forecast_overrides'),
      db.all('SELECT * FROM transaction_rules'),
      db.all('SELECT * FROM historical_transactions'),
      db.all('SELECT * FROM user_preferences'),
    ])

  const envelope: BackupEnvelope = {
    version: 1,
    exportedAt: new Date().toISOString(),
    tables: {
      accounts,
      categories,
      transactions,
      forecast_overrides: forecastOverrides,
      transaction_rules: transactionRules,
      historical_transactions: historicalTransactions,
      user_preferences: userPreferences,
    },
  }

  const jsonBuffer = Buffer.from(JSON.stringify(envelope), 'utf-8')

  if (passphrase) {
    return encrypt(jsonBuffer, passphrase)
  }

  // Unencrypted: return raw JSON
  return jsonBuffer
}

/**
 * Validate the structure of a backup envelope.
 */
function validateEnvelope(data: any): data is BackupEnvelope {
  if (!data || typeof data !== 'object') return false
  if (data.version !== 1) return false
  if (!data.tables || typeof data.tables !== 'object') return false

  const requiredTables = [
    'accounts', 'categories', 'transactions',
    'forecast_overrides', 'transaction_rules',
    'historical_transactions', 'user_preferences'
  ]
  for (const table of requiredTables) {
    if (!Array.isArray(data.tables[table])) return false
  }
  return true
}

/**
 * Import (restore) a backup file, replacing all existing data.
 * Runs inside a SQLite transaction for atomicity.
 */
export async function importDatabase(fileBuffer: Buffer, passphrase?: string): Promise<{ success: boolean; summary: Record<string, number> }> {
  let jsonBuffer: Buffer

  // Determine if the file is encrypted (starts with MAGIC) or plain JSON
  if (fileBuffer.subarray(0, 4).equals(MAGIC)) {
    if (!passphrase) {
      throw new Error('This backup file is encrypted. Please provide a passphrase.')
    }
    jsonBuffer = decrypt(fileBuffer, passphrase)
  } else {
    // Assume plain JSON
    jsonBuffer = fileBuffer
  }

  let envelope: BackupEnvelope
  try {
    envelope = JSON.parse(jsonBuffer.toString('utf-8'))
  } catch {
    throw new Error('Invalid backup file: could not parse JSON')
  }

  if (!validateEnvelope(envelope)) {
    throw new Error('Invalid backup file: schema validation failed')
  }

  const db = getDatabase()

  // Full restore inside a transaction
  await db.run('BEGIN TRANSACTION')

  try {
    // Clear all tables (order matters due to foreign keys — disable temporarily)
    await db.run('PRAGMA foreign_keys = OFF')
    await db.run('DELETE FROM historical_transactions')
    await db.run('DELETE FROM forecast_overrides')
    await db.run('DELETE FROM transaction_rules')
    await db.run('DELETE FROM transactions')
    await db.run('DELETE FROM categories')
    await db.run('DELETE FROM accounts')
    await db.run('DELETE FROM user_preferences')

    // Re-insert all data
    for (const row of envelope.tables.accounts) {
      await db.run(
        `INSERT INTO accounts (id, name, type, starting_balance, current_balance, include_in_low_balance_analysis, import_settings, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.id, row.name, row.type, row.starting_balance, row.current_balance,
         row.include_in_low_balance_analysis, row.import_settings, row.created_at, row.updated_at]
      )
    }

    for (const row of envelope.tables.categories) {
      await db.run(
        `INSERT INTO categories (id, name, parent_id, color, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [row.id, row.name, row.parent_id, row.color, row.sort_order, row.created_at]
      )
    }

    for (const row of envelope.tables.transactions) {
      await db.run(
        `INSERT INTO transactions (id, name, amount, frequency_value, frequency_unit, custom_frequency_pattern, start_date, end_date, pause_start_date, pause_end_date, category_id, account_id, type, transfer_to_account_id, is_transfer, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.id, row.name, row.amount, row.frequency_value, row.frequency_unit, row.custom_frequency_pattern,
         row.start_date, row.end_date, row.pause_start_date, row.pause_end_date,
         row.category_id, row.account_id, row.type, row.transfer_to_account_id, row.is_transfer, row.is_active,
         row.created_at, row.updated_at]
      )
    }

    for (const row of envelope.tables.forecast_overrides) {
      await db.run(
        `INSERT INTO forecast_overrides (id, transaction_id, date, original_amount, override_amount, is_posted, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.id, row.transaction_id, row.date, row.original_amount, row.override_amount,
         row.is_posted, row.notes, row.created_at, row.updated_at]
      )
    }

    for (const row of envelope.tables.transaction_rules) {
      await db.run(
        `INSERT INTO transaction_rules (id, transaction_id, account_id, restrict_to_account, pattern, category_id, is_active, match_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.id, row.transaction_id, row.account_id, row.restrict_to_account, row.pattern,
         row.category_id, row.is_active, row.match_count, row.created_at, row.updated_at]
      )
    }

    for (const row of envelope.tables.historical_transactions) {
      await db.run(
        `INSERT INTO historical_transactions (id, transaction_id, account_id, category_id, date, description, amount, type, transfer_to_account_id, is_transfer, is_excluded, is_manual_edit, is_suppressed, is_posted, bank_description, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.id, row.transaction_id, row.account_id, row.category_id, row.date, row.description,
         row.amount, row.type, row.transfer_to_account_id, row.is_transfer, row.is_excluded,
         row.is_manual_edit, row.is_suppressed, row.is_posted, row.bank_description, row.archived_at]
      )
    }

    for (const row of envelope.tables.user_preferences) {
      await db.run(
        `INSERT INTO user_preferences (key, value, updated_at) VALUES (?, ?, ?)`,
        [row.key, row.value, row.updated_at]
      )
    }

    await db.run('PRAGMA foreign_keys = ON')
    await db.run('COMMIT')
  } catch (error) {
    await db.run('ROLLBACK')
    await db.run('PRAGMA foreign_keys = ON')
    throw new Error(`Restore failed: ${(error as Error).message}`)
  }

  return {
    success: true,
    summary: {
      accounts: envelope.tables.accounts.length,
      categories: envelope.tables.categories.length,
      transactions: envelope.tables.transactions.length,
      forecast_overrides: envelope.tables.forecast_overrides.length,
      transaction_rules: envelope.tables.transaction_rules.length,
      historical_transactions: envelope.tables.historical_transactions.length,
      user_preferences: envelope.tables.user_preferences.length,
    },
  }
}

/**
 * Reset the database by deleting all user data.
 */
export async function resetDatabase(): Promise<{ success: boolean; message: string }> {
  const db = getDatabase()

  await db.run('BEGIN TRANSACTION')

  try {
    await db.run('PRAGMA foreign_keys = OFF')
    await db.run('DELETE FROM historical_transactions')
    await db.run('DELETE FROM forecast_overrides')
    await db.run('DELETE FROM transaction_rules')
    await db.run('DELETE FROM transactions')
    await db.run('DELETE FROM categories')
    await db.run('DELETE FROM accounts')
    await db.run('DELETE FROM user_preferences')
    await db.run('PRAGMA foreign_keys = ON')
    await db.run('COMMIT')
  } catch (error) {
    await db.run('ROLLBACK')
    await db.run('PRAGMA foreign_keys = ON')
    throw new Error(`Reset failed: ${(error as Error).message}`)
  }

  return { success: true, message: 'All data has been cleared. The app is now empty.' }
}
