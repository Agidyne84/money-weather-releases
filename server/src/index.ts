import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import { getDatabase, initializeDatabase, Database } from './database'
import { validateAccount, validateCategory, validateTransaction, validatePreference } from './validation'
import { generateBalanceForecast, generateForecastTransactions, generateLowBalanceAnalysis } from './forecast'
import { migrateHistoryOnStartDateChange } from './historyMigration'
import { matchesRule, suggestPattern, normalizeDescription, suggestPatternDiscriminating, CONFIDENCE_THRESHOLD } from './ruleUtils'
import { exportDatabase, importDatabase, resetDatabase } from './backup'

// Helper function to create safe dates without timezone issues
function createSafeDate(dateInput: string | Date): Date {
  // Handle both string and Date inputs
  let dateString: string
  if (dateInput instanceof Date) {
    // If it's already a Date object, return it directly
    return dateInput
  } else {
    // If it's a string, process it
    dateString = dateInput
  }

  if (!dateString) {
    return new Date()
  }

  try {
    // Parse YYYY-MM-DD format and create Date at noon local time to avoid timezone issues
    const parts = dateString.split('-')
    if (parts.length === 3) {
      const year = parseInt(parts[0])
      const month = parseInt(parts[1]) - 1 // JavaScript months are 0-indexed
      const day = parseInt(parts[2])
      // Create date at noon local time (not UTC) to avoid timezone offset issues
      return new Date(year, month, day, 12, 0, 0)
    }
  } catch (error) {
    console.error('Error parsing date:', error)
  }

  // Fallback to regular Date parsing
  const date = new Date(dateString)
  return isNaN(date.getTime()) ? new Date() : date
}

const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Initialize database
let db: Database

async function startServer() {
  try {
    await initializeDatabase()
    db = getDatabase()
    console.log('Database initialized successfully')

    // One-time migration: copy is_transfer + transfer_to_account_id from the linked budget
    // transaction onto any existing history rows that are missing the flag.
    // Idempotent: only touches rows where is_transfer = 0 AND the source tx is a transfer.
    try {
      const { changes } = await db.run(`
        UPDATE historical_transactions
        SET
          is_transfer          = (SELECT is_transfer          FROM transactions WHERE id = historical_transactions.transaction_id),
          transfer_to_account_id = (SELECT transfer_to_account_id FROM transactions WHERE id = historical_transactions.transaction_id)
        WHERE transaction_id IS NOT NULL
          AND is_transfer = 0
          AND EXISTS (
            SELECT 1 FROM transactions
            WHERE id = historical_transactions.transaction_id
              AND is_transfer = 1
          )
      `)
      if (changes && changes > 0) {
        console.log(`[Migration] Backfilled transfer flags on ${changes} history row(s)`)
      }
    } catch (migErr) {
      console.error('[Migration] Failed to backfill transfer flags:', migErr)
    }

    // Audit: orphaned transaction_id references
    try {
      const orphans = await db.all(`
        SELECT h.id, h.transaction_id
        FROM historical_transactions h
        WHERE h.transaction_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = h.transaction_id)
        LIMIT 10
      `)
      if (orphans.length > 0) {
        const total = await db.get(`
          SELECT COUNT(*) AS count
          FROM historical_transactions h
          WHERE h.transaction_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = h.transaction_id)
        `)
        console.warn(`[Audit] ${total.count} history row(s) have orphaned transaction_id references`)
        console.warn(`[Audit] Sample IDs: ${orphans.map((o: any) => o.id).join(', ')}`)
      }
    } catch (auditErr) {
      console.error('[Audit] Failed to check orphaned transaction_id references:', auditErr)
    }

    // Routes
    app.get('/api/health', (req: any, res: any) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() })
    })

    // Backup/Restore endpoints
    app.post('/api/backup/export', async (req: any, res: any) => {
      try {
        const { passphrase } = req.body
        const buffer = await exportDatabase(passphrase || undefined)

        if (passphrase) {
          res.setHeader('Content-Type', 'application/octet-stream')
          res.setHeader('Content-Disposition', 'attachment; filename="budget-backup.budgetbackup"')
        } else {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Content-Disposition', 'attachment; filename="budget-backup.json"')
        }
        res.send(buffer)
      } catch (error) {
        console.error('[Backup Export] Error:', error)
        res.status(500).json({ error: (error as Error).message })
      }
    })

    app.post('/api/backup/import', express.raw({ type: 'application/octet-stream', limit: '100mb' }), async (req: any, res: any) => {
      try {
        const passphrase = req.headers['x-backup-passphrase'] as string | undefined
        const fileBuffer = Buffer.from(req.body)

        if (!fileBuffer || fileBuffer.length === 0) {
          return res.status(400).json({ error: 'No file provided' })
        }

        const result = await importDatabase(fileBuffer, passphrase || undefined)
        res.json(result)
      } catch (error) {
        console.error('[Backup Import] Error:', error)
        res.status(400).json({ error: (error as Error).message })
      }
    })

    app.post('/api/backup/reset', async (req: any, res: any) => {
      try {
        const result = await resetDatabase()
        res.json(result)
      } catch (error) {
        console.error('[Backup Reset] Error:', error)
        res.status(500).json({ error: (error as Error).message })
      }
    })

    // Cloud Sync endpoints (desktop)
    app.post('/api/sync/file-info', async (req: any, res: any) => {
      try {
        const { filePath } = req.body
        if (!filePath) {
          return res.status(400).json({ error: 'filePath is required' })
        }
        const exists = fs.existsSync(filePath)
        if (!exists) {
          return res.json({ exists: false, modifiedAt: null })
        }
        const stat = fs.statSync(filePath)
        res.json({ exists: true, modifiedAt: stat.mtime.toISOString(), size: stat.size })
      } catch (error) {
        console.error('[Sync File Info] Error:', error)
        res.status(500).json({ error: (error as Error).message })
      }
    })

    app.post('/api/sync/pull', async (req: any, res: any) => {
      try {
        const { filePath, passphrase } = req.body
        if (!filePath) {
          return res.status(400).json({ error: 'filePath is required' })
        }
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ error: 'Cloud backup file not found' })
        }
        const fileBuffer = fs.readFileSync(filePath)
        const result = await importDatabase(fileBuffer, passphrase || undefined)
        res.json(result)
      } catch (error) {
        console.error('[Sync Pull] Error:', error)
        res.status(500).json({ error: (error as Error).message })
      }
    })

    app.post('/api/sync/push', async (req: any, res: any) => {
      try {
        const { filePath, passphrase } = req.body
        if (!filePath) {
          return res.status(400).json({ error: 'filePath is required' })
        }
        const buffer = await exportDatabase(passphrase || undefined)
        fs.writeFileSync(filePath, buffer)
        const stat = fs.statSync(filePath)
        res.json({ success: true, modifiedAt: stat.mtime.toISOString(), size: stat.size })
      } catch (error) {
        console.error('[Sync Push] Error:', error)
        res.status(500).json({ error: (error as Error).message })
      }
    })

    // Accounts endpoints
    app.get('/api/accounts', async (req: any, res: any) => {
      try {
        const accounts = await db.all('SELECT * FROM accounts ORDER BY name')
        res.json(Database.toCamelCaseRows(accounts))
      } catch (error) {
        res.status(500).json({ error: (error as Error).message })
      }
    })

    app.post('/api/accounts', async (req: any, res: any) => {
      const { name, type, startingBalance, includeInLowBalanceAnalysis } = req.body
      
      // Validate input
      const validation = validateAccount({ name, type, startingBalance, includeInLowBalanceAnalysis })
      if (!validation.isValid) {
        return res.status(400).json({ error: 'Validation failed', details: validation.errors })
      }
      
      try {
        const id = `acc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        await db.run(`
          INSERT INTO accounts (id, name, type, starting_balance, current_balance, include_in_low_balance_analysis)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [id, name, type, startingBalance, startingBalance, includeInLowBalanceAnalysis ? 1 : 0])
        
        const newAccount = await db.get('SELECT * FROM accounts WHERE id = ?', [id])
        res.json(Database.toCamelCase(newAccount))
      } catch (error) {
        res.status(400).json({ error: (error as Error).message })
      }
    })

    app.put('/api/accounts/:id', async (req: any, res: any) => {
      const { id } = req.params
      const fields: Record<string, any> = {}
      const allowed = ['name', 'type', 'startingBalance', 'currentBalance', 'includeInLowBalanceAnalysis', 'importSettings']
      allowed.forEach(key => {
        if (key in req.body) fields[key] = req.body[key]
      })

      if (Object.keys(fields).length === 0) {
        return res.status(400).json({ error: 'No fields to update' })
      }

      const setClause = Object.keys(fields).map(key => {
        const snake = key.replace(/[A-Z]/g, c => '_' + c.toLowerCase())
        return `${snake} = ?`
      }).join(', ')
      const values = Object.values(fields).map(v => {
        if (typeof v === 'boolean') return v ? 1 : 0
        if (typeof v === 'object' && v !== null) return JSON.stringify(v)
        return v
      })

      try {
        await db.run(`
          UPDATE accounts
          SET ${setClause}, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [...values, id])
        
        const updatedAccount = await db.get('SELECT * FROM accounts WHERE id = ?', [id])
        if (!updatedAccount) {
          return res.status(404).json({ error: 'Account not found' })
        }
        res.json(Database.toCamelCase(updatedAccount))
      } catch (error) {
        res.status(400).json({ error: (error as Error).message })
      }
    })

    app.delete('/api/accounts/:id', async (req: any, res: any) => {
      const { id } = req.params
      
      try {
        const result = await db.run('DELETE FROM accounts WHERE id = ?', [id])
        if (result.changes === 0) {
          return res.status(404).json({ error: 'Account not found' })
        }
        res.json({ success: true })
      } catch (error) {
        res.status(400).json({ error: (error as Error).message })
      }
    })

    // Categories endpoints
    app.get('/api/categories', async (req: any, res: any) => {
      try {
        const categories = await db.all('SELECT * FROM categories ORDER BY sort_order, name')
        
        // Build hierarchy
        const categoryMap = new Map()
        const rootCategories: any[] = []
        
        // First pass: create all category objects
        categories.forEach((cat: any) => {
          const category = Database.toCamelCase(cat)
          category.children = []
          categoryMap.set(cat.id, category)
        })
        
        // Second pass: build hierarchy
        categoryMap.forEach((category: any) => {
          if (category.parentId) {
            const parent = categoryMap.get(category.parentId)
            if (parent) {
              parent.children.push(category)
            }
          } else {
            rootCategories.push(category)
          }
        })
        
        res.json(rootCategories)
      } catch (error) {
        res.status(500).json({ error: (error as Error).message })
      }
    })

    app.post('/api/categories', async (req: any, res: any) => {
      const { name, parentId, color, sortOrder } = req.body
      
      try {
        const id = `cat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        await db.run(`
          INSERT INTO categories (id, name, parent_id, color, sort_order)
          VALUES (?, ?, ?, ?, ?)
        `, [id, name, parentId || null, color, sortOrder || 0])
        
        const newCategory = await db.get('SELECT * FROM categories WHERE id = ?', [id])
        res.json(Database.toCamelCase(newCategory))
      } catch (error) {
        res.status(400).json({ error: (error as Error).message })
      }
    })

    app.put('/api/categories/:id', async (req: any, res: any) => {
      const { id } = req.params
      const { name, parentId, color, sortOrder } = req.body
      
      try {
        await db.run(`
          UPDATE categories 
          SET name = ?, parent_id = ?, color = ?, sort_order = ?
          WHERE id = ?
        `, [name, parentId || null, color, sortOrder || 0, id])
        
        const updatedCategory = await db.get('SELECT * FROM categories WHERE id = ?', [id])
        if (!updatedCategory) {
          return res.status(404).json({ error: 'Category not found' })
        }
        res.json(Database.toCamelCase(updatedCategory))
      } catch (error) {
        res.status(400).json({ error: (error as Error).message })
      }
    })

    app.delete('/api/categories/:id', async (req: any, res: any) => {
      const { id } = req.params
      
      try {
        const result = await db.run('DELETE FROM categories WHERE id = ?', [id])
        if (result.changes === 0) {
          return res.status(404).json({ error: 'Category not found' })
        }
        res.json({ success: true })
      } catch (error) {
        res.status(400).json({ error: (error as Error).message })
      }
    })

    // Transactions endpoints
    app.get('/api/transactions', async (req: any, res: any) => {
      try {
        const { limit = 50, offset = 0 } = req.query
        const transactions = await db.all(`
          SELECT t.*, c.name as category_name, c.color as category_color,
                 a.name as account_name, a.type as account_type
          FROM transactions t
          LEFT JOIN categories c ON t.category_id = c.id
          LEFT JOIN accounts a ON t.account_id = a.id
          ORDER BY t.created_at DESC
          LIMIT ? OFFSET ?
        `, [Number(limit), Number(offset)])
        
        res.json(Database.toCamelCaseRows(transactions))
      } catch (error) {
        res.status(500).json({ error: (error as Error).message })
      }
    })

    app.post('/api/transactions', async (req: any, res: any) => {
      const { name, amount, frequencyValue, frequencyUnit, customFrequencyPattern, startDate, endDate, pauseStartDate, pauseEndDate, categoryId, accountId, type, isTransfer, transferToAccountId } = req.body

      const normalizedAmount = type === 'expense' ? -Math.abs(Number(amount)) : Math.abs(Number(amount))
      const validation = validateTransaction({ name, amount: normalizedAmount, frequencyValue, frequencyUnit, customFrequencyPattern, startDate, endDate, pauseStartDate, pauseEndDate, categoryId, accountId, type, isTransfer, transferToAccountId, isActive: true })
      if (!validation.isValid) {
        return res.status(400).json({ error: 'Validation failed', details: validation.errors })
      }

      try {
        // Validate that the account exists
        const account = await db.get('SELECT * FROM accounts WHERE id = ?', [accountId])
        if (!account) {
          return res.status(400).json({ error: 'Invalid account ID' })
        }

        // Validate that the category exists
        const category = await db.get('SELECT * FROM categories WHERE id = ?', [categoryId])
        if (!category) {
          return res.status(400).json({ error: 'Invalid category ID' })
        }

        // Insert transaction without the end_date for now, as it's not in the schema
        // Generate explicit ID for TEXT PRIMARY KEY (matches accounts pattern)
        const transactionId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        
        const result = await db.run(`
          INSERT INTO transactions (id, name, amount, frequency_value, frequency_unit, custom_frequency_pattern, start_date, end_date, pause_start_date, pause_end_date, category_id, account_id, type, is_transfer, transfer_to_account_id, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [transactionId, name, normalizedAmount, frequencyValue, frequencyUnit, customFrequencyPattern || null, startDate, endDate || null, pauseStartDate || null, pauseEndDate || null, categoryId, accountId, type, isTransfer ? 1 : 0, transferToAccountId || null, true])
        
        console.log('[POST /transactions] Insert result changes:', result.changes, 'id:', transactionId)
        if (!result.changes) {
          return res.status(500).json({ error: 'Failed to insert transaction', details: 'No rows affected' })
        }

        const query = 'SELECT * FROM transactions WHERE id = ?'
        const transaction = await db.get(query, [transactionId])
        console.log('[POST /transactions] Retrieved row:', transaction)

        if (!transaction) {
          return res.status(500).json({ error: 'Failed to retrieve created transaction', details: `id=${transactionId}` })
        }

        // Fetch category and account names separately to avoid JOIN issues
        const categoryInfo = transaction.category_id ? await db.get('SELECT name, color FROM categories WHERE id = ?', [transaction.category_id]) : null
        const accountInfo = transaction.account_id ? await db.get('SELECT name, type FROM accounts WHERE id = ?', [transaction.account_id]) : null
        
        if (categoryInfo) {
          transaction.category_name = categoryInfo.name
          transaction.category_color = categoryInfo.color
        }
        if (accountInfo) {
          transaction.account_name = accountInfo.name
          transaction.account_type = accountInfo.type
        }
        res.status(201).json(Database.toCamelCase(transaction))
      } catch (error) {
        res.status(400).json({ error: (error as Error).message })
      }
    })

    app.put('/api/transactions/:id', async (req: any, res: any) => {
      const { id } = req.params
      const { 
        name, amount, frequencyValue, frequencyUnit, customFrequencyPattern,
        startDate, endDate, pauseStartDate, pauseEndDate,
        categoryId, accountId, type, isTransfer, transferToAccountId, isActive
      } = req.body
      
      try {
        // Fetch the pre-update row to ensure it exists
        const existing = await db.get('SELECT * FROM transactions WHERE id = ?', [id])
        if (!existing) {
          return res.status(404).json({ error: 'Transaction not found' })
        }

        // Note: Budget transaction start date changes no longer trigger history migration.
        // The Forecast page start date is now the sole gate between Forecast and History.
        // This aligns with the new design where Budget edits only affect forecast generation,
        // not the historical record.

        await db.run(`
          UPDATE transactions 
          SET name = ?, amount = ?, frequency_value = ?, frequency_unit = ?, 
              custom_frequency_pattern = ?, start_date = ?, end_date = ?, 
              pause_start_date = ?, pause_end_date = ?, category_id = ?, 
              account_id = ?, type = ?, is_transfer = ?, transfer_to_account_id = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [
          name, amount, frequencyValue, frequencyUnit, customFrequencyPattern,
          startDate, endDate, pauseStartDate, pauseEndDate,
          categoryId, accountId, type, isTransfer ? 1 : 0, transferToAccountId || null, isActive ? 1 : 0, id
        ])
        
        const updatedTransaction = await db.get(`
          SELECT t.*, c.name as category_name, c.color as category_color,
                 a.name as account_name, a.type as account_type
          FROM transactions t
          LEFT JOIN categories c ON t.category_id = c.id
          LEFT JOIN accounts a ON t.account_id = a.id
          WHERE t.id = ?
        `, [id])
        
        if (!updatedTransaction) {
          return res.status(404).json({ error: 'Transaction not found' })
        }
        res.json(Database.toCamelCase(updatedTransaction))
      } catch (error) {
        res.status(400).json({ error: (error as Error).message })
      }
    })

    app.delete('/api/transactions/:id', async (req: any, res: any) => {
      const { id } = req.params
      
      try {
        // Intentionally do NOT touch historical_transactions here. The FK has
        // ON DELETE SET NULL, so existing history rows keep their snapshot of
        // name/amount/date even after the source transaction is removed.
        const result = await db.run('DELETE FROM transactions WHERE id = ?', [id])
        if (result.changes === 0) {
          return res.status(404).json({ error: 'Transaction not found' })
        }
        res.json({ success: true })
      } catch (error) {
        res.status(400).json({ error: (error as Error).message })
      }
    })

    // ---------- Historical transactions endpoints ----------
    app.get('/api/history', async (req: any, res: any) => {
      try {
        const { startDate, endDate, accountId, categoryId, limit = 500, offset = 0, includeUnposted, includeSuppressed, includeExcluded } = req.query
        const includeSuppressedFlag = includeSuppressed === 'true' || includeSuppressed === true
        const includeUnpostedFlag = includeUnposted === 'true' || includeUnposted === true
        const includeExcludedFlag = includeExcluded === 'true' || includeExcluded === true
        const conditions: string[] = []
        if (!includeSuppressedFlag) { conditions.push('h.is_suppressed = 0') }
        if (!includeUnpostedFlag) { conditions.push('h.is_posted = 1') }
        if (!includeExcludedFlag) { conditions.push('h.is_excluded = 0') }
        const params: any[] = []
        if (startDate)  { conditions.push('h.date >= ?'); params.push(startDate) }
        if (endDate)    { conditions.push('h.date <= ?'); params.push(endDate) }
        if (accountId)  { conditions.push('h.account_id = ?'); params.push(accountId) }
        if (categoryId) { conditions.push('h.category_id = ?'); params.push(categoryId) }
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''

        const rows = await db.all(`
          SELECT h.*, c.name AS category_name, c.color AS category_color,
                 a.name AS account_name, a.type AS account_type,
                 t.name AS source_transaction_name
          FROM historical_transactions h
          LEFT JOIN categories c ON h.category_id = c.id
          LEFT JOIN accounts a ON h.account_id = a.id
          LEFT JOIN transactions t ON h.transaction_id = t.id
          ${where}
          ORDER BY h.date DESC, h.archived_at DESC
          LIMIT ? OFFSET ?
        `, [...params, Number(limit), Number(offset)])
        res.json(Database.toCamelCaseRows(rows))
      } catch (error) {
        res.status(500).json({ error: (error as Error).message })
      }
    })

    app.post('/api/history', async (req: any, res: any) => {
      const { transactionId, accountId, categoryId, date, description, amount, type, isSuppressed, isManualEdit, isPosted, isTransfer, transferToAccountId } = req.body
      if (!accountId || !categoryId || !date || !description || amount === undefined || !type) {
        return res.status(400).json({ error: 'Missing required fields' })
      }
      try {
        const histId = `hist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        await db.run(`
          INSERT INTO historical_transactions (
            id, transaction_id, account_id, category_id, date, description, amount, type, is_suppressed, is_manual_edit, is_posted, is_transfer, transfer_to_account_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [histId, transactionId || null, accountId, categoryId, date, description, amount, type, isSuppressed ? 1 : 0, isManualEdit ? 1 : 0, isPosted !== undefined ? (isPosted ? 1 : 0) : 1, isTransfer ? 1 : 0, transferToAccountId || null])

        const row = await db.get(`
          SELECT h.*, c.name AS category_name, c.color AS category_color,
                 a.name AS account_name, a.type AS account_type
          FROM historical_transactions h
          LEFT JOIN categories c ON h.category_id = c.id
          LEFT JOIN accounts a ON h.account_id = a.id
          WHERE h.id = ?
        `, [histId])
        res.json(Database.toCamelCase(row))
      } catch (error) {
        res.status(400).json({ error: (error as Error).message })
      }
    })

    app.put('/api/history/:id', async (req: any, res: any) => {
      const { id } = req.params
      const {
        transactionId, accountId, categoryId, date, description, amount, type,
        isPosted, isSuppressed, isExcluded, isTransfer, transferToAccountId, isManualEdit
      } = req.body
      try {
        // isManualEdit can be explicitly passed (e.g., for reset).
        // Default to 1 (true) when not provided to preserve existing behavior.
        const manualEditFlag = isManualEdit !== undefined ? (isManualEdit ? 1 : 0) : 1
        const setClauses: string[] = []
        const values: any[] = []

        if ('transactionId' in req.body) {
          setClauses.push('transaction_id = ?')
          values.push(transactionId ?? null)
        }
        if (accountId !== undefined) {
          setClauses.push('account_id = ?')
          values.push(accountId)
        }
        if (categoryId !== undefined) {
          setClauses.push('category_id = ?')
          values.push(categoryId)
        }
        if (date !== undefined) {
          setClauses.push('date = ?')
          values.push(date)
        }
        if (description !== undefined) {
          setClauses.push('description = ?')
          values.push(description)
        }
        if (amount !== undefined) {
          setClauses.push('amount = ?')
          values.push(amount)
        }
        if (type !== undefined) {
          setClauses.push('type = ?')
          values.push(type)
        }
        if (isTransfer !== undefined) {
          setClauses.push('is_transfer = ?')
          values.push(isTransfer ? 1 : 0)
        }
        if (transferToAccountId !== undefined) {
          setClauses.push('transfer_to_account_id = ?')
          values.push(transferToAccountId)
        }
        setClauses.push('is_manual_edit = ?')
        values.push(manualEditFlag)
        if (isPosted !== undefined) {
          setClauses.push('is_posted = ?')
          values.push(isPosted ? 1 : 0)
        }
        if (isExcluded !== undefined) {
          setClauses.push('is_excluded = ?')
          values.push(isExcluded ? 1 : 0)
        }

        if (setClauses.length === 0) {
          return res.status(400).json({ error: 'No fields to update' })
        }

        const result = await db.run(
          `UPDATE historical_transactions SET ${setClauses.join(', ')} WHERE id = ?`,
          [...values, id]
        )
        if (result.changes === 0) {
          return res.status(404).json({ error: 'History row not found' })
        }
        const row = await db.get(`
          SELECT h.*, c.name AS category_name, c.color AS category_color,
                 a.name AS account_name, a.type AS account_type
          FROM historical_transactions h
          LEFT JOIN categories c ON h.category_id = c.id
          LEFT JOIN accounts a ON h.account_id = a.id
          WHERE h.id = ?
        `, [id])
        res.json(Database.toCamelCase(row))
      } catch (error) {
        res.status(400).json({ error: (error as Error).message })
      }
    })

    app.delete('/api/history/:id', async (req: any, res: any) => {
      const { id } = req.params
      try {
        const result = await db.run('DELETE FROM historical_transactions WHERE id = ?', [id])
        if (result.changes === 0) {
          return res.status(404).json({ error: 'History row not found' })
        }
        res.json({ success: true })
      } catch (error) {
        res.status(400).json({ error: (error as Error).message })
      }
    })

    app.post('/api/history/reset', async (req: any, res: any) => {
      try {
        await db.run('DELETE FROM historical_transactions')
        res.json({ success: true, message: 'All historical transactions deleted' })
      } catch (error) {
        console.error('History reset error:', error)
        res.status(500).json({ error: 'Failed to reset history' })
      }
    })

    // ---------- Import endpoints ----------
    app.post('/api/import/preview', async (req: any, res: any) => {
      try {
        const { csv, accountId } = req.body
        if (!csv || !accountId) {
          return res.status(400).json({ error: 'Missing csv or accountId' })
        }

        // Parse CSV
        const lines = csv.split('\n').filter((l: string) => l.trim())
        if (lines.length === 0) {
          return res.status(400).json({ error: 'Empty CSV' })
        }

        // Parse headers (respecting quoted CSV fields)
        const parseLine = (line: string): string[] => {
          const result: string[] = []
          let current = ''
          let inQuotes = false
          for (const ch of line) {
            if (ch === '"') {
              inQuotes = !inQuotes
            } else if (ch === ',' && !inQuotes) {
              result.push(current.trim())
              current = ''
            } else {
              current += ch
            }
          }
          result.push(current.trim())
          return result
        }

        const headers = parseLine(lines[0])

        // Auto-detect columns
        const colNames = headers.map(h => h.toLowerCase().replace(/"/g, ''))
        const detectField = (candidates: string[]): number | null => {
          for (const cand of candidates) {
            const idx = colNames.findIndex(n => n.includes(cand))
            if (idx >= 0) return idx
          }
          return null
        }

        const dateIdx = detectField(['date'])
        const amountIdx = detectField(['amount', 'debit', 'credit'])
        const descIdx = detectField(['description', 'name', 'memo', 'transaction'])

        const detectedColumns = {
          date: dateIdx !== null ? headers[dateIdx] : null,
          amount: amountIdx !== null ? headers[amountIdx] : null,
          description: descIdx !== null ? headers[descIdx] : null,
        }

        // Load saved mapping for this account
        const account = await db.get('SELECT import_settings FROM accounts WHERE id = ?', [accountId])
        let savedMapping: any = null
        try {
          if (account?.import_settings) {
            savedMapping = JSON.parse(account.import_settings)
          }
        } catch { /* ignore invalid JSON */ }

        // Parse rows
        const rows: any[] = []
        for (let i = 1; i < lines.length; i++) {
          const fields = parseLine(lines[i])
          if (fields.length < Math.max(dateIdx ?? 0, amountIdx ?? 0, descIdx ?? 0) + 1) continue

          const rawDate = dateIdx !== null ? fields[dateIdx].replace(/"/g, '') : ''
          const rawAmount = amountIdx !== null ? fields[amountIdx].replace(/"/g, '').replace('$', '').replace(',', '') : ''
          const rawDesc = descIdx !== null ? fields[descIdx].replace(/"/g, '').replace(/\s+/g, ' ').trim() : ''

          // Parse date flexibly
          let parsedDate: string | null = null
          // ISO: YYYY-MM-DD
          const isoMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
          // US: MM/DD/YYYY
          const usMatch = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
          if (isoMatch) {
            parsedDate = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
          } else if (usMatch) {
            const m = usMatch[1].padStart(2, '0')
            const d = usMatch[2].padStart(2, '0')
            parsedDate = `${usMatch[3]}-${m}-${d}`
          }

          const amount = parseFloat(rawAmount)
          if (!parsedDate || isNaN(amount)) continue

          rows.push({
            date: parsedDate,
            amount,
            description: rawDesc,
          })
        }

        // Check for duplicates in historical_transactions.
        // We check both description (legacy) and bank_description (new) so
        // duplicates are caught regardless of when the row was imported.
        const existing = await db.all(`
          SELECT date, amount, description, bank_description
          FROM historical_transactions
          WHERE account_id = ?
        `, [accountId])
        const dupSet = new Set(
          existing.flatMap((r: any) => {
            const keys = [`${r.date}|${r.amount}|${r.description}`]
            if (r.bank_description) {
              keys.push(`${r.date}|${r.amount}|${r.bank_description}`)
            }
            return keys
          })
        )

        const finalRows = rows.map(r => ({
          ...r,
          isDuplicate: dupSet.has(`${r.date}|${r.amount}|${r.description}`)
        }))

        // Augment rows with rule matches
        const activeRules = await db.all(`
          SELECT r.*, t.name AS transaction_name, t.account_id AS transaction_account_id
          FROM transaction_rules r
          LEFT JOIN transactions t ON r.transaction_id = t.id
          WHERE r.is_active = 1
        `)

        const rowsWithRules = finalRows.map((r: any) => {
          let ruleMatch: any = null
          for (const rule of activeRules) {
            if (rule.restrict_to_account && rule.account_id) {
              const allowedIds = rule.account_id.split(',').map((s: string) => s.trim()).filter(Boolean)
              if (!allowedIds.includes(accountId)) continue
            }
            if (matchesRule(r.description, rule.pattern)) {
              ruleMatch = {
                ruleId: rule.id,
                transactionId: rule.transaction_id,
                categoryId: rule.category_id,
                pattern: rule.pattern,
                transactionName: rule.transaction_name,
              }
              break
            }
          }
          return { ...r, ruleMatch }
        })

        res.json({ detectedColumns, rows: rowsWithRules, savedMapping })
      } catch (error) {
        console.error('Import preview error:', error)
        res.status(500).json({ error: (error as Error).message })
      }
    })

    app.post('/api/import/commit', async (req: any, res: any) => {
      try {
        const { accountId, rows, forecastOccurrences } = req.body
        console.log('[POST /api/import/commit] accountId:', accountId, 'rows count:', rows?.length)
        if (!accountId || !Array.isArray(rows)) {
          console.warn('[POST /api/import/commit] Bad request: missing accountId or rows')
          return res.status(400).json({ error: 'Missing accountId or rows' })
        }

        const account = await db.get('SELECT * FROM accounts WHERE id = ?', [accountId])
        if (!account) {
          console.warn('[POST /api/import/commit] Account not found:', accountId)
          return res.status(404).json({ error: 'Account not found' })
        }

        const committed: any[] = []

        for (const row of rows) {
          try {
            if (row.excluded) continue
            if (!row.budgetTransactionId) continue

            // Get the budget transaction to determine category and type
            const budgetTx = await db.get('SELECT * FROM transactions WHERE id = ?', [row.budgetTransactionId])
            if (!budgetTx) {
              console.warn('[POST /api/import/commit] Budget transaction not found:', row.budgetTransactionId)
              continue
            }

            const histId = `hist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

            const isUnassigned = !row.occurrenceDate
            const budgetIsTransfer = budgetTx.is_transfer ? 1 : 0
            const budgetTransferToAccountId = budgetTx.transfer_to_account_id || null

            if (isUnassigned) {
              // Unassigned: standalone history row with bank row's own date, no transaction_id
              await db.run(`
                INSERT INTO historical_transactions (
                  id, transaction_id, account_id, category_id, date, description, amount, type,
                  is_transfer, transfer_to_account_id, is_manual_edit, is_posted, bank_description
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `, [
                histId,
                null,
                accountId,
                budgetTx.category_id,
                row.bankRow.date,
                budgetTx.name,
                row.bankRow.amount,
                budgetTx.type,
                budgetIsTransfer,
                budgetTransferToAccountId,
                1, // is_manual_edit
                1, // is_posted
                row.bankRow.description,
              ])
            } else {
              // Assigned to a specific occurrence date.
              // Delete any existing non-bank history rows for this transaction + date
              // so the bank import replaces rather than duplicates the forecast entry.
              await db.run(
                'DELETE FROM historical_transactions WHERE transaction_id = ? AND date = ? AND bank_description IS NULL',
                [row.budgetTransactionId, row.occurrenceDate]
              )

              await db.run(`
                INSERT INTO historical_transactions (
                  id, transaction_id, account_id, category_id, date, description, amount, type,
                  is_transfer, transfer_to_account_id, is_manual_edit, is_posted, bank_description
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `, [
                histId,
                row.budgetTransactionId,
                accountId,
                budgetTx.category_id,
                row.bankRow.date,
                budgetTx.name,
                row.bankRow.amount,
                budgetTx.type,
                budgetIsTransfer,
                budgetTransferToAccountId,
                1, // is_manual_edit
                1, // is_posted
                row.bankRow.description,
              ])

              // Mark the forecast occurrence as posted (create history row if not exists)
              const occ = (forecastOccurrences || []).find((o: any) =>
                o.transactionId === row.budgetTransactionId && o.date === row.occurrenceDate
              )
              if (occ) {
                const existingHist = await db.get(
                  'SELECT id FROM historical_transactions WHERE transaction_id = ? AND date = ? LIMIT 1',
                  [row.budgetTransactionId, occ.date]
                )
                if (!existingHist) {
                  const occHistId = `hist_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
                  await db.run(`
                    INSERT INTO historical_transactions (
                      id, transaction_id, account_id, category_id, date, description, amount, type,
                      is_transfer, transfer_to_account_id, is_manual_edit, is_posted
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  `, [
                    occHistId,
                    row.budgetTransactionId,
                    accountId,
                    budgetTx.category_id,
                    occ.date,
                    budgetTx.name,
                    budgetTx.amount,
                    budgetTx.type,
                    budgetIsTransfer,
                    budgetTransferToAccountId,
                    0,
                    1,
                  ])
                }
              }
            }

            // Increment match_count for any active rule that matched this row
            try {
              const matchingRules = await db.all(
                `SELECT id, pattern FROM transaction_rules
                 WHERE is_active = 1
                   AND (transaction_id = ? OR transaction_id IS NULL)`,
                [row.budgetTransactionId]
              )
              for (const mr of matchingRules) {
                if (matchesRule(row.bankRow.description, mr.pattern)) {
                  await db.run(
                    'UPDATE transaction_rules SET match_count = match_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                    [mr.id]
                  )
                }
              }
            } catch { /* non-critical */ }

            committed.push({ id: histId, ...row })
          } catch (rowErr) {
            console.error('[POST /api/import/commit] Row commit error:', rowErr, 'Row:', JSON.stringify(row))
            throw rowErr
          }
        }

        res.json({ success: true, committed: committed.length })
      } catch (error) {
        console.error('Import commit error:', error)
        console.error('Import commit request body:', JSON.stringify(req.body, null, 2))
        res.status(500).json({ error: (error as Error).message })
      }
    })

    // ---------- Transaction rules endpoints ----------

    app.get('/api/rules', async (req: any, res: any) => {
      try {
        const rules = await db.all(`
          SELECT r.*,
                 t.name AS transaction_name,
                 c.name AS category_name,
                 a.name AS account_name
          FROM transaction_rules r
          LEFT JOIN transactions t ON r.transaction_id = t.id
          LEFT JOIN categories c ON r.category_id = c.id
          LEFT JOIN accounts a ON r.account_id = a.id
          ORDER BY r.created_at DESC
        `)
        // Parse account_id CSV → accountIds array for each rule
        const enriched = rules.map((r: any) => ({
          ...r,
          accountIds: r.account_id ? r.account_id.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
        }))
        res.json(Database.toCamelCaseRows(enriched))
      } catch (error) {
        res.status(500).json({ error: (error as Error).message })
      }
    })

    app.post('/api/rules', async (req: any, res: any) => {
      const { transactionId, accountIds, restrictToAccount, pattern, categoryId } = req.body
      if (!pattern || !categoryId) {
        return res.status(400).json({ error: 'pattern and categoryId are required' })
      }
      const accountIdStr = Array.isArray(accountIds) && accountIds.length > 0 ? accountIds.join(',') : null
      try {
        const id = `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        await db.run(`
          INSERT INTO transaction_rules
            (id, transaction_id, account_id, restrict_to_account, pattern, category_id, is_active)
          VALUES (?, ?, ?, ?, ?, ?, 1)
        `, [
          id,
          transactionId || null,
          accountIdStr,
          restrictToAccount ? 1 : 0,
          normalizeDescription(pattern),
          categoryId,
        ])
        const created = await db.get(`
          SELECT r.*, t.name AS transaction_name, c.name AS category_name, a.name AS account_name
          FROM transaction_rules r
          LEFT JOIN transactions t ON r.transaction_id = t.id
          LEFT JOIN categories c ON r.category_id = c.id
          LEFT JOIN accounts a ON a.id = (CASE WHEN r.account_id IS NOT NULL THEN TRIM(SUBSTR(r.account_id || ',', 1, INSTR(r.account_id || ',', ',') - 1)) END)
          WHERE r.id = ?
        `, [id])
        const enrichedCreate = { ...created, accountIds: created.account_id ? created.account_id.split(',').map((s: string) => s.trim()).filter(Boolean) : [] }
        res.json(Database.toCamelCase(enrichedCreate))
      } catch (error) {
        res.status(400).json({ error: (error as Error).message })
      }
    })

    app.put('/api/rules/:id', async (req: any, res: any) => {
      const { id } = req.params
      const { pattern, restrictToAccount, isActive, accountIds } = req.body
      try {
        const setClauses: string[] = ['updated_at = CURRENT_TIMESTAMP']
        const values: any[] = []
        if (pattern !== undefined) {
          setClauses.push('pattern = ?')
          values.push(normalizeDescription(pattern))
        }
        if (restrictToAccount !== undefined) {
          setClauses.push('restrict_to_account = ?')
          values.push(restrictToAccount ? 1 : 0)
        }
        if (isActive !== undefined) {
          setClauses.push('is_active = ?')
          values.push(isActive ? 1 : 0)
        }
        if (accountIds !== undefined) {
          setClauses.push('account_id = ?')
          values.push(Array.isArray(accountIds) && accountIds.length > 0 ? accountIds.join(',') : null)
        }
        values.push(id)
        const result = await db.run(
          `UPDATE transaction_rules SET ${setClauses.join(', ')} WHERE id = ?`,
          values
        )
        if (result.changes === 0) {
          return res.status(404).json({ error: 'Rule not found' })
        }
        const rule = await db.get(`
          SELECT r.*, t.name AS transaction_name, c.name AS category_name, a.name AS account_name
          FROM transaction_rules r
          LEFT JOIN transactions t ON r.transaction_id = t.id
          LEFT JOIN categories c ON r.category_id = c.id
          LEFT JOIN accounts a ON a.id = (CASE WHEN r.account_id IS NOT NULL THEN TRIM(SUBSTR(r.account_id || ',', 1, INSTR(r.account_id || ',', ',') - 1)) END)
          WHERE r.id = ?
        `, [id])
        const enrichedPut = { ...rule, accountIds: rule.account_id ? rule.account_id.split(',').map((s: string) => s.trim()).filter(Boolean) : [] }
        res.json(Database.toCamelCase(enrichedPut))
      } catch (error) {
        res.status(400).json({ error: (error as Error).message })
      }
    })

    app.delete('/api/rules/:id', async (req: any, res: any) => {
      const { id } = req.params
      try {
        const result = await db.run('DELETE FROM transaction_rules WHERE id = ?', [id])
        if (result.changes === 0) {
          return res.status(404).json({ error: 'Rule not found' })
        }
        res.json({ success: true })
      } catch (error) {
        res.status(400).json({ error: (error as Error).message })
      }
    })

    // Return up to 200 historical bank descriptions for a budget item (excluding those
    // already matched by any existing active rule for this item), plus a suggested
    // pattern from Tier-1 LCS and a confidence score the client uses to decide
    // whether to invoke the Tier-2 discriminating endpoint.
    app.get('/api/rules/examples', async (req: any, res: any) => {
      const { transactionId } = req.query
      if (!transactionId) {
        return res.status(400).json({ error: 'transactionId is required' })
      }
      try {
        // Load ALL rows – we filter in JS so the LIMIT doesn't cut our corpus
        const allRows = await db.all(`
          SELECT h.bank_description AS bankDescription,
                 h.account_id AS accountId,
                 h.amount,
                 h.date
          FROM historical_transactions h
          WHERE h.transaction_id = ?
            AND h.bank_description IS NOT NULL
          ORDER BY h.date DESC
        `, [transactionId])

        // Fetch ALL active rules for this budget item (there may be more than one)
        const existingRules = await db.all(
          'SELECT id, pattern, is_active FROM transaction_rules WHERE transaction_id = ? AND is_active = 1',
          [transactionId]
        )
        const existingRule = existingRules.length > 0 ? existingRules[0] : null

        const suppressed = await db.get(
          `SELECT value FROM user_preferences WHERE key = ?`,
          [`no_rule_suggestion_${transactionId}`]
        )

        // Strip examples already covered by ANY existing active rule for this item
        const filteredRows = existingRules.length > 0
          ? allRows.filter((r: any) =>
              !existingRules.some((rule: any) => matchesRule(r.bankDescription, rule.pattern))
            )
          : allRows

        // Cap at 200 for the positive corpus and display list
        const rows = filteredRows.slice(0, 200)
        const descriptions = rows.map((r: any) => r.bankDescription)
        const suggestion = descriptions.length >= 3 ? suggestPattern(descriptions) : null

        res.json({
          examples: rows,
          count: rows.length,
          suggestedPattern: suggestion?.pattern ?? null,
          confidence: suggestion?.confidence ?? null,
          existingRule: existingRule ? Database.toCamelCase(existingRule) : null,
          existingRulePatterns: existingRules.map((r: any) => r.pattern as string),
          suggestionsSuppressed: !!suppressed,
        })
      } catch (error) {
        res.status(500).json({ error: (error as Error).message })
      }
    })

    // Compute a suggested match pattern from a caller-supplied list of descriptions.
    // Used by the client to compute patterns for session-only (uncommitted) examples.
    app.post('/api/rules/suggest-pattern', async (req: any, res: any) => {
      const { descriptions } = req.body
      if (!Array.isArray(descriptions) || descriptions.length === 0) {
        return res.status(400).json({ error: 'descriptions must be a non-empty array' })
      }
      try {
        const result = suggestPattern(descriptions)
        res.json({ pattern: result?.pattern ?? null, confidence: result?.confidence ?? null })
      } catch (error) {
        res.status(500).json({ error: (error as Error).message })
      }
    })

    // Tier-2 discriminating pattern endpoint.
    // Client calls this when Tier-1 (GET /api/rules/examples) returns confidence < THRESHOLD.
    // Accepts positives (the filtered example corpus), sessionNegatives (descriptions already
    // rule-matched to other items in the current reconciliation batch), accountId (current
    // import account), and transactionId (to exclude from history lookup).
    app.post('/api/rules/suggest-pattern-discriminating', async (req: any, res: any) => {
      const { positives, sessionNegatives, accountId, transactionId } = req.body
      if (!Array.isArray(positives) || positives.length === 0) {
        return res.status(400).json({ error: 'positives must be a non-empty array' })
      }
      try {
        const TARGET_NEGATIVES = 500
        let negatives: string[] = Array.isArray(sessionNegatives) ? [...sessionNegatives] : []

        // Fill from history when session negatives are insufficient
        if (negatives.length < TARGET_NEGATIVES && accountId) {
          const needed = TARGET_NEGATIVES - negatives.length

          // Active rules applicable to this account (unrestricted OR account in list)
          const applicableRules = await db.all(`
            SELECT id, pattern
            FROM transaction_rules
            WHERE is_active = 1
              AND (transaction_id IS NULL OR transaction_id != ?)
              AND (
                restrict_to_account = 0
                OR (account_id IS NOT NULL AND (',' || replace(account_id,' ','') || ',') LIKE ?)
              )
          `, [transactionId || '', `%,${accountId},%`])

          if (applicableRules.length > 0) {
            // Oversample from history for other transactions, then filter by rule match
            const histRows = await db.all(`
              SELECT DISTINCT bank_description
              FROM historical_transactions
              WHERE (transaction_id IS NULL OR transaction_id != ?)
                AND bank_description IS NOT NULL
              ORDER BY date DESC
              LIMIT ?
            `, [transactionId || '', needed * 6])

            const ruleMatched = histRows
              .filter((r: any) =>
                (applicableRules as any[]).some((rule: any) =>
                  matchesRule(r.bank_description, rule.pattern)
                )
              )
              .map((r: any) => r.bank_description as string)
              .slice(0, needed)

            negatives = [...negatives, ...ruleMatched]
          }
        }

        const result = suggestPatternDiscriminating(positives, negatives)
        res.json({
          pattern: result?.pattern ?? null,
          confidence: result?.confidence ?? null,
          negativeCount: negatives.length,
        })
      } catch (error) {
        res.status(500).json({ error: (error as Error).message })
      }
    })

    // List all budget items whose rule suggestions have been suppressed.
    app.get('/api/rules/suppressed', async (_req: any, res: any) => {
      try {
        const keys = await db.all(
          `SELECT key FROM user_preferences WHERE key LIKE 'rule_suggestions_suppressed_%' AND value = 'true'`
        )
        const transactionIds = keys.map((r: any) =>
          r.key.replace('rule_suggestions_suppressed_', '')
        )
        res.json(transactionIds)
      } catch (error) {
        res.status(500).json({ error: (error as Error).message })
      }
    })

    // Re-enable rule suggestions for a specific budget item.
    app.delete('/api/rules/suppressed/:transactionId', async (req: any, res: any) => {
      const { transactionId } = req.params
      try {
        await db.run(
          `DELETE FROM user_preferences WHERE key = ?`,
          [`rule_suggestions_suppressed_${transactionId}`]
        )
        res.json({ success: true })
      } catch (error) {
        res.status(500).json({ error: (error as Error).message })
      }
    })

    // Suppress rule suggestions for a specific budget item.
    app.post('/api/rules/disable-suggestions', async (req: any, res: any) => {
      const { transactionId } = req.body
      if (!transactionId) {
        return res.status(400).json({ error: 'transactionId is required' })
      }
      try {
        await db.run(`
          INSERT OR REPLACE INTO user_preferences (key, value, updated_at)
          VALUES (?, 'true', CURRENT_TIMESTAMP)
        `, [`no_rule_suggestion_${transactionId}`])
        res.json({ success: true })
      } catch (error) {
        res.status(400).json({ error: (error as Error).message })
      }
    })

    // User preferences endpoints
    app.get('/api/preferences', async (req: any, res: any) => {
      try {
        const preferences = await db.all('SELECT * FROM user_preferences')
        const prefObj: any = {}
        preferences.forEach((pref: any) => {
          prefObj[pref.key] = pref.value
        })
        res.json(prefObj)
      } catch (error) {
        res.status(500).json({ error: (error as Error).message })
      }
    })

    app.post('/api/preferences', async (req: any, res: any) => {
      const { key, value } = req.body
      
      try {
        await db.run(`
          INSERT OR REPLACE INTO user_preferences (key, value, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
        `, [key, value])
        
        res.json({ key, value })
      } catch (error) {
        res.status(400).json({ error: (error as Error).message })
      }
    })

    // Forecast endpoints
    app.get('/api/forecast/balance', async (req: any, res: any) => {
      try {
        const { startDate, endDate } = req.query
        const start = startDate ? createSafeDate(startDate) : new Date()
        const end = endDate ? createSafeDate(endDate) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 year from now

        const accounts = await db.all('SELECT * FROM accounts')
        const transactions = await db.all('SELECT * FROM transactions')

        const forecasts = generateBalanceForecast(accounts, transactions, start, end)
        res.json(forecasts)
      } catch (error) {
        console.error('Failed to get balance forecast:', error)
        res.status(500).json({ error: 'Failed to get balance forecast' })
      }
    })

    app.get('/api/forecast/transactions', async (req: any, res: any) => {
      try {
        const { startDate, endDate } = req.query
        const start = startDate ? createSafeDate(startDate) : new Date()
        const end = endDate ? createSafeDate(endDate) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
        
        // Get all transactions and categories
        const transactions = await db.all('SELECT * FROM transactions')
        const categories = await db.all('SELECT * FROM categories')
        const accounts = await db.all('SELECT * FROM accounts')
        
        // Generate forecast transactions
        const forecastTransactions = generateForecastTransactions(transactions, categories, accounts, start, end)
        
        res.json(forecastTransactions)
      } catch (error) {
        console.error('Failed to get forecast transactions:', error)
        res.status(500).json({ error: 'Failed to get forecast transactions' })
      }
    })

    app.get('/api/forecast/low-balance', async (req: any, res: any) => {
      try {
        const { startDate, endDate } = req.query
        const start = startDate ? createSafeDate(startDate) : new Date()
        const end = endDate ? createSafeDate(endDate) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
        
        // Get all accounts and transactions
        const accounts = await db.all('SELECT * FROM accounts')
        const transactions = await db.all('SELECT * FROM transactions')
        
        // Generate low balance analysis
        const lowBalanceAnalysis = generateLowBalanceAnalysis(accounts, transactions, start, end)
        
        res.json(lowBalanceAnalysis)
      } catch (error) {
        console.error('Failed to get low balance analysis:', error)
        res.status(500).json({ error: 'Failed to get low balance analysis' })
      }
    })

    app.post('/api/forecast/adjustments', async (req: any, res: any) => {
      try {
        const { date, amount, description, accountId, categoryId } = req.body
        
        if (!date || !amount || !description || !accountId) {
          return res.status(400).json({ error: 'Missing required fields' })
        }
        
        // Create manual adjustment transaction
        const result = await db.run(`
          INSERT INTO transactions (name, amount, frequency_value, frequency_unit, custom_pattern, start_date, end_date, category_id, account_id, type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          description,
          amount,
          1,
          'days',
          null,
          date,
          date,
          categoryId || null,
          accountId,
          amount >= 0 ? 'income' : 'expense'
        ])
        
        const newTransaction = await db.get('SELECT * FROM transactions WHERE id = ?', [result.lastInsertRowid])
        
        res.json(newTransaction)
      } catch (error) {
        console.error('Failed to add manual adjustment:', error)
        res.status(500).json({ error: 'Failed to add manual adjustment' })
      }
    })

    app.delete('/api/forecast/adjustments/:id', async (req: any, res: any) => {
      try {
        const { id } = req.params
        
        await db.run('DELETE FROM transactions WHERE id = ?', [id])
        
        res.json({ success: true })
      } catch (error) {
        console.error('Failed to remove manual adjustment:', error)
        res.status(500).json({ error: 'Failed to remove manual adjustment' })
      }
    })

    app.post('/api/forecast/reset', async (req: any, res: any) => {
      try {
        // Remove all manual adjustments (transactions with same start and end date)
        await db.run('DELETE FROM transactions WHERE start_date = end_date')
        // Remove all forecast overrides (one-time changes)
        await db.run('DELETE FROM forecast_overrides')
        
        res.json({ success: true })
      } catch (error) {
        console.error('Failed to reset forecast:', error)
        res.status(500).json({ error: 'Failed to reset forecast' })
      }
    })

    // Serve static files from client in production
    if (process.env.NODE_ENV === 'production') {
      app.use(express.static(path.join(__dirname, '../../client/dist')))

      app.get('*', (req: any, res: any) => {
        res.sendFile(path.join(__dirname, '../../client/dist/index.html'))
      })
    }

    // Wrap listen in a promise so we can catch EADDRINUSE and other startup errors
    const server = await new Promise<any>((resolve, reject) => {
      const srv = app.listen(PORT, () => {
        console.log(`Money Weather server running on port ${PORT}`)
        resolve(srv)
      })
      srv.on('error', (err: any) => {
        reject(err)
      })
    })

    // Store server for graceful shutdown
    ;(global as any).__moneyWeatherServer = server

  } catch (error) {
    console.error('Failed to start server:', error)
    throw error // Let Electron's retry loop handle it
  }
}

// Export for inline use in Electron
export { startServer }

// Export stopServer for graceful shutdown
export function stopServer() {
  const server = (global as any).__moneyWeatherServer
  if (server) {
    server.close(() => {
      console.log('[Server] HTTP server closed')
    })
  }
}

// Auto-start only when this file is run directly (not when imported)
if ((typeof require !== 'undefined') && (require.main === module)) {
  startServer()
}
