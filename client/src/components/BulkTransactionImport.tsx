import React, { useState, useEffect } from 'react'
import { Category, Account } from '../types'
import { categoriesApi, transactionsApi, accountsApi } from '../services/api'
import { createSafeDate, formatDateForStorage } from '../utils/dateUtils'
import FrequencySelector from './FrequencySelector'
import CategorySelector from './CategorySelector'

interface BulkTransaction {
  name: string
  amount: string
  type: 'income' | 'expense'
  frequency: {
    unit: 'days' | 'weeks' | 'months' | 'years'
    value: number
    customPattern?: string
  }
  categoryId: string
  accountId: string
  startDate: string
}

const BulkTransactionEntry: React.FC = () => {
  const [categories, setCategories] = useState<Category[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [transactions, setTransactions] = useState<BulkTransaction[]>([
    {
      name: '',
      amount: '',
      type: 'expense',
      frequency: {
        unit: 'months',
        value: 1,
        customPattern: undefined
      },
      categoryId: '',
      accountId: '',
      startDate: formatDateForStorage(new Date())
    }
  ])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [successCount, setSuccessCount] = useState(0)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [categoriesData, accountsData] = await Promise.all([
        categoriesApi.getAll(),
        accountsApi.getAll(),
      ])
      setCategories(categoriesData)
      setAccounts(accountsData)
      
      // Set default values for first transaction
      if (accountsData.length > 0 && categoriesData.length > 0) {
        const firstCategory = categoriesData.find(c => !c.parentId)
        setTransactions([{ 
          name: '',
          amount: '',
          type: 'expense',
          frequency: {
            unit: 'months',
            value: 1,
            customPattern: undefined
          },
          categoryId: firstCategory?.id || '',
          accountId: '',
          startDate: formatDateForStorage(new Date())
        }])
      }
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  const addTransactionRow = () => {
    const defaultCategoryId = categories.find(c => !c.parentId)?.id || ''
    
    setTransactions(prev => [...prev, {
      name: '',
      amount: '',
      type: 'expense',
      frequency: {
        unit: 'months',
        value: 1,
        customPattern: undefined
      },
      categoryId: defaultCategoryId,
      accountId: '',
      startDate: formatDateForStorage(new Date())
    }])
  }

  const removeTransactionRow = (index: number) => {
    setTransactions(prev => prev.filter((_, i) => i !== index))
  }

  const updateTransaction = (index: number, field: keyof BulkTransaction, value: any) => {
    setTransactions(prev => prev.map((t, i) => 
      i === index ? { ...t, [field]: value } : t
    ))
  }

  const validateTransactions = (): boolean => {
    const validationErrors: string[] = []
    
    transactions.forEach((transaction, index) => {
      if (!transaction.name.trim()) {
        validationErrors.push(`Row ${index + 1}: Transaction name is required`)
      }
      if (!transaction.amount || isNaN(Number(transaction.amount))) {
        validationErrors.push(`Row ${index + 1}: Amount must be a valid number`)
      }
      if (Number(transaction.amount) === 0) {
        validationErrors.push(`Row ${index + 1}: Amount cannot be zero`)
      }
      if (!transaction.categoryId) {
        validationErrors.push(`Row ${index + 1}: Category is required`)
      }
      if (!transaction.accountId) {
        validationErrors.push(`Row ${index + 1}: Account is required`)
      }
    })
    
    setErrors(validationErrors)
    return validationErrors.length === 0
  }

  const handleSubmit = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault()
    
    if (!validateTransactions()) return
    
    setIsSubmitting(true)
    setErrors([])
    setSuccessCount(0)
    
    try {
      const promises = transactions.map(async (transaction) => {
        const transactionData = {
          name: transaction.name,
          amount: transaction.type === 'expense' ? -Math.abs(Number(transaction.amount)) : Math.abs(Number(transaction.amount)),
          frequency: transaction.frequency,
          startDate: createSafeDate(transaction.startDate),
          categoryId: transaction.categoryId,
          accountId: transaction.accountId,
          type: transaction.type,
          isActive: true
        }
        
        return transactionsApi.create(transactionData)
      })
      
      await Promise.all(promises)
      setSuccessCount(transactions.length)
      
      // Reset form
      const defaultCategoryId = categories.find(c => !c.parentId)?.id || ''
      setTransactions([{
        name: '',
        amount: '',
        type: 'expense',
        frequency: {
          unit: 'months',
          value: 1,
          customPattern: undefined
        },
        categoryId: defaultCategoryId,
        accountId: '',
        startDate: formatDateForStorage(new Date())
      }])
    } catch (error) {
      console.error('Error creating transactions:', error)
      setErrors(['Failed to create some transactions. Please try again.'])
    } finally {
      setIsSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-500">Loading data...</div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Bulk Transaction Entry</h2>
        <p className="text-gray-600 mt-1">Add multiple transactions at once to quickly set up your budget</p>
      </div>

      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-6">
          <p className="text-sm text-red-800 font-medium mb-2">Please fix the following errors:</p>
          <ul className="text-sm text-red-700 list-disc list-inside">
            {errors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {successCount > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-6">
          <p className="text-sm text-green-800">
            Successfully created {successCount} transaction{successCount > 1 ? 's' : ''}!
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="space-y-4">
          {transactions.map((transaction, index) => (
            <div key={index} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm font-medium text-gray-900">Transaction {index + 1}</h3>
                {transactions.length > 1 && (
                  <button
                    type="button"
                    className="text-red-600 hover:text-red-800 text-sm"
                    onClick={() => removeTransactionRow(index)}
                    disabled={isSubmitting}
                  >
                    Remove
                  </button>
                )}
              </div>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                <div>
                  <label className="form-label text-sm">Name</label>
                  <input
                    type="text"
                    className="form-input text-sm"
                    placeholder="Transaction name"
                    value={transaction.name}
                    onChange={(e) => updateTransaction(index, 'name', e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
                
                <div>
                  <label className="form-label text-sm">Amount</label>
                  <input
                    type="number"
                    className="form-input text-sm"
                    placeholder="0.00"
                    step="0.01"
                    value={transaction.amount}
                    onChange={(e) => updateTransaction(index, 'amount', e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
                
                <div>
                  <label className="form-label text-sm">Type</label>
                  <select
                    className="form-input text-sm"
                    value={transaction.type}
                    onChange={(e) => updateTransaction(index, 'type', e.target.value as 'income' | 'expense' | 'administrative')}
                    disabled={isSubmitting}
                  >
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                    <option value="administrative">Administrative</option>
                  </select>
                </div>
                
                <div>
                  <label className="form-label text-sm">Start Date</label>
                  <input
                    type="date"
                    className="form-input text-sm"
                    value={transaction.startDate}
                    onChange={(e) => updateTransaction(index, 'startDate', e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
                
                <div>
                  <label className="form-label text-sm">Category</label>
                  <CategorySelector
                    categories={categories}
                    selectedCategoryId={transaction.categoryId}
                    onChange={id => updateTransaction(index, 'categoryId', id)}
                    onCategoryAdded={cat => {
                      setCategories(prev => [...prev, cat])
                      updateTransaction(index, 'categoryId', cat.id)
                    }}
                    className="form-input text-sm"
                  />
                </div>
                
                <div>
                  <label className="form-label text-sm">Account</label>
                  <select
                    className="form-input text-sm"
                    value={transaction.accountId}
                    onChange={(e) => updateTransaction(index, 'accountId', e.target.value)}
                    disabled={isSubmitting}
                  >
                    <option value="">Select account</option>
                    {accounts.map(account => (
                      <option key={account.id} value={account.id}>
                        {account.name} (${account.currentBalance.toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div className="mt-3">
                <label className="form-label text-sm">Frequency</label>
                <FrequencySelector
                  value={transaction.frequency}
                  onChange={(frequency) => updateTransaction(index, 'frequency', frequency)}
                  startDate={transaction.startDate}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row justify-between items-center mt-6 space-y-3 sm:space-y-0 sm:space-x-4">
          <button
            type="button"
            className="btn-secondary w-full sm:w-auto"
            onClick={addTransactionRow}
            disabled={isSubmitting}
          >
            Add Another Transaction
          </button>
          
          <div className="flex space-x-3 w-full sm:w-auto">
            <button
              type="button"
              className="btn-secondary w-full sm:w-auto"
              onClick={() => {
                const defaultAccountId = ''
                const defaultCategoryId = categories.find(c => !c.parentId)?.id || ''
                setTransactions([{
                  name: '',
                  amount: '',
                  type: 'expense',
                  frequency: {
                    unit: 'months',
                    value: 1,
                    customPattern: undefined
                  },
                  categoryId: defaultCategoryId,
                  accountId: defaultAccountId,
                  startDate: formatDateForStorage(new Date())
                }])
                setErrors([])
                setSuccessCount(0)
              }}
              disabled={isSubmitting}
            >
              Clear All
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="btn-primary w-full sm:w-auto"
              disabled={isSubmitting || transactions.every(t => !t.name.trim() && !t.amount)}
            >
              {isSubmitting ? 'Creating...' : `Create ${transactions.length} Transaction${transactions.length > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

export default BulkTransactionEntry
