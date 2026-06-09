import { Account, Category, Transaction, BalanceForecast, ForecastTransaction, LowBalanceAnalysis } from '../types'
import { formatDateForStorage } from './dateUtils'
import { isTransactionOnDate } from '../../../shared/recurrence'

/**
 * Generate daily balance forecasts for all accounts over a date range.
 */
export function generateBalanceForecast(
  accounts: Account[],
  transactions: Transaction[],
  startDate: Date,
  endDate: Date,
  postedKeys?: Set<string>,
  historyOverrides?: any[]
): BalanceForecast[] {
  const forecasts: BalanceForecast[] = []
  const currentDate = new Date(startDate)

  // Initialize account balances from current balances
  const accountBalances: { [key: string]: number } = {}
  accounts.forEach(account => {
    accountBalances[account.id] = account.currentBalance || 0
  })

  // Generate daily forecasts across the full window
  while (currentDate <= endDate) {
    // Calculate daily balance changes
    const dailyTransactions = transactions.filter(t => {
      if (!isTransactionOnDate(t, currentDate)) return false
      if (postedKeys && t.id) {
        const key = `${t.id}|${formatDateForStorage(currentDate)}`
        return !postedKeys.has(key)
      }
      return true
    })

    // Update account balances
    dailyTransactions.forEach(tx => {
      // Check for a manual-edit override on this occurrence
      const dateKey = formatDateForStorage(currentDate)
      const override = historyOverrides?.find(
        h => h.transactionId === tx.id && formatDateForStorage(h.date) === dateKey && h.isManualEdit
      )
      const amount = override ? override.amount : tx.amount
      const destAccountId = override ? override.accountId : tx.accountId
      const destTransferTo = override ? override.transferToAccountId : tx.transferToAccountId
      const destIsTransfer = override ? override.isTransfer : tx.isTransfer

      accountBalances[destAccountId] = (accountBalances[destAccountId] || 0) + amount
      if (destIsTransfer && destTransferTo) {
        accountBalances[destTransferTo] = (accountBalances[destTransferTo] || 0) - amount
      }
    })

    // Apply unposted manual history entries for this date
    if (historyOverrides) {
      const dateKey = formatDateForStorage(currentDate)
      historyOverrides.forEach(h => {
        if (!h.transactionId && h.isPosted === false && formatDateForStorage(h.date) === dateKey) {
          accountBalances[h.accountId] = (accountBalances[h.accountId] || 0) + h.amount
          if (h.isTransfer && h.transferToAccountId) {
            accountBalances[h.transferToAccountId] = (accountBalances[h.transferToAccountId] || 0) - h.amount
          }
        }
      })
    }

    // Create forecast entry
    const forecast: BalanceForecast = {
      date: new Date(currentDate),
      accountBalances: accounts.map(account => ({
        accountId: account.id,
        accountName: account.name,
        balance: accountBalances[account.id] || 0,
        change: 0,
      })),
      totalBalance: Object.values(accountBalances).reduce((sum, balance) => sum + balance, 0),
      netWorth: Object.values(accountBalances).reduce((sum, balance) => sum + balance, 0),
      lowestBalanceAccounts: [],
    }

    forecasts.push(forecast)
    currentDate.setDate(currentDate.getDate() + 1)
  }

  return forecasts
}

/**
 * Generate all forecast transaction occurrences within a date range.
 */
export function generateForecastTransactions(
  transactions: Transaction[],
  categories: Category[],
  accounts: Account[],
  startDate: Date,
  endDate: Date,
  historyOverrides: any[] = []
): ForecastTransaction[] {
  const forecastTransactions: ForecastTransaction[] = []
  // Initialize currentDate at noon to avoid timezone issues
  const currentDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 12, 0, 0)

  // Build lookup for manual edit overrides keyed by "transactionId|YYYY-MM-DD"
  const overrideMap = new Map<string, any>()
  historyOverrides.forEach(h => {
    if (h.transactionId && h.isManualEdit) {
      const key = `${h.transactionId}|${formatDateForStorage(h.date)}`
      overrideMap.set(key, h)
    }
  })

  // Generate transactions for the entire forecast period
  while (currentDate <= endDate) {
    transactions.forEach(tx => {
      if (isTransactionOnDate(tx, currentDate)) {
        const category = categories.find(c => c.id === tx.categoryId)
        const account = accounts.find(a => a.id === tx.accountId)
        const dateKey = formatDateForStorage(currentDate)
        const overrideKey = `${tx.id}|${dateKey}`
        const override = overrideMap.get(overrideKey)

        const forecastTx: ForecastTransaction = {
          id: `forecast_${tx.id}_${currentDate.getTime()}`,
          transactionId: tx.id,
          date: new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), 12, 0, 0),
          description: override ? override.description : tx.name,
          amount: override ? override.amount : tx.amount,
          type: override ? override.type : tx.type,
          categoryId: override ? override.categoryId : tx.categoryId,
          categoryName: override
            ? (categories.find(c => c.id === override.categoryId)?.name || 'Uncategorized')
            : (category?.name || 'Uncategorized'),
          categoryColor: override
            ? (categories.find(c => c.id === override.categoryId)?.color || '#6B7280')
            : (category?.color || '#6B7280'),
          accountId: override ? override.accountId : tx.accountId,
          accountName: override
            ? (accounts.find(a => a.id === override.accountId)?.name || 'Unknown Account')
            : (account?.name || 'Unknown Account'),
          isTransfer: tx.isTransfer || false,
          transferToAccountId: tx.transferToAccountId,
          isOverride: false,
          isPosted: currentDate < new Date(),
          isEdited: !!override,
          originalAmount: tx.amount,
        }

        forecastTransactions.push(forecastTx)
      }
    })

    currentDate.setDate(currentDate.getDate() + 1)
    // Reset time to noon after increment to avoid timezone drift
    currentDate.setHours(12, 0, 0, 0)
  }

  // Include standalone history entries (manual entries with no transactionId
  // that are not yet posted) so they appear in the forecast alongside
  // recurring transactions.
  historyOverrides.forEach(h => {
    if (!h.transactionId && h.isPosted === false && h.date >= startDate && h.date <= endDate) {
      const category = categories.find(c => c.id === h.categoryId)
      const account = accounts.find(a => a.id === h.accountId)
      const hDate = new Date(h.date.getFullYear(), h.date.getMonth(), h.date.getDate(), 12, 0, 0)
      const manualTx: ForecastTransaction = {
        id: `manual_${h.id}`,
        transactionId: '',
        date: hDate,
        description: h.description,
        amount: h.amount,
        type: h.type,
        categoryId: h.categoryId,
        categoryName: category?.name || 'Uncategorized',
        categoryColor: category?.color || '#6B7280',
        accountId: h.accountId,
        accountName: account?.name || 'Unknown Account',
        isTransfer: h.isTransfer || false,
        transferToAccountId: h.transferToAccountId,
        isOverride: true,
        isPosted: h.isPosted ?? true,
        isEdited: false,
        originalAmount: h.amount,
      }
      forecastTransactions.push(manualTx)
    }
  })

  return forecastTransactions.sort((a, b) => {
    const dateDiff = a.date.getTime() - b.date.getTime()
    if (dateDiff !== 0) return dateDiff
    const typeOrder: Record<string, number> = { income: 0, expense: 1, administrative: 2 }
    return typeOrder[a.type] - typeOrder[b.type]
  })
}

/**
 * Generate low balance analysis from forecast data.
 */
export function generateLowBalanceAnalysis(
  accounts: Account[],
  forecasts: BalanceForecast[]
): LowBalanceAnalysis[] {
  const analyses: LowBalanceAnalysis[] = []

  accounts.forEach(account => {
    if (!account.includeInLowBalanceAnalysis) return

    // Extract this account's balance from each forecast day
    const accountBalances = forecasts.map(forecast => ({
      date: forecast.date,
      balance: forecast.accountBalances.find(ab => ab.accountId === account.id)?.balance || 0,
    }))

    const lowestBalances = [...accountBalances]
      .sort((a, b) => a.balance - b.balance)
      .slice(0, 5)
      .map((item, index) => ({ ...item, rank: index + 1 }))

    const overallLowest = lowestBalances[0]

    // Always add the lowest-balance alert
    analyses.push({
      accountId: account.id,
      accountName: account.name,
      alertType: 'lowest',
      lowestBalances,
      overallLowest: overallLowest ? {
        date: overallLowest.date,
        balance: overallLowest.balance,
      } : {
        date: new Date(),
        balance: 0,
      },
    })

    // If the account ever goes negative, also add a "first negative" alert
    if (overallLowest && overallLowest.balance < 0) {
      const firstNegative = accountBalances.find(b => b.balance < 0)
      if (firstNegative) {
        analyses.push({
          accountId: account.id,
          accountName: account.name,
          alertType: 'firstNegative',
          lowestBalances,
          overallLowest: {
            date: firstNegative.date,
            balance: firstNegative.balance,
          },
        })
      }
    }
  })

  return analyses.sort((a, b) => a.overallLowest.date.getTime() - b.overallLowest.date.getTime())
}
