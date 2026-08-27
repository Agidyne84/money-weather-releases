// Mobile Backup/Restore — Client-side implementation matching desktop server format
// Uses Web Crypto API for AES-256-GCM + PBKDF2
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { getDbConnection, initializeDatabase, closeDatabase } from '../services/database/mobileDb'
import type { capSQLiteSet } from '@capacitor-community/sqlite'

/**
 * Decode a base64 string to an ArrayBuffer, handling whitespace/line-breaks
 * that some encoders (e.g. Android Base64.DEFAULT) may insert.
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const cleaned = base64.replace(/[\s\r\n]+/g, '')
  const binaryString = atob(cleaned)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes.buffer
}

// Binary file format constants (must match server/src/backup.ts exactly)
const MAGIC = new Uint8Array([0x42, 0x41, 0x50, 0x4B]) // 'BAPK'
const FORMAT_VERSION = 1
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

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH * 8 },
    false,
    ['encrypt', 'decrypt']
  )
}

async function encrypt(plaintext: Uint8Array, passphrase: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const key = await deriveKey(passphrase, salt)

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    plaintext.buffer as ArrayBuffer
  )

  // AES-GCM in Web Crypto appends authTag to the ciphertext
  const cipherBytes = new Uint8Array(ciphertext)
  const encrypted = cipherBytes.subarray(0, cipherBytes.length - AUTH_TAG_LENGTH)
  const authTag = cipherBytes.subarray(cipherBytes.length - AUTH_TAG_LENGTH)

  // Assemble: MAGIC + VERSION + SALT + IV + CIPHERTEXT + AUTH_TAG
  const versionBuf = new Uint8Array(1)
  versionBuf[0] = FORMAT_VERSION

  const result = new Uint8Array(MAGIC.length + 1 + SALT_LENGTH + IV_LENGTH + encrypted.length + AUTH_TAG_LENGTH)
  let offset = 0
  result.set(MAGIC, offset); offset += MAGIC.length
  result.set(versionBuf, offset); offset += 1
  result.set(salt, offset); offset += SALT_LENGTH
  result.set(iv, offset); offset += IV_LENGTH
  result.set(encrypted, offset); offset += encrypted.length
  result.set(authTag, offset)

  return result
}

async function decrypt(fileBuffer: Uint8Array, passphrase: string): Promise<Uint8Array> {
  const headerSize = MAGIC.length + 1 + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
  if (fileBuffer.length < headerSize) {
    throw new Error('Invalid backup file: too small')
  }

  // Validate magic bytes
  const magic = fileBuffer.subarray(0, 4)
  if (!arrayEquals(magic, MAGIC)) {
    throw new Error('Invalid backup file: unrecognized format')
  }

  // Parse version
  const version = fileBuffer[4]
  if (version !== FORMAT_VERSION) {
    throw new Error(`Unsupported backup version: ${version}`)
  }

  // Extract components
  let offset = 5
  const salt = fileBuffer.subarray(offset, offset + SALT_LENGTH); offset += SALT_LENGTH
  const iv = fileBuffer.subarray(offset, offset + IV_LENGTH); offset += IV_LENGTH
  const ciphertext = fileBuffer.subarray(offset, fileBuffer.length - AUTH_TAG_LENGTH)
  const authTag = fileBuffer.subarray(fileBuffer.length - AUTH_TAG_LENGTH)

  // Derive key and decrypt
  const key = await deriveKey(passphrase, salt)

  // Web Crypto AES-GCM expects ciphertext + authTag appended
  const cipherWithTag = new Uint8Array(ciphertext.length + AUTH_TAG_LENGTH)
  cipherWithTag.set(ciphertext, 0)
  cipherWithTag.set(authTag, ciphertext.length)

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer },
      key,
      cipherWithTag.buffer.slice(cipherWithTag.byteOffset, cipherWithTag.byteOffset + cipherWithTag.byteLength) as ArrayBuffer
    )
    return new Uint8Array(decrypted)
  } catch {
    throw new Error('Decryption failed: wrong password or corrupted file')
  }
}

function arrayEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

async function getAllTableData(): Promise<BackupEnvelope> {
  // Use the existing open connection. Do NOT close/reopen here: closing the database
  // while the app/UI may still be querying it causes "database budget not opened" errors
  // and can return empty tables that then overwrite the cloud backup.
  await initializeDatabase()
  const db = await getDbConnection()

  // Run sequentially: some Capacitor SQLite plugin versions return stale or empty
  // results when multiple queries are issued in parallel on the same connection.
  const accounts = await db.query('SELECT * FROM accounts')
  const categories = await db.query('SELECT * FROM categories')
  const transactions = await db.query('SELECT * FROM transactions')
  const forecastOverrides = await db.query('SELECT * FROM forecast_overrides')
  const transactionRules = await db.query('SELECT * FROM transaction_rules')
  const historicalTransactions = await db.query('SELECT * FROM historical_transactions')
  const userPreferences = await db.query('SELECT * FROM user_preferences')

  const envelope = {
    version: 1,
    exportedAt: new Date().toISOString(),
    tables: {
      accounts: accounts.values || [],
      categories: categories.values || [],
      transactions: transactions.values || [],
      forecast_overrides: forecastOverrides.values || [],
      transaction_rules: transactionRules.values || [],
      historical_transactions: historicalTransactions.values || [],
      user_preferences: userPreferences.values || [],
    },
  }

  console.log('[MobileBackup] export row counts:', Object.fromEntries(
    Object.entries(envelope.tables).map(([k, v]) => [k, (v as any[]).length])
  ))

  // Safety net: a valid database should always have the seeded categories. If every
  // core table is empty, the read almost certainly failed silently due to a closed
  // connection; do not export this and risk wiping the cloud backup.
  if (
    envelope.tables.categories.length === 0 &&
    envelope.tables.accounts.length === 0 &&
    envelope.tables.transactions.length === 0
  ) {
    throw new Error('Export returned empty data; the database connection appears to be closed')
  }

  return envelope
}

function validateEnvelope(data: any): data is BackupEnvelope {
  if (!data || typeof data !== 'object') return false
  if (data.version !== 1) return false
  if (!data.tables || typeof data.tables !== 'object') return false

  const requiredTables = [
    'accounts', 'categories', 'transactions',
    'forecast_overrides', 'transaction_rules',
    'historical_transactions', 'user_preferences',
  ]
  for (const table of requiredTables) {
    if (!Array.isArray(data.tables[table])) return false
  }
  return true
}

export async function exportMobileBackup(passphrase?: string): Promise<Uint8Array> {
  const envelope = await getAllTableData()
  const jsonBytes = new TextEncoder().encode(JSON.stringify(envelope))

  if (passphrase) {
    return encrypt(jsonBytes, passphrase)
  }
  return jsonBytes
}

export async function importMobileBackup(fileBuffer: ArrayBuffer, passphrase?: string): Promise<{ success: boolean; summary: Record<string, number> }> {
  console.log('[MobileBackup] importMobileBackup starting, file size:', fileBuffer.byteLength, 'hasPassphrase:', !!passphrase)
  const fileBytes = new Uint8Array(fileBuffer)
  let jsonBytes: Uint8Array

  // Determine if encrypted
  const isEncrypted = arrayEquals(fileBytes.subarray(0, 4), MAGIC)
  console.log('[MobileBackup] Backup appears encrypted:', isEncrypted)
  if (isEncrypted) {
    if (!passphrase) {
      throw new Error('This backup file is encrypted. Please provide a password.')
    }
    jsonBytes = await decrypt(fileBytes, passphrase)
  } else {
    jsonBytes = fileBytes
  }

  const envelope: BackupEnvelope = JSON.parse(new TextDecoder().decode(jsonBytes))
  console.log('[MobileBackup] Parsed envelope, tables:', Object.fromEntries(
    Object.entries(envelope.tables).map(([k, v]) => [k, (v as any[]).length])
  ))

  if (!validateEnvelope(envelope)) {
    throw new Error('Invalid backup file: schema validation failed')
  }

  // Safety net: refuse to overwrite substantially more local data with a backup that
  // looks empty/stale/corrupt. Without this, a stale or half-written cloud file (e.g.
  // from a failed push) can silently wipe all local data on the next pull.
  try {
    await initializeDatabase()
    const existingDb = await getDbConnection()
    const acctCountResult = await existingDb.query('SELECT COUNT(*) as count FROM accounts')
    const txnCountResult = await existingDb.query('SELECT COUNT(*) as count FROM transactions')
    const existingAccounts = (acctCountResult.values || [])[0]?.count || 0
    const existingTransactions = (txnCountResult.values || [])[0]?.count || 0
    const incomingAccounts = envelope.tables.accounts.length
    const incomingTransactions = envelope.tables.transactions.length
    console.log('[MobileBackup] Wipe-guard check — existing:', { existingAccounts, existingTransactions }, 'incoming:', { incomingAccounts, incomingTransactions })
    if (existingAccounts > 0 && incomingAccounts === 0) {
      throw new Error(`Refusing to import: the cloud backup has 0 accounts but this device has ${existingAccounts}. This looks like a stale or corrupted backup file — use Force Push if you intended to overwrite the cloud backup with this device's data instead.`)
    }
    if (existingTransactions >= 5 && incomingTransactions === 0) {
      throw new Error(`Refusing to import: the cloud backup has 0 transactions but this device has ${existingTransactions}. This looks like a stale or corrupted backup file — use Force Push if you intended to overwrite the cloud backup with this device's data instead.`)
    }
  } catch (guardError) {
    if (guardError instanceof Error && guardError.message.startsWith('Refusing to import')) {
      throw guardError
    }
    // If the guard cannot verify the current local data (e.g. DB not yet open),
    // abort the import rather than risk wiping the local database with a stale
    // or empty cloud backup.
    console.error('[MobileBackup] Wipe-guard check failed to run, aborting import:', guardError)
    throw new Error('Could not verify local data before import. Import aborted to prevent accidental data loss.')
  }

  // Close any existing connection first to guarantee a completely fresh native state.
  await closeDatabase()
  await initializeDatabase()
  const db = await getDbConnection()

  // Build all import statements into a single executeSet call.
  // executeSet runs everything in one native SQLite transaction (transaction=true by default),
  // completely bypassing the plugin's buggy beginTransaction()/commitTransaction() flag.
  const set: capSQLiteSet[] = []

  set.push({ statement: 'PRAGMA foreign_keys = OFF', values: [] })
  set.push({ statement: 'DELETE FROM historical_transactions', values: [] })
  set.push({ statement: 'DELETE FROM forecast_overrides', values: [] })
  set.push({ statement: 'DELETE FROM transaction_rules', values: [] })
  set.push({ statement: 'DELETE FROM transactions', values: [] })
  set.push({ statement: 'DELETE FROM categories', values: [] })
  set.push({ statement: 'DELETE FROM accounts', values: [] })
  set.push({ statement: 'DELETE FROM user_preferences', values: [] })

  for (const row of envelope.tables.accounts) {
    set.push({
      statement: `INSERT INTO accounts (id, name, type, starting_balance, current_balance, include_in_low_balance_analysis, import_settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      values: [row.id, row.name, row.type, row.starting_balance, row.current_balance,
        row.include_in_low_balance_analysis, row.import_settings, row.created_at, row.updated_at],
    })
  }

  for (const row of envelope.tables.categories) {
    set.push({
      statement: `INSERT INTO categories (id, name, parent_id, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      values: [row.id, row.name, row.parent_id, row.color, row.sort_order, row.created_at],
    })
  }

  for (const row of envelope.tables.transactions) {
    set.push({
      statement: `INSERT INTO transactions (id, name, amount, frequency_value, frequency_unit, custom_frequency_pattern, start_date, end_date, pause_start_date, pause_end_date, category_id, account_id, type, transfer_to_account_id, is_transfer, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      values: [row.id, row.name, row.amount, row.frequency_value, row.frequency_unit, row.custom_frequency_pattern,
        row.start_date, row.end_date, row.pause_start_date, row.pause_end_date,
        row.category_id, row.account_id, row.type, row.transfer_to_account_id, row.is_transfer, row.is_active,
        row.created_at, row.updated_at],
    })
  }

  for (const row of envelope.tables.forecast_overrides) {
    set.push({
      statement: `INSERT INTO forecast_overrides (id, transaction_id, date, original_amount, override_amount, is_posted, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      values: [row.id, row.transaction_id, row.date, row.original_amount, row.override_amount,
        row.is_posted, row.notes, row.created_at, row.updated_at],
    })
  }

  for (const row of envelope.tables.transaction_rules) {
    set.push({
      statement: `INSERT INTO transaction_rules (id, transaction_id, account_id, restrict_to_account, pattern, category_id, is_active, match_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      values: [row.id, row.transaction_id, row.account_id, row.restrict_to_account, row.pattern,
        row.category_id, row.is_active, row.match_count, row.created_at, row.updated_at],
    })
  }

  for (const row of envelope.tables.historical_transactions) {
    set.push({
      statement: `INSERT INTO historical_transactions (id, transaction_id, account_id, category_id, date, description, amount, type, transfer_to_account_id, is_transfer, is_excluded, is_manual_edit, is_suppressed, is_posted, bank_description, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      values: [row.id, row.transaction_id, row.account_id, row.category_id, row.date, row.description,
        row.amount, row.type, row.transfer_to_account_id, row.is_transfer, row.is_excluded,
        row.is_manual_edit, row.is_suppressed, row.is_posted, row.bank_description, row.archived_at],
    })
  }

  for (const row of envelope.tables.user_preferences) {
    set.push({
      statement: `INSERT INTO user_preferences (key, value, updated_at) VALUES (?, ?, ?)`,
      values: [row.key, row.value, row.updated_at],
    })
  }

  set.push({ statement: 'PRAGMA foreign_keys = ON', values: [] })

  try {
    await db.executeSet(set)
  } catch (error) {
    throw new Error(`Restore failed: ${(error as Error).message}`)
  }

  // ── Post-import validation ──
  // Ensure the database actually contains the imported data.
  // A stale native connection can cause executeSet to succeed without
  // the writes being visible to subsequent queries.
  try {
    const prefsResult = await db.query('SELECT key, value FROM user_preferences WHERE key = ?', ['forecast_start_date'])
    const importedPrefs = envelope.tables.user_preferences
    const importedStartDate = importedPrefs.find((p: any) => p.key === 'forecast_start_date')?.value
    const dbStartDate = (prefsResult.values || [])[0]?.value

    if (importedStartDate && dbStartDate !== importedStartDate) {
      console.warn('[MobileBackup] Post-import validation FAILED: forecast_start_date mismatch.')
      console.warn('  Imported:', importedStartDate, '  DB:', dbStartDate)
      throw new Error('Post-import validation failed: user_preferences not reflecting imported data.')
    }

    const acctResult = await db.query('SELECT COUNT(*) as count FROM accounts')
    const dbAccountCount = (acctResult.values || [])[0]?.count || 0
    if (dbAccountCount !== envelope.tables.accounts.length) {
      console.warn('[MobileBackup] Post-import validation FAILED: account count mismatch.')
      console.warn('  Imported:', envelope.tables.accounts.length, '  DB:', dbAccountCount)
      throw new Error('Post-import validation failed: account count mismatch.')
    }

    console.log('[MobileBackup] Post-import validation passed.')
  } catch (validationError) {
    throw new Error(`Restore validation failed: ${(validationError as Error).message}`)
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

export async function resetMobileDatabase(): Promise<{ success: boolean; message: string }> {
  await initializeDatabase()
  const db = await getDbConnection()

  const set: capSQLiteSet[] = [
    { statement: 'PRAGMA foreign_keys = OFF', values: [] },
    { statement: 'DELETE FROM historical_transactions', values: [] },
    { statement: 'DELETE FROM forecast_overrides', values: [] },
    { statement: 'DELETE FROM transaction_rules', values: [] },
    { statement: 'DELETE FROM transactions', values: [] },
    { statement: 'DELETE FROM categories', values: [] },
    { statement: 'DELETE FROM accounts', values: [] },
    { statement: 'DELETE FROM user_preferences', values: [] },
    { statement: 'PRAGMA foreign_keys = ON', values: [] },
  ]

  try {
    await db.executeSet(set)
  } catch (error) {
    throw new Error(`Reset failed: ${(error as Error).message}`)
  }

  return { success: true, message: 'All data has been cleared. The app is now empty.' }
}

/**
 * Share an encrypted backup file using the native share sheet.
 * Returns the temp file path for debugging purposes.
 */
/**
 * Verify that the provided passphrase can decrypt the given backup file.
 * Returns true if decryption succeeds without importing data.
 */
export async function verifyBackupPassword(fileBuffer: ArrayBuffer, passphrase: string): Promise<boolean> {
  const fileBytes = new Uint8Array(fileBuffer)
  if (!arrayEquals(fileBytes.subarray(0, 4), MAGIC)) {
    return false
  }
  try {
    await decrypt(fileBytes, passphrase)
    return true
  } catch {
    return false
  }
}

export async function shareMobileBackup(data: Uint8Array, filename: string): Promise<string> {
  // Write to a temp file in the cache directory
  const base64Data = btoa(String.fromCharCode(...data))
  const path = `backups/${filename}`

  await Filesystem.mkdir({
    path: 'backups',
    directory: Directory.Cache,
    recursive: true,
  }).catch(() => {/* may already exist */})

  await Filesystem.writeFile({
    path,
    directory: Directory.Cache,
    data: base64Data,
    encoding: 'base64' as Encoding,
  })

  const uriResult = await Filesystem.getUri({
    path,
    directory: Directory.Cache,
  })

  await Share.share({
    title: 'Money Weather Backup',
    files: [uriResult.uri],
  })

  return uriResult.uri
}
