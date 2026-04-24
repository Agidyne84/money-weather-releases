import express from 'express'
import cors from 'cors'
import path from 'path'
import { getDatabase, initializeDatabase, Database } from './database'
import { validateAccount, validateCategory, validateTransaction, validatePreference } from './validation'
import { generateBalanceForecast, generateForecastTransactions, generateLowBalanceAnalysis } from './forecast'
import { migrateHistoryOnStartDateChange } from './historyMigration'

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
app.use(express.json())

// Initialize database
let db: Database

async function startServer() {
  try {
    await initializeDatabase()
    db = getDatabase()
    console.log('Database initialized successfully')
    
    // Routes
    app.get('/api/health', (req: any, res: any) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() })
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
      const { name, type, startingBalance, currentBalance, includeInLowBalanceAnalysis } = req.body
      
      try {
        await db.run(`
          UPDATE accounts 
          SET name = ?, type = ?, starting_balance = ?, current_balance = ?, 
              include_in_low_balance_analysis = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [name, type, startingBalance, currentBalance, includeInLowBalanceAnalysis ? 1 : 0, id])
        
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
          SET name = ?, parent_id = ?, color = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
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
          JOIN categories c ON t.category_id = c.id
          JOIN accounts a ON t.account_id = a.id
          ORDER BY t.created_at DESC
          LIMIT ? OFFSET ?
        `, [Number(limit), Number(offset)])
        
        res.json(Database.toCamelCaseRows(transactions))
      } catch (error) {
        res.status(500).json({ error: (error as Error).message })
      }
    })

    app.post('/api/transactions', async (req: any, res: any) => {
      const { 
        name, amount, frequencyValue, frequencyUnit, customFrequencyPattern,
        startDate, endDate, pauseStartDate, pauseEndDate,
        categoryId, accountId, type 
      } = req.body
      
      // Validate input
      const validation = validateTransaction({ 
        name, amount, frequencyValue, frequencyUnit, customFrequencyPattern,
        startDate, endDate, pauseStartDate, pauseEndDate,
        categoryId, accountId, type, isActive: true 
      })
      if (!validation.isValid) {
        return res.status(400).json({ error: 'Validation failed', details: validation.errors })
      }
      
      try {
        const id = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        await db.run(`
          INSERT INTO transactions (
            id, name, amount, frequency_value, frequency_unit, custom_frequency_pattern,
            start_date, end_date, pause_start_date, pause_end_date,
            category_id, account_id, type
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          id, name, amount, frequencyValue, frequencyUnit, customFrequencyPattern,
          startDate, endDate, pauseStartDate, pauseEndDate,
          categoryId, accountId, type
        ])
        
        const newTransaction = await db.get(`
          SELECT t.*, c.name as category_name, c.color as category_color,
                 a.name as account_name, a.type as account_type
          FROM transactions t
          JOIN categories c ON t.category_id = c.id
          JOIN accounts a ON t.account_id = a.id
          WHERE t.id = ?
        `, [id])
        
        res.json(Database.toCamelCase(newTransaction))
      } catch (error) {
        res.status(400).json({ error: (error as Error).message })
      }
    })

    app.put('/api/transactions/:id', async (req: any, res: any) => {
      const { id } = req.params
      const { 
        name, amount, frequencyValue, frequencyUnit, customFrequencyPattern,
        startDate, endDate, pauseStartDate, pauseEndDate,
        categoryId, accountId, type, isActive
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
              account_id = ?, type = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [
          name, amount, frequencyValue, frequencyUnit, customFrequencyPattern,
          startDate, endDate, pauseStartDate, pauseEndDate,
          categoryId, accountId, type, isActive ? 1 : 0, id
        ])
        
        const updatedTransaction = await db.get(`
          SELECT t.*, c.name as category_name, c.color as category_color,
                 a.name as account_name, a.type as account_type
          FROM transactions t
          JOIN categories c ON t.category_id = c.id
          JOIN accounts a ON t.account_id = a.id
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
        const { startDate, endDate, accountId, categoryId, limit = 500, offset = 0, includeUnposted } = req.query
        const conditions: string[] = ['h.is_suppressed = 0']
        if (!includeUnposted) { conditions.push('h.is_posted = 1') }
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
          JOIN categories c ON h.category_id = c.id
          JOIN accounts a ON h.account_id = a.id
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
      const { transactionId, accountId, categoryId, date, description, amount, type, isSuppressed, isManualEdit, isPosted } = req.body
      if (!accountId || !categoryId || !date || !description || amount === undefined || !type) {
        return res.status(400).json({ error: 'Missing required fields' })
      }
      try {
        const histId = `hist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        await db.run(`
          INSERT INTO historical_transactions (
            id, transaction_id, account_id, category_id, date, description, amount, type, is_suppressed, is_manual_edit, is_posted
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [histId, transactionId || null, accountId, categoryId, date, description, amount, type, isSuppressed ? 1 : 0, isManualEdit ? 1 : 0, isPosted !== undefined ? (isPosted ? 1 : 0) : 1])

        const row = await db.get(`
          SELECT h.*, c.name AS category_name, c.color AS category_color,
                 a.name AS account_name, a.type AS account_type
          FROM historical_transactions h
          JOIN categories c ON h.category_id = c.id
          JOIN accounts a ON h.account_id = a.id
          WHERE h.id = ?
        `, [histId])
        res.json(Database.toCamelCase(row))
      } catch (error) {
        res.status(400).json({ error: (error as Error).message })
      }
    })

    app.put('/api/history/:id', async (req: any, res: any) => {
      const { id } = req.params
      const { accountId, categoryId, date, description, amount, type, isManualEdit, isPosted } = req.body
      try {
        // isManualEdit can be explicitly passed (e.g., for reset).
        // Default to 1 (true) when not provided to preserve existing behavior.
        const manualEditFlag = isManualEdit !== undefined ? (isManualEdit ? 1 : 0) : 1
        const result = await db.run(`
          UPDATE historical_transactions
          SET account_id     = COALESCE(?, account_id),
              category_id    = COALESCE(?, category_id),
              date           = COALESCE(?, date),
              description    = COALESCE(?, description),
              amount         = COALESCE(?, amount),
              type           = COALESCE(?, type),
              is_manual_edit = ?,
              is_posted      = COALESCE(?, is_posted)
          WHERE id = ?
        `, [
          accountId ?? null, categoryId ?? null, date ?? null,
          description ?? null, amount ?? null, type ?? null,
          manualEditFlag,
          isPosted !== undefined ? (isPosted ? 1 : 0) : null,
          id
        ])
        if (result.changes === 0) {
          return res.status(404).json({ error: 'History row not found' })
        }
        const row = await db.get(`
          SELECT h.*, c.name AS category_name, c.color AS category_color,
                 a.name AS account_name, a.type AS account_type
          FROM historical_transactions h
          JOIN categories c ON h.category_id = c.id
          JOIN accounts a ON h.account_id = a.id
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

    app.listen(PORT, () => {
      console.log(`Budget App server running on port ${PORT}`)
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

// Start the server
startServer()
