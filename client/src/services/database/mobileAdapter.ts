// Mobile Adapter — Capacitor SQLite implementation of all data access APIs
import { getDbConnection, initializeDatabase } from './mobileDb'
import {
  Account, Category, Transaction, BalanceForecast,
  ForecastTransaction, LowBalanceAnalysis
} from '../../types'
import { createSafeDate, formatDateForStorage } from '../../utils/dateUtils'
import { generateBalanceForecast, generateForecastTransactions, generateLowBalanceAnalysis } from '../../utils/forecastEngine'
import { markDirty } from '../dirtyTracker'

// Re-export types that components import from the old api.ts
export interface HistoryRow {
  id: string
  transactionId?: string | null
  accountId: string
  accountName?: string
  categoryId: string
  categoryName?: string
  categoryColor?: string
  date: Date
  description: string
  amount: number
  type: 'income' | 'expense'
  isTransfer?: boolean
  transferToAccountId?: string
  archivedAt?: string
  sourceTransactionName?: string | null
  isManualEdit?: boolean
  isSuppressed?: boolean
  isPosted?: boolean
  isExcluded?: boolean
  bankDescription?: string
}

export interface HistoryQuery {
  startDate?: string
  endDate?: string
  accountId?: string
  categoryId?: string
  limit?: number
  offset?: number
  includeUnposted?: boolean
  includeSuppressed?: boolean
  includeExcluded?: boolean
}

export interface ImportRule {
  id: string
  transactionId: string | null
  accountId: string | null
  accountIds: string[]
  restrictToAccount: boolean
  pattern: string
  categoryId: string
  isActive: boolean
  matchCount: number
  createdAt: string
  updatedAt: string
  transactionName?: string | null
  categoryName?: string | null
  accountName?: string | null
}

export interface RuleExamplesResult {
  examples: { bankDescription: string; accountId: string; amount: number; date: string }[]
  count: number
  suggestedPattern: string | null
  confidence: number | null
  existingRule: { id: string; pattern: string; isActive: boolean } | null
  existingRulePatterns: string[]
  suggestionsSuppressed: boolean
}

/* ─── Helpers ─── */

function generateId(): string {
  return crypto.randomUUID()
}

function mapAccount(row: any): Account {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    startingBalance: row.starting_balance ?? 0,
    currentBalance: row.current_balance ?? 0,
    includeInLowBalanceAnalysis: Boolean(row.include_in_low_balance_analysis),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapCategory(row: any): Category {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id || undefined,
    color: row.color,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  }
}

function mapTransaction(row: any): Transaction {
  return {
    id: row.id,
    name: row.name,
    amount: row.amount,
    frequency: {
      value: row.frequency_value,
      unit: row.frequency_unit,
      customPattern: row.custom_frequency_pattern,
    },
    startDate: createSafeDate(row.start_date),
    endDate: row.end_date ? createSafeDate(row.end_date) : undefined,
    pauseStartDate: row.pause_start_date ? createSafeDate(row.pause_start_date) : undefined,
    pauseEndDate: row.pause_end_date ? createSafeDate(row.pause_end_date) : undefined,
    categoryId: row.category_id,
    accountId: row.account_id,
    type: row.type,
    isTransfer: Boolean(row.is_transfer),
    transferToAccountId: row.transfer_to_account_id ?? undefined,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function txToDb(tx: Partial<Transaction>): Record<string, any> {
  const data: Record<string, any> = { ...tx }
  if (tx.frequency) {
    data.frequency_value = tx.frequency.value
    data.frequency_unit = tx.frequency.unit
    data.custom_frequency_pattern = tx.frequency.customPattern
    delete data.frequency
  }
  if (tx.startDate) data.start_date = formatDateForStorage(createSafeDate(tx.startDate))
  if (tx.endDate) data.end_date = tx.endDate ? formatDateForStorage(createSafeDate(tx.endDate)) : null
  if (tx.pauseStartDate !== undefined) {
    data.pause_start_date = tx.pauseStartDate ? formatDateForStorage(createSafeDate(tx.pauseStartDate)) : null
  }
  if (tx.pauseEndDate !== undefined) {
    data.pause_end_date = tx.pauseEndDate ? formatDateForStorage(createSafeDate(tx.pauseEndDate)) : null
  }
  if (tx.isTransfer !== undefined) data.is_transfer = tx.isTransfer ? 1 : 0
  if (tx.isActive !== undefined) data.is_active = tx.isActive ? 1 : 0
  return data
}

function mapHistoryRow(row: any): HistoryRow {
  return {
    id: row.id,
    transactionId: row.transaction_id ?? null,
    accountId: row.account_id,
    accountName: row.account_name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryColor: row.category_color,
    date: createSafeDate(row.date),
    description: row.description,
    amount: Number(row.amount),
    type: row.type,
    isTransfer: Boolean(row.is_transfer),
    transferToAccountId: row.transfer_to_account_id ?? undefined,
    archivedAt: row.archived_at,
    sourceTransactionName: row.source_transaction_name ?? null,
    isManualEdit: Number(row.is_manual_edit) !== 0,
    isSuppressed: Number(row.is_suppressed) !== 0,
    isPosted: row.is_posted !== undefined ? (Number(row.is_posted) !== 0) : true,
    isExcluded: Number(row.is_excluded) !== 0,
    bankDescription: row.bank_description || undefined,
  }
}

/* ─── accountsApi ─── */

export const accountsApi = {
  getAll: async (): Promise<Account[]> => {
    await initializeDatabase()
    const db = await getDbConnection()
    const result = await db.query('SELECT * FROM accounts ORDER BY created_at')
    return (result.values || []).map(mapAccount)
  },

  create: async (account: Omit<Account, 'id' | 'createdAt' | 'updatedAt'>): Promise<Account> => {
    markDirty()
    await initializeDatabase()
    const db = await getDbConnection()
    const id = generateId()
    const now = new Date().toISOString()
    await db.run(
      `INSERT INTO accounts (id, name, type, starting_balance, current_balance, include_in_low_balance_analysis, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, account.name, account.type, account.startingBalance, account.currentBalance,
       account.includeInLowBalanceAnalysis ? 1 : 0, now, now]
    )
    return { ...account as Account, id, createdAt: now, updatedAt: now }
  },

  update: async (id: string, account: Partial<Account>): Promise<Account> => {
    markDirty()
    await initializeDatabase()
    const db = await getDbConnection()
    const sets: string[] = []
    const vals: any[] = []
    if (account.name !== undefined) { sets.push('name = ?'); vals.push(account.name) }
    if (account.type !== undefined) { sets.push('type = ?'); vals.push(account.type) }
    if (account.startingBalance !== undefined) { sets.push('starting_balance = ?'); vals.push(account.startingBalance) }
    if (account.currentBalance !== undefined) { sets.push('current_balance = ?'); vals.push(account.currentBalance) }
    if (account.includeInLowBalanceAnalysis !== undefined) { sets.push('include_in_low_balance_analysis = ?'); vals.push(account.includeInLowBalanceAnalysis ? 1 : 0) }
    sets.push('updated_at = ?')
    vals.push(new Date().toISOString())
    vals.push(id)
    await db.run(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`, vals)
    const result = await db.query('SELECT * FROM accounts WHERE id = ?', [id])
    return mapAccount((result.values || [])[0])
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    markDirty()
    await initializeDatabase()
    const db = await getDbConnection()
    await db.run('DELETE FROM accounts WHERE id = ?', [id])
    return { success: true }
  },
}

/* ─── categoriesApi ─── */

export const categoriesApi = {
  getAll: async (): Promise<Category[]> => {
    await initializeDatabase()
    const db = await getDbConnection()
    const result = await db.query('SELECT * FROM categories ORDER BY sort_order, name')
    const flat = (result.values || []).map(mapCategory)
    return flat
  },

  create: async (category: Omit<Category, 'id' | 'createdAt'>): Promise<Category> => {
    markDirty()
    await initializeDatabase()
    const db = await getDbConnection()
    const id = generateId()
    const now = new Date().toISOString()
    await db.run(
      `INSERT INTO categories (id, name, parent_id, color, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, category.name, category.parentId || null, category.color, category.sortOrder || 0, now]
    )
    return { ...category as Category, id, createdAt: now }
  },

  update: async (id: string, category: Partial<Category>): Promise<Category> => {
    markDirty()
    await initializeDatabase()
    const db = await getDbConnection()
    const sets: string[] = []
    const vals: any[] = []
    if (category.name !== undefined) { sets.push('name = ?'); vals.push(category.name) }
    if (category.parentId !== undefined) { sets.push('parent_id = ?'); vals.push(category.parentId || null) }
    if (category.color !== undefined) { sets.push('color = ?'); vals.push(category.color) }
    if (category.sortOrder !== undefined) { sets.push('sort_order = ?'); vals.push(category.sortOrder) }
    vals.push(id)
    await db.run(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`, vals)
    const result = await db.query('SELECT * FROM categories WHERE id = ?', [id])
    return mapCategory((result.values || [])[0])
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    markDirty()
    await initializeDatabase()
    const db = await getDbConnection()
    await db.run('DELETE FROM categories WHERE id = ?', [id])
    return { success: true }
  },
}

/* ─── transactionsApi ─── */

export const transactionsApi = {
  getAll: async (limit = 50, offset = 0): Promise<Transaction[]> => {
    await initializeDatabase()
    const db = await getDbConnection()
    const result = await db.query(
      'SELECT * FROM transactions ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    )
    return (result.values || []).map(mapTransaction)
  },

  create: async (transaction: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>): Promise<Transaction> => {
    markDirty()
    await initializeDatabase()
    const db = await getDbConnection()
    const id = generateId()
    const now = new Date().toISOString()
    const data = txToDb(transaction)
    await db.run(
      `INSERT INTO transactions (
        id, name, amount, frequency_value, frequency_unit, custom_frequency_pattern,
        start_date, end_date, pause_start_date, pause_end_date,
        category_id, account_id, type, transfer_to_account_id, is_transfer, is_active,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, data.name, data.amount, data.frequency_value, data.frequency_unit,
        data.custom_frequency_pattern || null, data.start_date,
        data.end_date || null, data.pause_start_date || null, data.pause_end_date || null,
        data.category_id, data.account_id, data.type,
        data.transfer_to_account_id || null, data.is_transfer ? 1 : 0,
        data.is_active ? 1 : 0, now, now,
      ]
    )
    return { ...(transaction as Transaction), id, createdAt: now, updatedAt: now }
  },

  update: async (id: string, transaction: Partial<Transaction>): Promise<Transaction> => {
    markDirty()
    await initializeDatabase()
    const db = await getDbConnection()
    const data = txToDb(transaction)
    const sets: string[] = []
    const vals: any[] = []
    const colMap: Record<string, string> = {
      name: 'name', amount: 'amount', frequency_value: 'frequency_value',
      frequency_unit: 'frequency_unit', custom_frequency_pattern: 'custom_frequency_pattern',
      start_date: 'start_date', end_date: 'end_date',
      pause_start_date: 'pause_start_date', pause_end_date: 'pause_end_date',
      category_id: 'category_id', account_id: 'account_id', type: 'type',
      transfer_to_account_id: 'transfer_to_account_id', is_transfer: 'is_transfer',
      is_active: 'is_active',
    }
    for (const [key, col] of Object.entries(colMap)) {
      if (data[key] !== undefined) {
        sets.push(`${col} = ?`)
        vals.push(data[key])
      }
    }
    sets.push('updated_at = ?')
    vals.push(new Date().toISOString())
    vals.push(id)
    await db.run(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`, vals)
    const result = await db.query('SELECT * FROM transactions WHERE id = ?', [id])
    return mapTransaction((result.values || [])[0])
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    markDirty()
    await initializeDatabase()
    const db = await getDbConnection()
    await db.run('DELETE FROM transactions WHERE id = ?', [id])
    return { success: true }
  },
}

/* ─── historyApi ─── */

export const historyApi = {
  getAll: async (query: HistoryQuery = {}): Promise<HistoryRow[]> => {
    await initializeDatabase()
    const db = await getDbConnection()
    const conditions: string[] = []
    const params: any[] = []

    if (query.startDate) { conditions.push('h.date >= ?'); params.push(query.startDate) }
    if (query.endDate) { conditions.push('h.date <= ?'); params.push(query.endDate) }
    if (query.accountId) { conditions.push('h.account_id = ?'); params.push(query.accountId) }
    if (query.categoryId) { conditions.push('h.category_id = ?'); params.push(query.categoryId) }
    if (query.includeUnposted === false) { conditions.push('h.is_posted = 1') }
    if (query.includeSuppressed === false) { conditions.push('h.is_suppressed = 0') }
    if (query.includeExcluded === false) { conditions.push('h.is_excluded = 0') }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
    const limit = query.limit !== undefined ? 'LIMIT ?' : ''
    const offset = query.offset !== undefined ? 'OFFSET ?' : ''
    if (query.limit !== undefined) params.push(query.limit)
    if (query.offset !== undefined) params.push(query.offset)

    const sql = `
      SELECT h.*, a.name as account_name, c.name as category_name, c.color as category_color
      FROM historical_transactions h
      LEFT JOIN accounts a ON h.account_id = a.id
      LEFT JOIN categories c ON h.category_id = c.id
      ${where}
      ORDER BY h.date DESC, h.archived_at DESC
      ${limit} ${offset}
    `
    const result = await db.query(sql, params)
    return (result.values || []).map(mapHistoryRow)
  },

  create: async (row: {
    transactionId?: string | null
    accountId: string
    categoryId: string
    date: string
    description: string
    amount: number
    type: 'income' | 'expense' | 'administrative'
    isTransfer?: boolean
    transferToAccountId?: string
    isSuppressed?: boolean
    isExcluded?: boolean
    isManualEdit?: boolean
    isPosted?: boolean
    bankDescription?: string
  }): Promise<HistoryRow> => {
    markDirty()
    await initializeDatabase()
    const db = await getDbConnection()
    const id = generateId()
    const now = new Date().toISOString()
    await db.run(
      `INSERT INTO historical_transactions (
        id, transaction_id, account_id, category_id, date, description, amount, type,
        transfer_to_account_id, is_transfer, is_excluded, is_suppressed, is_manual_edit, is_posted, bank_description, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, row.transactionId || null, row.accountId, row.categoryId,
        row.date, row.description, row.amount, row.type,
        row.transferToAccountId || null, row.isTransfer ? 1 : 0,
        row.isExcluded ? 1 : 0, row.isSuppressed ? 1 : 0, row.isManualEdit ? 1 : 0,
        row.isPosted !== false ? 1 : 0, row.bankDescription || null, now,
      ]
    )
    const result = await db.query(
      `SELECT h.*, a.name as account_name, c.name as category_name, c.color as category_color
       FROM historical_transactions h
       LEFT JOIN accounts a ON h.account_id = a.id
       LEFT JOIN categories c ON h.category_id = c.id
       WHERE h.id = ?`, [id]
    )
    return mapHistoryRow((result.values || [])[0])
  },

  update: async (id: string, patch: Partial<{
    transactionId: string | null
    accountId: string
    categoryId: string
    date: string
    description: string
    amount: number
    type: 'income' | 'expense' | 'administrative'
    isTransfer: boolean
    transferToAccountId: string
    isSuppressed: boolean
    isManualEdit: boolean
    isPosted: boolean
    isExcluded: boolean
  }>): Promise<HistoryRow> => {
    markDirty()
    await initializeDatabase()
    const db = await getDbConnection()
    const sets: string[] = []
    const vals: any[] = []
    const colMap: Record<string, [string, (v: any) => any]> = {
      transactionId: ['transaction_id', v => v || null],
      accountId: ['account_id', v => v],
      categoryId: ['category_id', v => v],
      date: ['date', v => v],
      description: ['description', v => v],
      amount: ['amount', v => v],
      type: ['type', v => v],
      isTransfer: ['is_transfer', v => v ? 1 : 0],
      transferToAccountId: ['transfer_to_account_id', v => v || null],
      isSuppressed: ['is_suppressed', v => v ? 1 : 0],
      isExcluded: ['is_excluded', v => v ? 1 : 0],
      isManualEdit: ['is_manual_edit', v => v ? 1 : 0],
      isPosted: ['is_posted', v => v !== false ? 1 : 0],
      bankDescription: ['bank_description', v => v || null],
    }
    for (const [key, [col, transform]] of Object.entries(colMap)) {
      if ((patch as any)[key] !== undefined) {
        sets.push(`${col} = ?`)
        vals.push(transform((patch as any)[key]))
      }
    }
    vals.push(id)
    await db.run(`UPDATE historical_transactions SET ${sets.join(', ')} WHERE id = ?`, vals)
    const result = await db.query(
      `SELECT h.*, a.name as account_name, c.name as category_name, c.color as category_color
       FROM historical_transactions h
       LEFT JOIN accounts a ON h.account_id = a.id
       LEFT JOIN categories c ON h.category_id = c.id
       WHERE h.id = ?`, [id]
    )
    return mapHistoryRow((result.values || [])[0])
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    markDirty()
    await initializeDatabase()
    const db = await getDbConnection()
    await db.run('DELETE FROM historical_transactions WHERE id = ?', [id])
    return { success: true }
  },

  reset: async (): Promise<{ success: boolean; message?: string }> => {
    markDirty()
    await initializeDatabase()
    const db = await getDbConnection()
    await db.run('DELETE FROM historical_transactions')
    return { success: true, message: 'All historical transactions deleted.' }
  },
}

/* ─── preferencesApi ─── */

export const preferencesApi = {
  getAll: async (): Promise<Record<string, string>> => {
    await initializeDatabase()
    const db = await getDbConnection()
    const result = await db.query('SELECT * FROM user_preferences')
    const prefs: Record<string, string> = {}
    for (const row of (result.values || [])) {
      prefs[row.key] = row.value
    }
    return prefs
  },

  set: async (key: string, value: string): Promise<{ key: string; value: string }> => {
    markDirty()
    await initializeDatabase()
    const db = await getDbConnection()
    const now = new Date().toISOString()
    await db.run(
      'INSERT OR REPLACE INTO user_preferences (key, value, updated_at) VALUES (?, ?, ?)',
      [key, value, now]
    )
    return { key, value }
  },
}

/* ─── importApi ─── */

export const importApi = {
  preview: async (csv: string, accountId: string): Promise<{
    detectedColumns: { date: string | null; amount: string | null; description: string | null }
    rows: {
      date: string
      amount: number
      description: string
      isDuplicate: boolean
      ruleMatch: {
        ruleId: string
        transactionId: string | null
        categoryId: string
        pattern: string
        transactionName: string | null
      } | null
    }[]
    savedMapping: any
  }> => {
    // Parse CSV client-side (same logic as desktop)
    const lines = csv.split('\n').filter(l => l.trim())
    if (lines.length < 2) {
      return { detectedColumns: { date: null, amount: null, description: null }, rows: [], savedMapping: null }
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
    const dateCol = headers.findIndex(h => /date|posted|transaction date/.test(h))
    const amountCol = headers.findIndex(h => /amount|debit|credit/.test(h))
    const descCol = headers.findIndex(h => /description|payee|memo|name/.test(h))

    const detectedColumns = {
      date: dateCol >= 0 ? headers[dateCol] : null,
      amount: amountCol >= 0 ? headers[amountCol] : null,
      description: descCol >= 0 ? headers[descCol] : null,
    }

    // Fetch rules for matching
    await initializeDatabase()
    const db = await getDbConnection()
    const rulesResult = await db.query('SELECT * FROM transaction_rules WHERE is_active = 1')
    const rules = (rulesResult.values || []).map((r: any) => ({
      id: r.id,
      pattern: r.pattern,
      transactionId: r.transaction_id,
      categoryId: r.category_id,
      accountId: r.account_id,
      restrictToAccount: Boolean(r.restrict_to_account),
    }))

    // Fetch existing history for duplicate detection
    const histResult = await db.query(
      'SELECT date, amount, description FROM historical_transactions WHERE account_id = ?',
      [accountId]
    )
    const existing = (histResult.values || []) as any[]

    const rows = []
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim())
      const dateStr = dateCol >= 0 ? cols[dateCol] : ''
      const amountStr = amountCol >= 0 ? cols[amountCol].replace(/[$,]/g, '') : '0'
      const description = descCol >= 0 ? cols[descCol] : ''
      const amount = parseFloat(amountStr) || 0

      const normalized = description.toLowerCase().replace(/\s+/g, ' ').trim()
      const ruleMatch = rules.find(r => {
        if (r.restrictToAccount && r.accountId !== accountId) return false
        return normalized.includes(r.pattern.toLowerCase())
      })

      const isDuplicate = existing.some(e =>
        e.date === dateStr && Math.abs(e.amount - amount) < 0.01 && e.description === description
      )

      rows.push({
        date: dateStr,
        amount,
        description,
        isDuplicate,
        ruleMatch: ruleMatch ? {
          ruleId: ruleMatch.id,
          transactionId: ruleMatch.transactionId,
          categoryId: ruleMatch.categoryId,
          pattern: ruleMatch.pattern,
          transactionName: null,
        } : null,
      })
    }

    return { detectedColumns, rows, savedMapping: null }
  },

  commit: async (payload: {
    accountId: string
    rows: {
      bankRow: { date: string; amount: number; description: string }
      budgetTransactionId?: string
      occurrenceDate?: string
      excluded?: boolean
      subRowEdits?: any[]
    }[]
    forecastOccurrences: { transactionId: string; date: string }[]
  }): Promise<{ success: boolean; committed: number }> => {
    markDirty()
    await initializeDatabase()
    const db = await getDbConnection()
    let committed = 0

    await db.beginTransaction()
    try {
      for (const row of payload.rows) {
        if (row.excluded) continue
        const id = generateId()
        const now = new Date().toISOString()
        // Determine type from amount
        const type = row.bankRow.amount >= 0 ? 'income' : 'expense'
        // Find category from rules or default
        const rulesResult = await db.query(
          'SELECT category_id FROM transaction_rules WHERE is_active = 1 AND (? LIKE \'%\' || pattern || \'%\') LIMIT 1',
          [row.bankRow.description.toLowerCase()]
        )
        const categoryId = (rulesResult.values?.[0] as any)?.category_id || 'cat-other'

        await db.run(
          `INSERT INTO historical_transactions (
            id, transaction_id, account_id, category_id, date, description, amount, type,
            is_posted, is_manual_edit, bank_description, archived_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id, row.budgetTransactionId || null, payload.accountId, categoryId,
            row.bankRow.date, row.bankRow.description, Math.abs(row.bankRow.amount),
            type, 1, 0, row.bankRow.description, now,
          ]
        )
        committed++
      }
      await db.commitTransaction()
    } catch (e) {
      await db.rollbackTransaction()
      throw e
    }

    return { success: true, committed }
  },
}

/* ─── forecastApi ─── */

export const forecastApi = {
  getBalanceForecast: async (startDate?: string, endDate?: string): Promise<BalanceForecast[]> => {
    await initializeDatabase()
    const db = await getDbConnection()
    const [accountsResult, transactionsResult, historyResult] = await Promise.all([
      db.query('SELECT * FROM accounts'),
      db.query('SELECT * FROM transactions WHERE is_active = 1'),
      db.query('SELECT * FROM historical_transactions ORDER BY date DESC LIMIT 5000'),
    ])
    const accounts = (accountsResult.values || []).map(mapAccount)
    const transactions = (transactionsResult.values || []).map(mapTransaction)
    const history = (historyResult.values || []).map(mapHistoryRow)
    const sDate = startDate ? createSafeDate(startDate) : new Date()
    const eDate = endDate ? createSafeDate(endDate) : new Date(sDate.getFullYear(), sDate.getMonth() + 3, sDate.getDate())
    const postedKeys = new Set(
      history.filter(h => !!h.transactionId && h.isPosted && !h.isExcluded)
        .map(h => `${h.transactionId}|${formatDateForStorage(h.date)}`)
    )
    return generateBalanceForecast(accounts, transactions, sDate, eDate, postedKeys, history)
  },

  getForecastTransactions: async (startDate?: string, endDate?: string): Promise<ForecastTransaction[]> => {
    await initializeDatabase()
    const db = await getDbConnection()
    const [accountsResult, categoriesResult, transactionsResult, historyResult] = await Promise.all([
      db.query('SELECT * FROM accounts'),
      db.query('SELECT * FROM categories'),
      db.query('SELECT * FROM transactions WHERE is_active = 1'),
      db.query('SELECT * FROM historical_transactions ORDER BY date DESC LIMIT 5000'),
    ])
    const accounts = (accountsResult.values || []).map(mapAccount)
    const categories = (categoriesResult.values || []).map(mapCategory)
    const transactions = (transactionsResult.values || []).map(mapTransaction)
    const history = (historyResult.values || []).map(mapHistoryRow)
    const sDate = startDate ? createSafeDate(startDate) : new Date()
    const eDate = endDate ? createSafeDate(endDate) : new Date(sDate.getFullYear(), sDate.getMonth() + 3, sDate.getDate())
    const raw = generateForecastTransactions(transactions, categories, accounts, sDate, eDate, history)
    const postedKeys = new Set(
      history.filter(h => !!h.transactionId && h.isPosted && !h.isExcluded)
        .map(h => `${h.transactionId}|${formatDateForStorage(h.date)}`)
    )
    return raw.filter(ftx => {
      const key = `${ftx.transactionId}|${formatDateForStorage(ftx.date)}`
      return !postedKeys.has(key)
    })
  },

  getLowBalanceAnalysis: async (startDate?: string, endDate?: string): Promise<LowBalanceAnalysis[]> => {
    const forecasts = await forecastApi.getBalanceForecast(startDate, endDate)
    await initializeDatabase()
    const db = await getDbConnection()
    const accountsResult = await db.query('SELECT * FROM accounts')
    const accounts = (accountsResult.values || []).map(mapAccount)
    return generateLowBalanceAnalysis(accounts, forecasts)
  },

  addManualAdjustment: async (adjustment: {
    date: string
    amount: number
    description: string
    accountId: string
    categoryId?: string
  }): Promise<ForecastTransaction> => {
    markDirty()
    await initializeDatabase()
    const db = await getDbConnection()
    const id = generateId()
    const now = new Date().toISOString()
    await db.run(
      `INSERT INTO forecast_overrides (id, transaction_id, date, original_amount, override_amount, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, 'manual', adjustment.date, adjustment.amount, adjustment.amount, adjustment.description, now, now]
    )
    return {
      id,
      transactionId: 'manual',
      date: adjustment.date,
      name: adjustment.description,
      description: adjustment.description,
      amount: adjustment.amount,
      categoryId: adjustment.categoryId || '',
      categoryName: '',
      categoryColor: '#3B82F6',
      accountId: adjustment.accountId,
      accountName: '',
      type: adjustment.amount >= 0 ? 'income' : 'expense',
      isTransfer: false,
      isPosted: false,
      isOverride: false,
    } as unknown as ForecastTransaction
  },

  removeManualAdjustment: async (id: string): Promise<void> => {
    markDirty()
    await initializeDatabase()
    const db = await getDbConnection()
    await db.run('DELETE FROM forecast_overrides WHERE id = ?', [id])
  },

  resetForecast: async (): Promise<void> => {
    markDirty()
    await initializeDatabase()
    const db = await getDbConnection()
    await db.run("DELETE FROM forecast_overrides WHERE transaction_id = 'manual'")
  },
}

/* ─── rulesApi ─── */

export const rulesApi = {
  getAll: async (): Promise<ImportRule[]> => {
    await initializeDatabase()
    const db = await getDbConnection()
    const result = await db.query(`
      SELECT r.*, t.name as transaction_name, c.name as category_name, a.name as account_name
      FROM transaction_rules r
      LEFT JOIN transactions t ON r.transaction_id = t.id
      LEFT JOIN categories c ON r.category_id = c.id
      LEFT JOIN accounts a ON r.account_id = a.id
      ORDER BY r.created_at DESC
    `)
    return (result.values || []).map((row: any) => ({
      id: row.id,
      transactionId: row.transaction_id,
      accountId: row.account_id,
      accountIds: row.account_id ? row.account_id.split(',') : [],
      restrictToAccount: Boolean(row.restrict_to_account),
      pattern: row.pattern,
      categoryId: row.category_id,
      isActive: Boolean(row.is_active),
      matchCount: row.match_count || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      transactionName: row.transaction_name || null,
      categoryName: row.category_name || null,
      accountName: row.account_name || null,
    }))
  },

  create: async (rule: {
    transactionId?: string | null
    accountIds?: string[]
    restrictToAccount?: boolean
    pattern: string
    categoryId: string
  }): Promise<ImportRule> => {
    markDirty()
    await initializeDatabase()
    const db = await getDbConnection()
    const id = generateId()
    const now = new Date().toISOString()
    await db.run(
      `INSERT INTO transaction_rules (
        id, transaction_id, account_id, restrict_to_account, pattern, category_id, is_active, match_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, rule.transactionId || null,
        rule.accountIds?.join(',') || null,
        rule.restrictToAccount ? 1 : 0,
        rule.pattern, rule.categoryId, 1, 0, now, now,
      ]
    )
    return {
      id,
      transactionId: rule.transactionId || null,
      accountId: rule.accountIds?.join(',') || null,
      accountIds: rule.accountIds || [],
      restrictToAccount: rule.restrictToAccount || false,
      pattern: rule.pattern,
      categoryId: rule.categoryId,
      isActive: true,
      matchCount: 0,
      createdAt: now,
      updatedAt: now,
    }
  },

  update: async (id: string, patch: Partial<{
    pattern: string
    restrictToAccount: boolean
    isActive: boolean
    accountIds: string[]
  }>): Promise<ImportRule> => {
    markDirty()
    await initializeDatabase()
    const db = await getDbConnection()
    const sets: string[] = []
    const vals: any[] = []
    if (patch.pattern !== undefined) { sets.push('pattern = ?'); vals.push(patch.pattern) }
    if (patch.restrictToAccount !== undefined) { sets.push('restrict_to_account = ?'); vals.push(patch.restrictToAccount ? 1 : 0) }
    if (patch.isActive !== undefined) { sets.push('is_active = ?'); vals.push(patch.isActive ? 1 : 0) }
    if (patch.accountIds !== undefined) { sets.push('account_id = ?'); vals.push(patch.accountIds.join(',')) }
    sets.push('updated_at = ?')
    vals.push(new Date().toISOString())
    vals.push(id)
    await db.run(`UPDATE transaction_rules SET ${sets.join(', ')} WHERE id = ?`, vals)
    const all = await rulesApi.getAll()
    return all.find(r => r.id === id)!
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    markDirty()
    await initializeDatabase()
    const db = await getDbConnection()
    await db.run('DELETE FROM transaction_rules WHERE id = ?', [id])
    return { success: true }
  },

  getExamples: async (transactionId: string): Promise<RuleExamplesResult> => {
    await initializeDatabase()
    const db = await getDbConnection()
    const result = await db.query(
      `SELECT bank_description, account_id, amount, date
       FROM historical_transactions
       WHERE transaction_id = ? AND bank_description IS NOT NULL
       ORDER BY date DESC LIMIT 50`,
      [transactionId]
    )
    const examples = (result.values || []).map((row: any) => ({
      bankDescription: row.bank_description,
      accountId: row.account_id,
      amount: row.amount,
      date: row.date,
    }))
    return {
      examples,
      count: examples.length,
      suggestedPattern: examples.length > 0 ? examples[0].bankDescription.slice(0, 20) : null,
      confidence: examples.length > 0 ? 0.8 : null,
      existingRule: null,
      existingRulePatterns: [],
      suggestionsSuppressed: false,
    }
  },

  disableSuggestions: async (_transactionId: string): Promise<{ success: boolean }> => {
    // No-op on mobile for now — suggestions state not yet stored
    return { success: true }
  },

  suggestPattern: async (descriptions: string[]): Promise<{ pattern: string | null; confidence: number | null }> => {
    if (descriptions.length === 0) return { pattern: null, confidence: null }
    // Simple: return the longest common substring
    const pattern = descriptions[0].slice(0, 15)
    return { pattern, confidence: 0.6 }
  },

  suggestPatternDiscriminating: async (params: {
    positives: string[]
    sessionNegatives: string[]
    accountId: string
    transactionId: string
  }): Promise<{ pattern: string | null; confidence: number | null }> => {
    if (params.positives.length === 0) return { pattern: null, confidence: null }
    const pattern = params.positives[0].slice(0, 15)
    return { pattern, confidence: 0.6 }
  },
}

/* ─── healthApi ─── */

export const healthApi = {
  check: async (): Promise<{ status: string; timestamp: string }> => {
    await initializeDatabase()
    const db = await getDbConnection()
    await db.query('SELECT 1')
    return { status: 'ok', timestamp: new Date().toISOString() }
  },
}
