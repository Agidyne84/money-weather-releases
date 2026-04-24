import React, { useState, useEffect } from 'react'
import { Account } from '../types'
import { accountsApi } from '../services/api'
import { formatDateForStorage } from '../utils/dateUtils'

interface BalanceAdjustmentProps {
  account?: Account
  onAdjustmentComplete?: () => void
  trigger?: React.ReactNode
}

const BalanceAdjustment: React.FC<BalanceAdjustmentProps> = ({ 
  account: initialAccount, 
  onAdjustmentComplete, 
  trigger 
}) => {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [showModal, setShowModal] = useState(false)
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(initialAccount || null)
  const [adjustmentType, setAdjustmentType] = useState<'toAmount' | 'byAmount'>('toAmount')
  const [formData, setFormData] = useState({
    targetAmount: '',
    adjustmentAmount: '',
    date: formatDateForStorage(new Date()),
    description: ''
  })
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!initialAccount) {
      loadAccounts()
    }
  }, [initialAccount])

  const loadAccounts = async () => {
    try {
      const data = await accountsApi.getAll()
      setAccounts(data)
      if (data.length > 0 && !selectedAccount) {
        setSelectedAccount(data[0])
      }
    } catch (error) {
      console.error('Error loading accounts:', error)
    }
  }

  const validateForm = (): boolean => {
    const errors: string[] = []
    
    if (!selectedAccount) errors.push('Account is required')
    
    if (adjustmentType === 'toAmount') {
      if (!formData.targetAmount || isNaN(Number(formData.targetAmount))) {
        errors.push('Target amount must be a valid number')
      }
    } else {
      if (!formData.adjustmentAmount || isNaN(Number(formData.adjustmentAmount))) {
        errors.push('Adjustment amount must be a valid number')
      }
      if (Number(formData.adjustmentAmount) === 0) {
        errors.push('Adjustment amount cannot be zero')
      }
    }
    
    if (!formData.date) errors.push('Date is required')
    
    setFormErrors(errors)
    return errors.length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm() || !selectedAccount) return
    
    setIsSubmitting(true)
    try {
      let newBalance: number
      
      if (adjustmentType === 'toAmount') {
        newBalance = Number(formData.targetAmount)
      } else {
        newBalance = selectedAccount.currentBalance + Number(formData.adjustmentAmount)
      }
      
      await accountsApi.update(selectedAccount.id, {
        currentBalance: newBalance
      })
      
      // Reset form and close modal
      resetForm()
      setShowModal(false)
      onAdjustmentComplete?.()
    } catch (error) {
      console.error('Error adjusting balance:', error)
      setFormErrors(['Failed to adjust balance. Please try again.'])
    } finally {
      setIsSubmitting(false)
    }
  }

  const resetForm = () => {
    setFormData({
      targetAmount: '',
      adjustmentAmount: '',
      date: formatDateForStorage(new Date()),
      description: ''
    })
    setFormErrors([])
    setAdjustmentType('toAmount')
  }

  const openModal = () => {
    resetForm()
    setShowModal(true)
  }

  const calculateNewBalance = (): number => {
    if (!selectedAccount) return 0
    
    if (adjustmentType === 'toAmount') {
      return Number(formData.targetAmount) || selectedAccount.currentBalance
    } else {
      return selectedAccount.currentBalance + (Number(formData.adjustmentAmount) || 0)
    }
  }

  const getAdjustmentAmount = (): number => {
    if (!selectedAccount) return 0
    
    if (adjustmentType === 'toAmount') {
      return (Number(formData.targetAmount) || 0) - selectedAccount.currentBalance
    } else {
      return Number(formData.adjustmentAmount) || 0
    }
  }

  return (
    <>
      <button onClick={openModal} className="btn-secondary text-sm">
        {trigger || 'Adjust Balance'}
      </button>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Adjust Balance
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
              {!initialAccount && (
                <div>
                  <label className="form-label">Account</label>
                  <select 
                    className="form-input"
                    value={selectedAccount?.id || ''}
                    onChange={(e) => {
                      const account = accounts.find(a => a.id === e.target.value)
                      setSelectedAccount(account || null)
                    }}
                    disabled={isSubmitting}
                  >
                    <option value="">Select an account</option>
                    {accounts.map(account => (
                      <option key={account.id} value={account.id}>
                        {account.name} (${account.currentBalance.toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="form-label">Adjustment Type</label>
                <div className="flex space-x-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      className="mr-2"
                      value="toAmount"
                      checked={adjustmentType === 'toAmount'}
                      onChange={(e) => setAdjustmentType(e.target.value as 'toAmount' | 'byAmount')}
                      disabled={isSubmitting}
                    />
                    Adjust to amount
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      className="mr-2"
                      value="byAmount"
                      checked={adjustmentType === 'byAmount'}
                      onChange={(e) => setAdjustmentType(e.target.value as 'toAmount' | 'byAmount')}
                      disabled={isSubmitting}
                    />
                    Adjust by amount
                  </label>
                </div>
              </div>
              
              {adjustmentType === 'toAmount' ? (
                <div>
                  <label className="form-label">Target Balance</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    placeholder="0.00"
                    step="0.01"
                    value={formData.targetAmount}
                    onChange={(e) => setFormData(prev => ({ ...prev, targetAmount: e.target.value }))}
                    disabled={isSubmitting}
                  />
                </div>
              ) : (
                <div>
                  <label className="form-label">Adjustment Amount</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    placeholder="0.00 (positive for deposit, negative for withdrawal)"
                    step="0.01"
                    value={formData.adjustmentAmount}
                    onChange={(e) => setFormData(prev => ({ ...prev, adjustmentAmount: e.target.value }))}
                    disabled={isSubmitting}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Use positive numbers for deposits, negative for withdrawals
                  </p>
                </div>
              )}
              
              <div>
                <label className="form-label">Date</label>
                <input 
                  type="date" 
                  className="form-input"
                  value={formData.date}
                  onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                  disabled={isSubmitting}
                />
              </div>
              
              <div>
                <label className="form-label">Description (Optional)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="e.g., ATM deposit, Bank fee"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  disabled={isSubmitting}
                />
              </div>
              
              {selectedAccount && (
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-sm text-gray-600">
                    <strong>Current Balance:</strong> ${selectedAccount.currentBalance.toFixed(2)}<br/>
                    <strong>Adjustment:</strong> {getAdjustmentAmount() >= 0 ? '+' : ''}{getAdjustmentAmount().toFixed(2)}<br/>
                    <strong>New Balance:</strong> ${calculateNewBalance().toFixed(2)}
                  </p>
                </div>
              )}
              
              <div className="flex justify-end space-x-3">
                <button 
                  type="button" 
                  className="btn-secondary"
                  onClick={() => setShowModal(false)}
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
    </>
  )
}

export default BalanceAdjustment
