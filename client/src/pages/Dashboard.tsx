import React, { useState, useEffect } from 'react'
import { Account, BalanceForecast } from '../types'
import { accountsApi, transactionsApi, categoriesApi } from '../services/api'
import { isTransactionOnDate } from '../../../shared/recurrence'
import { createSafeDate, formatDateForStorage } from '../utils/dateUtils'
import BalanceAdjustment from '../components/BalanceAdjustment'
import { AnalyticsWidget, BalanceForecastChart } from '../components/analytics'

const Dashboard: React.FC = () => {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [transactions, setTransactions] = useState<any[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [forecasts, setForecasts] = useState<BalanceForecast[]>([])
  const [loading, setLoading] = useState(true)

  // Chart controls
  const savedStart = localStorage.getItem('forecastStartDate') || formatDateForStorage(new Date())
  const [chartStartDate, setChartStartDate] = useState(savedStart)
  const [chartMonths, setChartMonths] = useState(3)
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])

  useEffect(() => {
    loadDashboardData()
  }, [])

  const loadDashboardData = async () => {
    try {
      const [accountsData, transactionsData, categoriesData] = await Promise.all([
        accountsApi.getAll(),
        transactionsApi.getAll(),
        categoriesApi.getAll()
      ])

      setAccounts(accountsData)
      setTransactions(transactionsData)
      setCategories(categoriesData)

      // Default chart selection to checking accounts
      const checkingIds = accountsData
        .filter((a: any) => a.type === 'checking')
        .map((a: any) => a.id)
      setSelectedAccountIds(checkingIds)

      // Generate forecast aligned to stored start date
      const startDate = createSafeDate(savedStart)
      const endDate = createSafeDate(savedStart)
      endDate.setMonth(endDate.getMonth() + chartMonths)

      const forecastsData = generateClientBalanceForecast(accountsData, transactionsData, startDate, endDate)
      setForecasts(forecastsData)

    } catch (error) {
      console.error('Error loading dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  const regenerateForecasts = () => {
    const startDate = createSafeDate(chartStartDate)
    const endDate = createSafeDate(chartStartDate)
    endDate.setMonth(endDate.getMonth() + chartMonths)
    const forecastsData = generateClientBalanceForecast(accounts, transactions, startDate, endDate)
    setForecasts(forecastsData)
  }

  // Regenerate when chart controls change
  useEffect(() => {
    if (accounts.length && transactions.length) regenerateForecasts()
  }, [chartStartDate, chartMonths])

  // Client-side forecast generation functions
  const generateClientBalanceForecast = (accounts: any[], transactions: any[], startDate: Date, endDate: Date): BalanceForecast[] => {
    const forecasts: BalanceForecast[] = []
    const currentDate = new Date(startDate)
    
    // Initialize account balances from current balances
    const accountBalances: { [key: string]: number } = {}
    accounts.forEach(account => {
      accountBalances[account.id] = account.currentBalance || 0
    })
    
    // Generate daily forecasts
    while (currentDate <= endDate) {
      // Calculate daily balance changes using the shared recurrence engine
      const dailyTransactions = transactions.filter(t =>
        isTransactionOnDate(t, currentDate)
      )
      
      // Update account balances
      dailyTransactions.forEach(tx => {
        accountBalances[tx.accountId] = (accountBalances[tx.accountId] || 0) + tx.amount
      })
      
      // Create forecast entry
      const totalBalance = Object.values(accountBalances).reduce((sum, balance) => sum + balance, 0)
      const forecast: BalanceForecast = {
        date: new Date(currentDate),
        totalBalance,
        netWorth: totalBalance,
        lowestBalanceAccounts: [],
        accountBalances: accounts.map(account => ({
          accountId: account.id,
          accountName: account.name,
          balance: accountBalances[account.id] || 0,
          change: 0 // Simplified - would calculate actual change from previous day
        }))
      }
      
      forecasts.push(forecast)
      currentDate.setDate(currentDate.getDate() + 1)
    }
    
    return forecasts
  }

  // Analytics data processing
  const getSpendingByCategory = () => {
    const expenses = transactions.filter(t => t.type === 'expense')
    const categoryTotals = expenses.reduce((acc, transaction) => {
      const categoryId = transaction.categoryId
      if (!acc[categoryId]) {
        const category = categories.find(c => c.id === categoryId)
        acc[categoryId] = {
          label: category?.name || 'Uncategorized',
          value: 0,
          color: category?.color || '#6B7280'
        }
      }
      acc[categoryId].value += Math.abs(transaction.amount)
      return acc
    }, {} as Record<string, any>)

    return Object.values(categoryTotals)
  }

  const getMonthlySpending = () => {
    const last6Months = []
    const now = new Date()
    
    for (let i = 5; i >= 0; i--) {
      const month = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const monthName = month.toLocaleDateString('en-US', { month: 'short' })
      
      const monthTransactions = transactions.filter(t => {
        const txDate = new Date(t.startDate)
        return txDate.getMonth() === month.getMonth() && 
               txDate.getFullYear() === month.getFullYear() &&
               t.type === 'expense'
      })
      
      const monthTotal = monthTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0)
      
      last6Months.push({
        label: monthName,
        value: monthTotal
      })
    }
    
    return last6Months
  }

  const getAccountBalances = () => {
    return accounts.map(account => ({
      label: account.name,
      value: account.currentBalance,
      color: '#3B82F6'
    }))
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-500">Loading dashboard...</div>
      </div>
    )
  }

  const totalBalance = accounts.reduce((sum, account) => sum + account.currentBalance, 0)
  const lowestBalance = accounts.length > 0 ? Math.min(...accounts.map(a => a.currentBalance)) : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600">Overview of your financial forecast and account balances</p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Total Balance</h3>
          <p className="text-3xl font-bold text-blue-600">${totalBalance.toFixed(2)}</p>
          <p className="text-sm text-gray-500 mt-1">Across all accounts</p>
        </div>
        
        <div className="card">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Net Worth</h3>
          <p className="text-3xl font-bold text-green-600">${totalBalance.toFixed(2)}</p>
          <p className="text-sm text-gray-500 mt-1">Assets minus liabilities</p>
        </div>
        
        <div className="card">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Lowest Balance</h3>
          <p className={`text-3xl font-bold ${lowestBalance >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
            ${lowestBalance.toFixed(2)}
          </p>
          <p className="text-sm text-gray-500 mt-1">Current lowest balance</p>
        </div>
      </div>

      {/* Account Overview */}
      <div className="card">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-gray-900">Account Overview</h3>
          <BalanceAdjustment onAdjustmentComplete={loadDashboardData} />
        </div>
        <div className="space-y-3">
          {accounts.map(account => (
            <div key={account.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div>
                <p className="font-medium text-gray-900">{account.name}</p>
                <p className="text-sm text-gray-500">{account.type}</p>
              </div>
              <p className={`font-medium ${account.currentBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                ${account.currentBalance.toFixed(2)}
              </p>
            </div>
          ))}
          {accounts.length === 0 && (
            <p className="text-gray-500 text-center py-4">No accounts found. Create your first account to get started.</p>
          )}
        </div>
      </div>

      {/* Analytics Widgets */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AnalyticsWidget
          title="Spending by Category"
          type="pie"
          data={getSpendingByCategory()}
        />
        <AnalyticsWidget
          title="Account Balances"
          type="bar"
          data={getAccountBalances()}
        />
      </div>

      {/* Balance Forecast Chart */}
      <div className="card">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
          <h3 className="text-lg font-medium text-gray-900">Balance Forecast Chart</h3>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="date"
              className="input text-xs"
              value={chartStartDate}
              min={savedStart}
              onChange={e => setChartStartDate(e.target.value)}
            />
            <select
              className="input text-xs"
              value={chartMonths}
              onChange={e => setChartMonths(Number(e.target.value))}
            >
              {[1,2,3,6,12,18,24,36,48,60].map(m => (
                <option key={m} value={m}>{m} month{m === 1 ? '' : 's'}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Account presets */}
        <div className="flex flex-wrap gap-2 mb-3">
          {(['checking', 'savings', 'credit'] as const).map(type => {
            const typeIds = accounts.filter(a => a.type === type).map(a => a.id)
            const allSelected = typeIds.length > 0 && typeIds.every(id => selectedAccountIds.includes(id))
            return (
              <button
                key={type}
                type="button"
                className={`px-2 py-1 text-xs rounded border ${
                  allSelected
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
                onClick={() => {
                  if (allSelected) {
                    setSelectedAccountIds(selectedAccountIds.filter(id => !typeIds.includes(id)))
                  } else {
                    const merged = Array.from(new Set([...selectedAccountIds, ...typeIds]))
                    setSelectedAccountIds(merged)
                  }
                }}
              >
                All {type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            )
          })}
        </div>

        {/* Per-account checkboxes */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-4">
          {accounts.map(a => (
            <label key={a.id} className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                checked={selectedAccountIds.includes(a.id)}
                onChange={e => {
                  if (e.target.checked) {
                    setSelectedAccountIds([...selectedAccountIds, a.id])
                  } else {
                    setSelectedAccountIds(selectedAccountIds.filter(id => id !== a.id))
                  }
                }}
              />
              <span className="text-xs text-gray-700">{a.name}</span>
            </label>
          ))}
        </div>

        <BalanceForecastChart
          data={forecasts}
          accounts={accounts}
          selectedAccountIds={selectedAccountIds}
          height={320}
        />
      </div>

      <AnalyticsWidget
        title="Monthly Spending Trend"
        type="line"
        data={getMonthlySpending()}
        className="lg:col-span-2"
      />

      {/* Low Balance Alerts */}
      <div className="card">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Low Balance Alerts</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-lg">
            <div>
              <p className="font-medium text-red-900">Checking Account</p>
              <p className="text-sm text-red-700">Lowest balance: $0.00 on Jan 15, 2024</p>
            </div>
            <span className="px-2 py-1 text-xs font-medium text-red-800 bg-red-100 rounded">
              Alert
            </span>
          </div>
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="card">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Recent Transactions</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between py-2 border-b border-gray-100">
            <div className="flex items-center space-x-3">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <div>
                <p className="font-medium text-gray-900">Sample Income</p>
                <p className="text-sm text-gray-500">Jan 1, 2024</p>
              </div>
            </div>
            <p className="font-medium text-green-600">+$1,000.00</p>
          </div>
          
          <div className="flex items-center justify-between py-2 border-b border-gray-100">
            <div className="flex items-center space-x-3">
              <div className="w-2 h-2 bg-red-500 rounded-full"></div>
              <div>
                <p className="font-medium text-gray-900">Sample Expense</p>
                <p className="text-sm text-gray-500">Jan 2, 2024</p>
              </div>
            </div>
            <p className="font-medium text-red-600">-$250.00</p>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="card">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Quick Actions</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <button className="btn-primary">
            Add Transaction
          </button>
          <button className="btn-secondary">
            Edit Budget
          </button>
          <button className="btn-secondary">
            Import Bank Data
          </button>
          <button className="btn-secondary">
            Export Data
          </button>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
