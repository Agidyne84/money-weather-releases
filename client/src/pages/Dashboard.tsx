import React, { useState, useEffect } from 'react'
import { Account, BalanceForecast, Transaction, LowBalanceAnalysis } from '../types'
import { accountsApi, transactionsApi, categoriesApi, historyApi } from '../services/database'
import { isTransactionOnDate } from '../../../shared/recurrence'
import { createSafeDate, formatDateForDisplay, formatDateForStorage } from '../utils/dateUtils'
import { AnalyticsWidget, BalanceForecastChart, SpendingTrendChart } from '../components/analytics'

const Dashboard: React.FC = () => {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [transactions, setTransactions] = useState<any[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [history, setHistory] = useState<any[]>([])
  const [forecasts, setForecasts] = useState<BalanceForecast[]>([])
  const [loading, setLoading] = useState(true)

  // Chart controls
  const savedStart = localStorage.getItem('forecastStartDate') || formatDateForStorage(new Date())
  const [chartStartDate, setChartStartDate] = useState(savedStart)
  const [chartMonths, setChartMonths] = useState(3)
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])
  const [lowBalanceAnalysis, setLowBalanceAnalysis] = useState<LowBalanceAnalysis[]>([])

  // Account selection for bar chart
  const [barChartSelectedIds, setBarChartSelectedIds] = useState<string[]>([])

  // Category toggle for spending chart
  const [spendingCategoryMode, setSpendingCategoryMode] = useState<'parent' | 'child'>('parent')
  const [spendingExpanded, setSpendingExpanded] = useState(false)

  // Account selection for spending trend chart
  const [trendSelectedAccountIds, setTrendSelectedAccountIds] = useState<string[]>([])
  const [trendEndDate, setTrendEndDate] = useState(formatDateForStorage(new Date()))
  const [trendMonths, setTrendMonths] = useState(6)

  useEffect(() => {
    loadDashboardData()
  }, [])

  const loadDashboardData = async () => {
    try {
      const [accountsData, transactionsData, categoriesData, historyData] = await Promise.all([
        accountsApi.getAll(),
        transactionsApi.getAll(),
        categoriesApi.getAll(),
        historyApi.getAll({ limit: 1000, includeUnposted: false, includeExcluded: false })
      ])

      setAccounts(accountsData)
      setBarChartSelectedIds(accountsData.map((a: any) => a.id))
      setTrendSelectedAccountIds(accountsData.map((a: any) => a.id))
      setTransactions(transactionsData)
      setCategories(categoriesData)
      setHistory(historyData)

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
      const lowBalanceData = generateClientLowBalanceAnalysis(accountsData, forecastsData)
      setLowBalanceAnalysis(lowBalanceData)

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
    const lowBalanceData = generateClientLowBalanceAnalysis(accounts, forecastsData)
    setLowBalanceAnalysis(lowBalanceData)
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

  const generateClientLowBalanceAnalysis = (accounts: any[], forecasts: BalanceForecast[]): LowBalanceAnalysis[] => {
    const analyses: LowBalanceAnalysis[] = []

    accounts.forEach(account => {
      if (!account.includeInLowBalanceAnalysis) return

      const accountBalances = forecasts.map(forecast => ({
        date: forecast.date,
        balance: forecast.accountBalances.find(ab => ab.accountId === account.id)?.balance || 0
      }))

      const lowestBalances = [...accountBalances]
        .sort((a, b) => a.balance - b.balance)
        .slice(0, 5)

      const overallLowest = lowestBalances[0]

      analyses.push({
        accountId: account.id,
        accountName: account.name,
        alertType: 'lowest',
        lowestBalances: lowestBalances as any,
        overallLowest: overallLowest ? {
          date: overallLowest.date,
          balance: overallLowest.balance
        } as any : {
          date: new Date(),
          balance: 0
        } as any
      })

      if (overallLowest && overallLowest.balance < 0) {
        const firstNegative = accountBalances.find(b => b.balance < 0)
        if (firstNegative) {
          analyses.push({
            accountId: account.id,
            accountName: account.name,
            alertType: 'firstNegative',
            lowestBalances: lowestBalances as any,
            overallLowest: {
              date: firstNegative.date,
              balance: firstNegative.balance
            } as any
          })
        }
      }
    })

    return analyses.sort((a, b) => a.overallLowest.date.getTime() - b.overallLowest.date.getTime())
  }

  // Monthly amount calculation (mirrors Budget.tsx logic)
  const getTransactionMonthlyAmount = (transaction: Transaction): number => {
    const startDate = createSafeDate(transaction.startDate)
    const endDate = transaction.endDate ? createSafeDate(transaction.endDate) : null
    const yearLater = new Date(startDate)
    yearLater.setFullYear(yearLater.getFullYear() + 1)
    const windowEnd = endDate && endDate < yearLater ? endDate : yearLater
    let count = 0
    const d = new Date(startDate)
    while (d.getTime() <= windowEnd.getTime()) {
      if (isTransactionOnDate(transaction, d)) count++
      d.setDate(d.getDate() + 1)
    }
    if (endDate) {
      const activeMonths = Math.max(1,
        (windowEnd.getFullYear() - startDate.getFullYear()) * 12 +
        (windowEnd.getMonth() - startDate.getMonth()) +
        1
      )
      return (count * transaction.amount) / activeMonths
    }
    const unit = transaction.frequency?.unit?.toLowerCase() || 'months'
    if (unit === 'months') return transaction.amount
    if (unit === 'years') return transaction.amount / 12
    return (count * transaction.amount) / 12
  }

  // Analytics data processing
  const getSpendingByCategory = () => {
    const expenses = transactions.filter((t: any) => t.type === 'expense')
    if (expenses.length === 0) return []

    const totals = new Map<string, { label: string; value: number; color: string }>()

    expenses.forEach((t: any) => {
      const category = categories.find(c => c.id === t.categoryId)

      let key: string
      let label: string
      let color: string

      if (spendingCategoryMode === 'parent') {
        const parent = category?.parentId ? categories.find(c => c.id === category.parentId) : undefined
        if (parent) {
          key = parent.id
          label = parent.name
          color = parent.color || '#6B7280'
        } else if (category) {
          key = category.id
          label = category.name
          color = category.color || '#6B7280'
        } else {
          key = t.categoryId
          label = 'Uncategorized'
          color = '#6B7280'
        }
      } else {
        if (category) {
          key = category.id
          label = category.name
          color = category.color || '#6B7280'
        } else {
          key = t.categoryId
          label = 'Uncategorized'
          color = '#6B7280'
        }
      }

      const monthlyAmount = Math.abs(getTransactionMonthlyAmount(t as Transaction))
      const existing = totals.get(key)
      if (existing) {
        existing.value += monthlyAmount
      } else {
        totals.set(key, { label, value: monthlyAmount, color })
      }
    })

    return Array.from(totals.values())
  }

  const getDailySpending = (accountIds: string[], endDateStr: string, monthCount: number) => {
    const days = []
    const endDate = new Date(endDateStr)
    const startDate = new Date(endDate.getFullYear(), endDate.getMonth() - monthCount, endDate.getDate())

    const current = new Date(startDate)
    while (current <= endDate) {
      const dateStr = current.toISOString().split('T')[0]

      const dayHistory = history.filter(h => {
        const hDate = new Date(h.date)
        return hDate.toISOString().split('T')[0] === dateStr &&
               (h.type === 'expense' || h.type === 'administrative') &&
               accountIds.includes(h.accountId) &&
               !h.isExcluded
      })

      const dayTotal = dayHistory.reduce((sum, h) => sum + Math.abs(h.amount), 0)

      days.push({
        label: current.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        value: dayTotal,
        date: new Date(current)
      })

      current.setDate(current.getDate() + 1)
    }

    return days
  }

  const maxHistoryDate = history.length > 0
    ? formatDateForStorage(new Date(Math.max(...history.map(h => new Date(h.date).getTime()))))
    : formatDateForStorage(new Date())

  const accountTypeColors: Record<string, string> = {
    checking: '#3B82F6',
    savings: '#10B981',
    credit: '#F59E0B',
    investment: '#8B5CF6'
  }

  const getAccountBalances = () => {
    return accounts.map(account => ({
      label: account.name,
      value: account.currentBalance,
      color: accountTypeColors[account.type] || '#6B7280'
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600">Overview of your financial forecast and account balances</p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Total Balance</h3>
          <p className="text-3xl font-bold text-blue-600">${totalBalance.toFixed(2)}</p>
          <p className="text-sm text-gray-500 mt-1">Across all accounts</p>
        </div>

        <div className="card">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Lowest Balance</h3>
          {(() => {
            const monitored = accounts.filter(a => a.includeInLowBalanceAnalysis)
            if (monitored.length === 0) {
              return <p className="text-sm text-gray-500 mt-1">No accounts monitored for low balance</p>
            }
            let minTotal = Infinity
            let minDate = new Date()
            forecasts.forEach(f => {
              const dailyTotal = monitored.reduce((sum, acc) => {
                const ab = f.accountBalances.find(b => b.accountId === acc.id)
                return sum + (ab?.balance || 0)
              }, 0)
              if (dailyTotal < minTotal) {
                minTotal = dailyTotal
                minDate = f.date
              }
            })
            if (minTotal === Infinity) {
              minTotal = monitored.reduce((sum, a) => sum + a.currentBalance, 0)
              minDate = new Date()
            }
            return (
              <>
                <p className={`text-3xl font-bold ${minTotal >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                  ${minTotal.toFixed(2)}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  {monitored.length} monitored account{monitored.length === 1 ? '' : 's'} &middot; {minDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </>
            )
          })()}
        </div>
      </div>

      {/* Analytics Widgets */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium text-gray-900">Spending by Category</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSpendingExpanded(v => !v)}
                className="px-3 py-1 text-xs rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
              >
                {spendingExpanded ? 'Hide Details' : 'Show Details'}
              </button>
              <div className="flex bg-gray-100 rounded-lg p-0.5">
                <button
                  onClick={() => setSpendingCategoryMode('parent')}
                  className={`px-3 py-1 text-xs rounded-md transition-colors ${
                    spendingCategoryMode === 'parent'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Parent
                </button>
                <button
                  onClick={() => setSpendingCategoryMode('child')}
                  className={`px-3 py-1 text-xs rounded-md transition-colors ${
                    spendingCategoryMode === 'child'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Child
                </button>
              </div>
            </div>
          </div>
          <AnalyticsWidget
            title=""
            type="pie"
            data={getSpendingByCategory()}
            showLegend={spendingExpanded}
          />
        </div>
        <div className="card">
          <AnalyticsWidget
            title="Account Balances"
            type="bar"
            data={getAccountBalances().filter(d => barChartSelectedIds.length === 0 || barChartSelectedIds.includes(accounts.find(a => a.name === d.label)?.id || ''))}
          />
          <div className="mt-4 pt-3 border-t border-gray-200">
            <label className="flex items-center gap-2 cursor-pointer select-none mb-2">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                checked={barChartSelectedIds.length === accounts.length && accounts.length > 0}
                onChange={e => {
                  if (e.target.checked) {
                    setBarChartSelectedIds(accounts.map(a => a.id))
                  } else {
                    setBarChartSelectedIds([])
                  }
                }}
              />
              <span className="text-sm font-medium text-gray-700">Select All</span>
            </label>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {accounts.map(a => (
                <label key={a.id} className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    checked={barChartSelectedIds.includes(a.id)}
                    onChange={e => {
                      if (e.target.checked) {
                        setBarChartSelectedIds(prev => [...prev, a.id])
                      } else {
                        setBarChartSelectedIds(prev => prev.filter(id => id !== a.id))
                      }
                    }}
                  />
                  <span className="text-xs text-gray-700">{a.name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Low Balance Alerts */}
      <div className="card">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Low Balance Alerts</h3>
        <div className="space-y-3">
          {lowBalanceAnalysis.length > 0 ? (
            lowBalanceAnalysis.map(analysis => {
              const lowest = analysis.overallLowest
              const isNegative = lowest.balance < 0
              const isFirstNegative = analysis.alertType === 'firstNegative'

              return (
                <div
                  key={`${analysis.accountId}-${analysis.alertType}`}
                  className={`flex items-center justify-between p-4 border rounded-lg ${
                    isNegative ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    {isNegative && <div className="w-3 h-3 rounded-full bg-red-500"></div>}
                    <div>
                      <p className={`font-medium ${
                        isNegative ? 'text-red-900' : 'text-gray-900'
                      }`}>
                        {analysis.accountName}
                        {isNegative && (
                          <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                            {isFirstNegative ? 'First Negative' : 'Critical'}
                          </span>
                        )}
                      </p>
                      <p className={`text-sm ${
                        isNegative ? 'text-red-700' : 'text-gray-600'
                      }`}>
                        {isFirstNegative
                          ? `Balance goes negative on ${formatDateForDisplay(lowest.date)}`
                          : `Balance drops to ${lowest.balance.toFixed(2)} on ${formatDateForDisplay(lowest.date)}`}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`font-medium ${
                      isNegative ? 'text-red-600' : 'text-gray-900'
                    }`}>
                      ${lowest.balance.toFixed(2)}
                    </p>
                  </div>
                </div>
              )
            })
          ) : (
            <div className="text-center py-8 text-gray-500">
              <p>No low balance alerts</p>
              <p className="text-sm mt-1">All accounts maintain healthy balances</p>
            </div>
          )}
        </div>
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

      {/* Historical Spending Trend */}
      <div className="card lg:col-span-2">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
          <h3 className="text-lg font-medium text-gray-900">Historical Spending Trend</h3>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="date"
              className="input text-xs"
              value={trendEndDate}
              max={maxHistoryDate}
              onChange={e => setTrendEndDate(e.target.value)}
            />
            <select
              className="input text-xs"
              value={trendMonths}
              onChange={e => setTrendMonths(Number(e.target.value))}
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
            const allSelected = typeIds.length > 0 && typeIds.every(id => trendSelectedAccountIds.includes(id))
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
                    setTrendSelectedAccountIds(trendSelectedAccountIds.filter(id => !typeIds.includes(id)))
                  } else {
                    const merged = Array.from(new Set([...trendSelectedAccountIds, ...typeIds]))
                    setTrendSelectedAccountIds(merged)
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
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              checked={trendSelectedAccountIds.length === accounts.length && accounts.length > 0}
              onChange={e => {
                if (e.target.checked) {
                  setTrendSelectedAccountIds(accounts.map(a => a.id))
                } else {
                  setTrendSelectedAccountIds([])
                }
              }}
            />
            <span className="text-sm font-medium text-gray-700">Select All</span>
          </label>
          {accounts.map(a => (
            <label key={a.id} className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                checked={trendSelectedAccountIds.includes(a.id)}
                onChange={e => {
                  if (e.target.checked) {
                    setTrendSelectedAccountIds(prev => [...prev, a.id])
                  } else {
                    setTrendSelectedAccountIds(prev => prev.filter(id => id !== a.id))
                  }
                }}
              />
              <span className="text-xs text-gray-700">{a.name}</span>
            </label>
          ))}
        </div>

        <SpendingTrendChart data={getDailySpending(trendSelectedAccountIds, trendEndDate, trendMonths)} height={320} />
      </div>

    </div>
  )
}

export default Dashboard
