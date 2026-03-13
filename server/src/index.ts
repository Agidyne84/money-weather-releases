import express from 'express'
import cors from 'cors'
import path from 'path'
import { Database } from 'better-sqlite3'
import { readFileSync } from 'fs'

const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(cors())
app.use(express.json())

// Initialize database
const dbPath = path.join(__dirname, '../database/budget.db')
const db = new Database(dbPath)

// Initialize schema
const schema = readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8')
db.exec(schema)

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Categories
app.get('/api/categories', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all()
  res.json(categories)
})

// Transactions
app.get('/api/transactions', (req, res) => {
  const { limit = 50, offset = 0 } = req.query
  const transactions = db.prepare(`
    SELECT t.*, c.name as category_name, c.color as category_color
    FROM transactions t
    JOIN categories c ON t.category_id = c.id
    ORDER BY t.date DESC
    LIMIT ? OFFSET ?
  `).all(Number(limit), Number(offset))
  res.json(transactions)
})

app.post('/api/transactions', (req, res) => {
  const { date, description, amount, category_id, type, is_recurring, recurring_frequency } = req.body
  
  try {
    const stmt = db.prepare(`
      INSERT INTO transactions (id, date, description, amount, category_id, type, is_recurring, recurring_frequency)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    
    const id = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const result = stmt.run(id, date, description, amount, category_id, type, is_recurring, recurring_frequency)
    
    res.json({ id, ...req.body })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// Budget summary
app.get('/api/budget/summary/:year/:month', (req, res) => {
  const { year, month } = req.params
  
  // Get income and expenses for the month
  const incomeExpense = db.prepare(`
    SELECT 
      type,
      SUM(amount) as total
    FROM transactions 
    WHERE strftime('%Y', date) = ? AND strftime('%m', date) = ?
    GROUP BY type
  `).all(year, month.padStart(2, '0'))
  
  const income = incomeExpense.find(item => item.type === 'income')?.total || 0
  const expenses = incomeExpense.find(item => item.type === 'expense')?.total || 0
  
  res.json({
    income,
    expenses,
    net: income - expenses
  })
})

// Export/Import endpoints
app.get('/api/export', (req, res) => {
  const transactions = db.prepare('SELECT * FROM transactions ORDER BY date').all()
  const categories = db.prepare('SELECT * FROM categories').all()
  
  res.json({
    exported_at: new Date().toISOString(),
    version: '1.0',
    data: {
      transactions,
      categories
    }
  })
})

app.post('/api/import', (req, res) => {
  const { transactions, categories } = req.body.data
  
  try {
    const importTx = db.transaction(() => {
      // Import categories
      if (categories) {
        const categoryStmt = db.prepare(`
          INSERT OR REPLACE INTO categories (id, name, color)
          VALUES (?, ?, ?)
        `)
        for (const cat of categories) {
          categoryStmt.run(cat.id, cat.name, cat.color)
        }
      }
      
      // Import transactions
      if (transactions) {
        const transactionStmt = db.prepare(`
          INSERT OR REPLACE INTO transactions (
            id, date, description, amount, category_id, type, 
            is_recurring, recurring_frequency, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const txn of transactions) {
          transactionStmt.run(
            txn.id, txn.date, txn.description, txn.amount, 
            txn.category_id, txn.type, txn.is_recurring, 
            txn.recurring_frequency, txn.created_at, new Date().toISOString()
          )
        }
      }
    })
    
    importTx()
    res.json({ success: true, imported: { transactions: transactions?.length || 0, categories: categories?.length || 0 } })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// Serve static files from client in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../../client/dist')))
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../client/dist/index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`Budget App server running on port ${PORT}`)
  console.log(`Database: ${dbPath}`)
})
