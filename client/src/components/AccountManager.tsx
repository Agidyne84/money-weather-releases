import React, { useState, useEffect } from 'react'
import { Account } from '../types'
import { accountsApi } from '../services/api'
import { formatDateForStorage } from '../utils/dateUtils'

const AccountManager: React.FC = () => {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [showAdjustForm, setShowAdjustForm] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [adjustingAccount, setAdjustingAccount] = useState<Account | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    type: 'checking' as 'checking' | 'savings' | 'credit' | 'investment',
    startingBalance: '',
    includeInLowBalanceAnalysis: true
  })
  const [adjustFormData, setAdjustFormData] = useState({
    amount: '',
    date: formatDateForStorage(new Date()),
    description: '',
    categoryId: '',
    transactionId: ''
  })
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    loadAccounts()
  }, [])

  const loadAccounts = async () => {
    try {
      const data = await accountsApi.getAll()
      setAccounts(data)
    } catch (error) {
      console.error('Error loading accounts:', error)
    } finally {
      setLoading(false)
    }
  }

  const validateForm = (): boolean => {
    const errors: string[] = []
    
    if (!formData.name.trim()) errors.push('Account name is required')
    if (!formData.startingBalance || isNaN(Number(formData.startingBalance))) errors.push('Starting balance must be a valid number')
    
    setFormErrors(errors)
    return errors.length === 0
  }

  const validateAdjustForm = (): boolean => {
    const errors: string[] = []
    
    if (!adjustFormData.amount || isNaN(Number(adjustFormData.amount))) errors.push('Amount must be a valid number')
    if (Number(adjustFormData.amount) === 0) errors.push('Amount cannot be zero')
    if (!adjustFormData.date) errors.push('Date is required')
    
    setFormErrors(errors)
    return errors.length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm()) return
    
    setIsSubmitting(true)
    try {
      const accountData = {
        name: formData.name,
        type: formData.type,
        startingBalance: Number(formData.startingBalance),
        currentBalance: Number(formData.startingBalance),
        includeInLowBalanceAnalysis: formData.includeInLowBalanceAnalysis
      }
      
      if (editingAccount) {
        await accountsApi.update(editingAccount.id, accountData)
      } else {
        await accountsApi.create(accountData)
      }
      
      // Reset form and reload
      resetForm()
      await loadAccounts()
    } catch (error) {
      console.error('Error saving account:', error)
      setFormErrors(['Failed to save account. Please try again.'])
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleAdjustBalance = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateAdjustForm() || !adjustingAccount) return
    
    setIsSubmitting(true)
    try {
      // For now, just update the current balance
      // In a future version, this would create a transaction record
      const adjustmentAmount = Number(adjustFormData.amount)
      const newBalance = adjustingAccount.currentBalance + adjustmentAmount
      
      await accountsApi.update(adjustingAccount.id, {
        currentBalance: newBalance
      })
      
      // Reset form and reload
      resetAdjustForm()
      await loadAccounts()
    } catch (error) {
      console.error('Error adjusting balance:', error)
      setFormErrors(['Failed to adjust balance. Please try again.'])
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEdit = (account: Account) => {
    setEditingAccount(account)
    setFormData({
      name: account.name,
      type: account.type,
      startingBalance: account.startingBalance.toString(),
      includeInLowBalanceAnalysis: account.includeInLowBalanceAnalysis
    })
    setShowAddForm(true)
    setFormErrors([])
  }

  const handleAdjust = (account: Account) => {
    setAdjustingAccount(account)
    setAdjustFormData({
      amount: '',
      date: formatDateForStorage(new Date()),
      description: '',
      categoryId: '',
      transactionId: ''
    })
    setShowAdjustForm(true)
    setFormErrors([])
  }

  const handleDelete = async (account: Account) => {
    if (!confirm(`Are you sure you want to delete "${account.name}"? This action cannot be undone.`)) {
      return
    }
    
    try {
      await accountsApi.delete(account.id)
      await loadAccounts()
    } catch (error) {
      console.error('Error deleting account:', error)
      alert('Failed to delete account. Please try again.')
    }
  }

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'checking',
      startingBalance: '',
      includeInLowBalanceAnalysis: true
    })
    setEditingAccount(null)
    setShowAddForm(false)
    setFormErrors([])
  }

  const resetAdjustForm = () => {
    setAdjustFormData({
      amount: '',
      date: formatDateForStorage(new Date()),
      description: '',
      categoryId: '',
      transactionId: ''
    })
    setAdjustingAccount(null)
    setShowAdjustForm(false)
    setFormErrors([])
  }

  const getAccountTypeLabel = (type: string) => {
    const labels = {
      checking: 'Checking',
      savings: 'Savings',
      credit: 'Credit',
      investment: 'Investment'
    }
    return labels[type as keyof typeof labels] || type
  }

  const getAccountTypeColor = (type: string) => {
    const colors = {
      checking: 'blue',
      savings: 'green',
      credit: 'red',
      investment: 'purple'
    }
    return colors[type as keyof typeof colors] || 'gray'
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-500">Loading accounts...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Accounts</h2>
          <p className="text-gray-600">Manage your bank accounts and credit cards</p>
        </div>
        <button 
          className="btn-primary"
          onClick={() => setShowAddForm(true)}
        >
          Add Account
        </button>
      </div>

      {/* Accounts List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {accounts.map(account => (
          <div key={account.id} className="card">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className={`w-10 h-10 rounded-full bg-${getAccountTypeColor(account.type)}-100 flex items-center justify-center`}>
                  <div className={`w-4 h-4 rounded-full bg-${getAccountTypeColor(account.type)}-500`}></div>
                </div>
                <div>
                  <h3 className="font-medium text-gray-900">{account.name}</h3>
                  <p className="text-sm text-gray-500">{getAccountTypeLabel(account.type)}</p>
                </div>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Current Balance</span>
                <span className={`font-medium ${account.currentBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  ${account.currentBalance.toFixed(2)}
                </span>
              </div>
            </div>
            
            <div className="flex justify-end space-x-2 mt-4">
              <button 
                className="btn-secondary text-sm"
                onClick={() => handleAdjust(account)}
              >
                Adjust Balance
              </button>
              <button 
                className="btn-secondary text-sm"
                onClick={() => handleEdit(account)}
              >
                Edit
              </button>
              <button 
                className="btn-secondary text-sm text-red-600"
                onClick={() => handleDelete(account)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        
        {accounts.length === 0 && (
          <div className="col-span-full text-center py-12">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No accounts yet</h3>
            <p className="text-gray-500 mb-4">Add your first account to start tracking your finances</p>
            <button 
              className="btn-primary"
              onClick={() => setShowAddForm(true)}
            >
              Add Account
            </button>
          </div>
        )}
      </div>

      {/* Add/Edit Account Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              {editingAccount ? 'Edit Account' : 'Add Account'}
            </h3>
            
            {formErrors.length > 0 && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <h4 className="text-sm font-medium text-red-800 mb-2">Please fix the following errors:</h4>
                <ul className="text-sm text-red-700 list-disc list-inside">
                  {formErrors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="form-label">Account Name</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="e.g., Checking Account"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  disabled={isSubmitting}
                />
              </div>
              
              <div>
                <label className="form-label">Account Type</label>
                <select 
                  className="form-input"
                  value={formData.type}
                  onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value as any }))}
                  disabled={isSubmitting}
                >
                  <option value="checking">Checking</option>
                  <option value="savings">Savings</option>
                  <option value="credit">Credit Card</option>
                  <option value="investment">Investment</option>
                </select>
              </div>
              
              {!editingAccount && (
                <div>
                  <label className="form-label">Starting Balance</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    placeholder="0.00"
                    step="0.01"
                    value={formData.startingBalance}
                    onChange={(e) => setFormData(prev => ({ ...prev, startingBalance: e.target.value }))}
                    disabled={isSubmitting}
                  />
                </div>
              )}
              
              <div className="flex items-center">
                <input 
                  type="checkbox" 
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  id="includeInLowBalance"
                  checked={formData.includeInLowBalanceAnalysis}
                  onChange={(e) => setFormData(prev => ({ ...prev, includeInLowBalanceAnalysis: e.target.checked }))}
                  disabled={isSubmitting}
                />
                <label htmlFor="includeInLowBalance" className="ml-2 text-sm text-gray-700">
                  Include in low balance analysis
                </label>
              </div>
              
              <div className="flex justify-end space-x-3">
                <button 
                  type="button" 
                  className="btn-secondary"
                  onClick={resetForm}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn-primary"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Saving...' : (editingAccount ? 'Update' : 'Add')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Balance Adjustment Modal */}
      {showAdjustForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Adjust Balance - {adjustingAccount?.name}
            </h3>
            
            {formErrors.length > 0 && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <h4 className="text-sm font-medium text-red-800 mb-2">Please fix the following errors:</h4>
                <ul className="text-sm text-red-700 list-disc list-inside">
                  {formErrors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
            
            <form onSubmit={handleAdjustBalance} className="space-y-4">
              <div>
                <label className="form-label">Adjustment Amount</label>
                <input 
                  type="number" 
                  className="form-input" 
                  placeholder="0.00 (positive for deposit, negative for withdrawal)"
                  step="0.01"
                  value={adjustFormData.amount}
                  onChange={(e) => setAdjustFormData(prev => ({ ...prev, amount: e.target.value }))}
                  disabled={isSubmitting}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Use positive numbers for deposits, negative for withdrawals
                </p>
              </div>
              
              <div>
                <label className="form-label">Date</label>
                <input 
                  type="date" 
                  className="form-input"
                  value={adjustFormData.date}
                  onChange={(e) => setAdjustFormData(prev => ({ ...prev, date: e.target.value }))}
                  disabled={isSubmitting}
                />
              </div>
              
              <div>
                <label className="form-label">Description (Optional)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="e.g., ATM deposit, Bank fee"
                  value={adjustFormData.description}
                  onChange={(e) => setAdjustFormData(prev => ({ ...prev, description: e.target.value }))}
                  disabled={isSubmitting}
                />
              </div>
              
              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-sm text-gray-600">
                  <strong>Current Balance:</strong> ${adjustingAccount?.currentBalance.toFixed(2)}<br/>
                  <strong>New Balance:</strong> ${(adjustingAccount?.currentBalance || 0) + (Number(adjustFormData.amount) || 0)}
                </p>
              </div>
              
              <div className="flex justify-end space-x-3">
                <button 
                  type="button" 
                  className="btn-secondary"
                  onClick={resetAdjustForm}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn-primary"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Adjusting...' : 'Adjust Balance'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default AccountManager
