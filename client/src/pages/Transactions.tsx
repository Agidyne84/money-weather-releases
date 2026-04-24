import React, { useState, useEffect } from 'react'
import { Transaction } from '../types'

const Transactions: React.FC = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // TODO: Fetch transactions from API
    setLoading(false)
  }, [])

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-500">Loading transactions...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transactions</h1>
          <p className="text-gray-600">Manage your recurring transactions and overrides</p>
        </div>
        <button className="btn-primary">
          Add Transaction
        </button>
      </div>

      {/* Transaction List */}
      <div className="card">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Recurring Transactions</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div className="flex-1">
              <div className="flex items-center space-x-3">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <div>
                  <p className="font-medium text-gray-900">Monthly Salary</p>
                  <p className="text-sm text-gray-500">Income • Monthly • Starting Jan 1, 2024</p>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <p className="font-medium text-green-600">+$3,000.00</p>
              <button className="btn-secondary text-sm">Edit</button>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div className="flex-1">
              <div className="flex items-center space-x-3">
                <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                <div>
                  <p className="font-medium text-gray-900">Rent Payment</p>
                  <p className="text-sm text-gray-500">Expense • Monthly • Starting Jan 1, 2024</p>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <p className="font-medium text-red-600">-$1,200.00</p>
              <button className="btn-secondary text-sm">Edit</button>
            </div>
          </div>
        </div>
      </div>

      {/* Forecast Overrides */}
      <div className="card">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Forecast Overrides</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex-1">
              <div className="flex items-center space-x-3">
                <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                <div>
                  <p className="font-medium text-gray-900">Electric Bill - January</p>
                  <p className="text-sm text-gray-500">Override: $178.00 (was $150.00) • Jan 15, 2024</p>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <p className="font-medium text-red-600">-$178.00</p>
              <button className="btn-secondary text-sm">Edit</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Transactions
