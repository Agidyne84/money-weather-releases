import React, { useState, useEffect } from 'react'
import { Account, ForecastTransaction, BalanceForecast, LowBalanceAnalysis, Category } from '../types'
import { accountsApi, transactionsApi, categoriesApi, historyApi } from '../services/api'
import { createSafeDate, formatDateForDisplay, formatDateForInput, formatDateForStorage } from '../utils/dateUtils'
import { isTransactionOnDate as sharedIsTransactionOnDate } from '../../../shared/recurrence'
import CategorySelector from '../components/CategorySelector'

const Forecast: React.FC = () => {
  const [forecasts, setForecasts] = useState<BalanceForecast[]>([])
  const [transactions, setTransactions] = useState<ForecastTransaction[]>([])
  const [lowBalanceAnalysis, setLowBalanceAnalysis] = useState<LowBalanceAnalysis[]>([])
  const [loading, setLoading] = useState(true)
  // Edit state supports multiple rows at once (driven by the selection
  // checkboxes + a single "Edit Selected" button). Each edited forecast row
  // keeps its own form buffer keyed by the forecast row id.
  type EditBuffer = {
    description: string
    amount: string
    date: string
    accountId: string
    startDate: string
    frequencyValue: string
    frequencyUnit: string
    customPattern: string
  }
  const [editingTransactions, setEditingTransactions] = useState<Set<string>>(new Set())
  const [editForms, setEditForms] = useState<Record<string, EditBuffer>>({})
  const [originalTransactions, setOriginalTransactions] = useState<any[]>([]) // Store original transactions for editing
  const [historyData, setHistoryData] = useState<any[]>([]) // Store history data for override lookup
  
  // State for adding manual one-time transaction
  const [isAddingManual, setIsAddingManual] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [manualForm, setManualForm] = useState({
    description: '',
    amount: '',
    date: formatDateForStorage(new Date()),
    accountId: '',
    categoryId: '',
    type: 'expense' as 'income' | 'expense' | 'administrative',
    isTransfer: false,
    transferToAccountId: '',
  })
  
  // Load saved start date from localStorage, or default to today's date
  const getSavedStartDate = () => {
    const saved = localStorage.getItem('forecastStartDate')
    if (saved) {
      return saved
    }
    return formatDateForStorage(new Date())
  }
  
  const [startDate, setStartDate] = useState(getSavedStartDate())
  
  // Save start date to localStorage whenever it changes.
  // When the date moves forward, auto-accept forecast occurrences that now
  // fall before the new start date.  When it moves backward, auto-return
  // history entries that now fall on or after the new start date.
  // Manual edits are preserved via the isManualEdit flag on history rows.
  const handleStartDateChange = async (newDate: string) => {
    const oldStart = createSafeDate(startDate)
    const newStart = createSafeDate(newDate)
    if (formatDateForStorage(oldStart) === formatDateForStorage(newStart)) return

    try {
      if (newStart > oldStart) {
        // Advancing — accept all forecast occurrences before the new start date
        const toAccept = transactions.filter(t => t.date < newStart)
        for (const ftx of toAccept) {
          if (ftx.transactionId) {
            // If an unposted history row already exists (e.g. from a prior
            // return-to-forecast round-trip with a manual edit), update it
            // rather than creating a duplicate.
            const existing = historyData.find(
              h => h.transactionId === ftx.transactionId &&
                formatDateForStorage(h.date) === formatDateForStorage(ftx.date)
            )
            if (existing) {
              await historyApi.update(existing.id, { isPosted: true })
            } else {
              await historyApi.create({
                transactionId: ftx.transactionId,
                accountId: ftx.accountId,
                categoryId: ftx.categoryId,
                date: formatDateForStorage(ftx.date),
                description: ftx.description,
                amount: ftx.amount,
                type: ftx.type,
                isManualEdit: ftx.isEdited ? true : undefined,
              })
            }
          } else {
            // Manual entry — flip the existing history row to posted
            const historyId = ftx.id.replace(/^manual_/, '')
            await historyApi.update(historyId, { isPosted: true })
          }
        }
      } else if (newStart < oldStart) {
        // Retreating — return all posted history entries on or after new start
        const toReturn = historyData.filter(h => h.isPosted !== false && h.date >= newStart)
        for (const h of toReturn) {
          if (!h.transactionId) {
            // Manual entry — flip to unposted so it reappears in forecast
            await historyApi.update(h.id, { isPosted: false })
          } else if (h.isManualEdit) {
            // Recurring occurrence with manual edits — unpost instead of deleting
            // so the override values survive the round-trip back to Forecast.
            await historyApi.update(h.id, { isPosted: false })
          } else {
            // Recurring occurrence without edits — delete so it reappears in forecast
            await historyApi.delete(h.id)
          }
        }
      }
    } catch (error: any) {
      console.error('Error moving transactions on start-date change:', error)
      alert(
        `Failed to adjust forecast window: ${error?.response?.data?.error || error?.message || 'unknown error'}\n\n` +
        `The start date was not updated.`
      )
      return // keep the old start date in state and localStorage
    }

    setStartDate(newDate)
    localStorage.setItem('forecastStartDate', newDate)
    setSelectedTransactions([])
  }
  const [forecastMonths, setForecastMonths] = useState(60)

  const loadForecastData = async ({ silent = false }: { silent?: boolean } = {}) => {
    try {
      // `silent` refreshes skip the full-page loading placeholder so the
      // table stays mounted — which in turn preserves the user's scroll
      // position after an inline Save.
      if (!silent) setLoading(true)
      // Calculate end date from start date + months
      const endDate = createSafeDate(startDate)
      endDate.setMonth(endDate.getMonth() + forecastMonths)
      
      // Load data from APIs
      const endYmd = formatDateForStorage(endDate)
      const [accountsData, categoriesData, transactionsData, historyData] = await Promise.all([
        accountsApi.getAll(),
        categoriesApi.getAll(),
        transactionsApi.getAll(1000, 0), // Load all transactions for editing
        // Pull history rows anchored to any of our transactions so we can
        // hide forecast occurrences that have already been posted.
        historyApi.getAll({ endDate: endYmd, limit: 1000, includeUnposted: true }),
      ])
      
      // Store data for editing and manual transaction form
      setOriginalTransactions(transactionsData)
      setAccounts(accountsData)
      setCategories(categoriesData)
      setHistoryData(historyData)

      // Build a set of "(transactionId|YYYY-MM-DD)" keys for posted occurrences
      // so we can filter the forecast list. Manual history rows with no
      // transaction_id don't suppress any forecast row.
      // Only filter out non-manual-edit history rows (accepted/suppressed).
      // Manual edit overrides (isManualEdit=true) are kept in the forecast
      // but with override values applied by the generator.
      const postedKeys = new Set<string>(
        historyData
          .filter(h => !!h.transactionId && !h.isManualEdit)
          .map(h => `${h.transactionId}|${formatDateForStorage(h.date)}`)
      )

      // Generate forecast data on client side
      const forecastsData = generateClientBalanceForecast(accountsData, transactionsData, createSafeDate(startDate), endDate)
      // Pass history data so manual edit overrides are applied to forecast rows
      const rawForecastTxns = generateClientForecastTransactions(
        transactionsData, categoriesData, accountsData, createSafeDate(startDate), endDate, historyData
      )
      const transactionsForecastData = rawForecastTxns.filter(ftx => {
        const key = `${ftx.transactionId}|${formatDateForStorage(ftx.date)}`
        return !postedKeys.has(key)
      })
      const lowBalanceData = generateClientLowBalanceAnalysis(accountsData, transactionsData, createSafeDate(startDate), endDate)
      
      setForecasts(forecastsData)
      setTransactions(transactionsForecastData)
      setLowBalanceAnalysis(lowBalanceData)
      
      console.log('DEBUG - Generated Data:', { 
        forecastsCount: forecastsData.length, 
        transactionsCount: transactionsForecastData.length, 
        lowBalanceCount: lowBalanceData.length 
      })
      
      // Debug: Log first transaction structure
      if (transactionsData.length > 0) {
        console.log('DEBUG - First transaction structure:', transactionsData[0])
        console.log('DEBUG - Available fields:', Object.keys(transactionsData[0]))
      }
      
    } catch (error) {
      console.error('Error loading forecast data:', error)
    } finally {
      setLoading(false)
    }
  }

  // Client-side forecast generation functions
  const generateClientBalanceForecast = (accounts: any[], transactions: any[], startDate: Date, endDate: Date): BalanceForecast[] => {
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
        const txDate = new Date(t.startDate)
        return isTransactionOnDate(t, txDate, currentDate)
      })
      
      // Update account balances
      dailyTransactions.forEach(tx => {
        accountBalances[tx.accountId] = (accountBalances[tx.accountId] || 0) + tx.amount
      })
      
      // Create forecast entry
      const forecast: BalanceForecast = {
        date: new Date(currentDate),
        accountBalances: accounts.map(account => ({
          accountId: account.id,
          accountName: account.name,
          balance: accountBalances[account.id] || 0,
          change: 0 // Simplified
        })),
        totalBalance: Object.values(accountBalances).reduce((sum, balance) => sum + balance, 0),
        netWorth: Object.values(accountBalances).reduce((sum, balance) => sum + balance, 0),
        lowestBalanceAccounts: []
      }
      
      forecasts.push(forecast)
      currentDate.setDate(currentDate.getDate() + 1)
    }
    
    return forecasts
  }

  const generateClientForecastTransactions = (
    transactions: any[], 
    categories: any[], 
    accounts: any[], 
    startDate: Date, 
    endDate: Date,
    historyOverrides: any[] = []
  ): ForecastTransaction[] => {
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
        // Ensure startDate is properly parsed as a Date object
        let transactionDate: Date
        if (tx.startDate instanceof Date) {
          transactionDate = tx.startDate
        } else {
          // Parse the date string and ensure it's treated as midnight local time
          const dateStr = tx.startDate
          const [year, month, day] = dateStr.split('-').map(Number)
          transactionDate = new Date(year, month - 1, day) // month is 0-indexed
        }
        
        if (isTransactionOnDate(tx, transactionDate, currentDate)) {
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
            originalAmount: tx.amount
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
          originalAmount: h.amount
        }
        forecastTransactions.push(manualTx)
      }
    })
    return forecastTransactions.sort((a, b) => a.date.getTime() - b.date.getTime())
  }

  const generateClientLowBalanceAnalysis = (accounts: any[], transactions: any[], startDate: Date, endDate: Date): LowBalanceAnalysis[] => {
    const analyses: LowBalanceAnalysis[] = []
    
    accounts.forEach(account => {
      const balanceForecasts = generateClientBalanceForecast([account], transactions, startDate, endDate)
      const lowestBalances = balanceForecasts
        .map((forecast, index) => ({
          date: forecast.date,
          balance: forecast.accountBalances[0]?.balance || 0,
          rank: index
        }))
        .sort((a, b) => a.balance - b.balance)
        .slice(0, 5)
      
      const overallLowest = lowestBalances[0]
      
      const analysis: LowBalanceAnalysis = {
        accountId: account.id,
        accountName: account.name,
        lowestBalances,
        overallLowest: overallLowest ? {
          date: overallLowest.date,
          balance: overallLowest.balance
        } : {
          date: new Date(),
          balance: 0
        }
      }
      
      analyses.push(analysis)
    })
    
    return analyses
  }

  // Thin wrapper around the shared recurrence engine so the client
  // renders the same forecast dates as the server.
  const isTransactionOnDate = (transaction: any, _transactionDate: Date, checkDate: Date): boolean => {
    return sharedIsTransactionOnDate(transaction, checkDate)
  }

  useEffect(() => {
    loadForecastData()
    setDisplayedTransactions(100) // Reset pagination when forecast changes
  }, [startDate, forecastMonths])

  const handleResetForecast = async () => {
    try {
      // For now, just reload the data since we don't have the forecast API working
      await loadForecastData()
    } catch (error) {
      console.error('Failed to reset forecast:', error)
    }
  }

  // Calculate summary statistics
  const getSummaryStats = () => {
    if (forecasts.length === 0) return null
    
    const startForecast = forecasts[0]
    const endForecast = forecasts[forecasts.length - 1]
    const lowestBalance = Math.min(...forecasts.map(f => f.totalBalance))
    const lowestDate = forecasts.find(f => f.totalBalance === lowestBalance)
    
    return {
      startBalance: startForecast.totalBalance,
      endBalance: endForecast.totalBalance,
      lowestBalance,
      lowestDate: lowestDate?.date,
      netChange: endForecast.totalBalance - startForecast.totalBalance
    }
  }

    
  // Prepare data for balance forecast chart
  const getBalanceForecastData = () => {
    if (forecasts.length === 0) return []
    
    // Get unique accounts from forecasts
    const uniqueAccounts = new Set<string>()
    forecasts.forEach(forecast => {
      forecast.accountBalances.forEach(balance => {
        uniqueAccounts.add(balance.accountId)
      })
    })
    
    // Create dataset for each account
    const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899']
    const accountColors: Record<string, string> = {}
    let colorIndex = 0
    
    uniqueAccounts.forEach(accountId => {
      accountColors[accountId] = colors[colorIndex % colors.length]
      colorIndex++
    })
    
    // For each account, create a data series
    const chartData: any[] = []
    
    uniqueAccounts.forEach(accountId => {
      const accountData = forecasts.map(forecast => {
        const balance = forecast.accountBalances.find(ab => ab.accountId === accountId)
        return {
          label: formatDateForDisplay(forecast.date),
          value: balance?.balance || 0,
          color: accountColors[accountId]
        }
      })
      
      // Add account name to first data point for legend
      if (accountData.length > 0) {
        const firstBalance = forecasts[0].accountBalances.find(ab => ab.accountId === accountId)
        ;(accountData[0] as any).accountName = firstBalance?.accountName || `Account ${accountId}`
      }
      
      chartData.push(...accountData)
    })
    
    return chartData
  }
  
  const [selectedTransactions, setSelectedTransactions] = useState<string[]>([])
  const [displayedTransactions, setDisplayedTransactions] = useState(100)
  
  // ---------- Multi-row edit helpers ----------
  const buildBufferFor = (transaction: ForecastTransaction): EditBuffer => {
    const originalTx = originalTransactions.find(tx => tx.id === transaction.transactionId)
    return {
      description: transaction.description,
      amount: transaction.amount.toString(),
      date: formatDateForInput(transaction.date),
      accountId: transaction.accountId || '',
      startDate: originalTx ? formatDateForInput(originalTx.startDate) : '',
      frequencyValue: originalTx?.frequency?.value?.toString() || '',
      frequencyUnit: originalTx?.frequency?.unit || 'months',
      customPattern: originalTx?.frequency?.customPattern || '',
    }
  }

  const editSelectedRows = () => {
    const rows = transactions.filter(t => selectedTransactions.includes(t.id))
    if (rows.length === 0) return
    setEditingTransactions(prev => {
      const next = new Set(prev)
      rows.forEach(r => next.add(r.id))
      return next
    })
    setEditForms(prev => {
      const next = { ...prev }
      rows.forEach(r => {
        if (!next[r.id]) next[r.id] = buildBufferFor(r)
      })
      return next
    })
  }

  const cancelEditRow = (forecastRowId: string) => {
    setEditingTransactions(prev => {
      const next = new Set(prev)
      next.delete(forecastRowId)
      return next
    })
    setEditForms(prev => {
      const { [forecastRowId]: _omit, ...rest } = prev
      return rest
    })
    // Reset the Accept/Edit Selected counters — once the user has committed
    // to or abandoned an edit, the prior selection is no longer meaningful.
    setSelectedTransactions([])
  }

  const updateEditField = (forecastRowId: string, patch: Partial<EditBuffer>) => {
    setEditForms(prev => ({
      ...prev,
      [forecastRowId]: { ...(prev[forecastRowId] as EditBuffer), ...patch },
    }))
  }

  const saveEditRow = async (forecastRowId: string) => {
    try {
      const currentForecastTx = transactions.find(ftx => ftx.id === forecastRowId)
      if (!currentForecastTx) {
        alert('Could not locate the forecast row to update.')
        return
      }
      const buf = editForms[forecastRowId]
      if (!buf) return

      const amt = parseFloat(buf.amount)
      if (Number.isNaN(amt)) {
        alert('Amount must be a valid number')
        return
      }

      // Find existing manual-edit override for this (transactionId, date)
      const dateKey = formatDateForStorage(currentForecastTx.date)
      const existingOverride = historyData.find(
        h => h.transactionId === currentForecastTx.transactionId && 
             formatDateForStorage(h.date) === dateKey &&
             h.isManualEdit
      )

      if (existingOverride) {
        // Update the existing override
        await historyApi.update(existingOverride.id, {
          description: buf.description,
          amount: amt,
          date: dateKey,
          accountId: buf.accountId || currentForecastTx.accountId,
          categoryId: currentForecastTx.categoryId,
          type: currentForecastTx.type,
        })
      } else {
        // Create a new manual-edit override history row
        await historyApi.create({
          transactionId: currentForecastTx.transactionId,
          accountId: buf.accountId || currentForecastTx.accountId,
          categoryId: currentForecastTx.categoryId,
          date: dateKey,
          description: buf.description,
          amount: amt,
          type: currentForecastTx.type,
          isManualEdit: true,
        })
      }

      // Silent reload keeps the table mounted, so the browser preserves
      // the user's scroll position. cancelEditRow also clears the
      // Accept/Edit Selected counters.
      await loadForecastData({ silent: true })
      cancelEditRow(forecastRowId)
    } catch (error: any) {
      console.error('Error updating transaction:', error)
      const details = error?.response?.data?.details?.join(', ')
      alert(`Failed to save: ${details || error?.response?.data?.error || error?.message || 'unknown error'}`)
    }
  }

  const resetEditRow = async (forecastRowId: string) => {
    try {
      const currentForecastTx = transactions.find(ftx => ftx.id === forecastRowId)
      if (!currentForecastTx) return

      const dateKey = formatDateForStorage(currentForecastTx.date)
      const existingOverride = historyData.find(
        h => h.transactionId === currentForecastTx.transactionId && 
             formatDateForStorage(h.date) === dateKey &&
             h.isManualEdit
      )

      if (existingOverride) {
        await historyApi.delete(existingOverride.id)
        await loadForecastData({ silent: true })
      }
    } catch (error: any) {
      console.error('Error resetting transaction:', error)
      alert(`Failed to reset: ${error?.response?.data?.error || error?.message || 'unknown error'}`)
    }
  }

  // Post each selected forecast occurrence into history. "Accept" means
  // "this one actually happened" — the source transaction's startDate is
  // untouched, so the recurrence rule keeps firing for future dates.
  // The loadForecastData pipeline hides any forecast row that matches an
  // existing (transactionId, date) history row, so accepted rows vanish
  // from the forecast on the next reload.
  const acceptSelectedRows = async () => {
    const rows = transactions.filter(t => selectedTransactions.includes(t.id))
    if (rows.length === 0) return
    const ok = window.confirm(
      `Move ${rows.length} forecast occurrence${rows.length === 1 ? '' : 's'} to History?\n\n` +
      `These rows will stop appearing on the Forecast and show up on the History page. ` +
      `The underlying transaction is unchanged; future occurrences still project normally.`
    )
    if (!ok) return
    try {
      // POST/PUT sequentially so a failure surfaces cleanly rather than
      // partially-succeeding in a Promise.all race.
      for (const ftx of rows) {
        if (ftx.transactionId) {
          // Regular recurring transaction: create a new posted history row.
          // Preserve the manual-edit flag so the override survives a round-trip
          // to History and back to Forecast.
          const existing = historyData.find(
            h => h.transactionId === ftx.transactionId &&
              formatDateForStorage(h.date) === formatDateForStorage(ftx.date)
          )
          if (existing) {
            await historyApi.update(existing.id, { isPosted: true })
          } else {
            await historyApi.create({
              transactionId: ftx.transactionId,
              accountId: ftx.accountId,
              categoryId: ftx.categoryId,
              date: formatDateForStorage(ftx.date),
              description: ftx.description,
              amount: ftx.amount,
              type: ftx.type,
              isManualEdit: ftx.isEdited ? true : undefined,
            })
          }
        } else {
          // Manual transaction: flip the existing history row to posted
          const historyId = ftx.id.replace(/^manual_/, '')
          await historyApi.update(historyId, { isPosted: true })
        }
      }
      setSelectedTransactions([])
      await loadForecastData({ silent: true })
    } catch (error: any) {
      console.error('Error accepting forecast rows:', error)
      alert(`Failed to move to history: ${error?.response?.data?.error || error?.message || 'unknown error'}`)
    }
  }

  // Delete a single forecast occurrence by creating a suppressed history row.
  // This removes it from the Forecast view but keeps it in History for record-keeping.
  const deleteEditRow = async (forecastRowId: string) => {
    const currentForecastTx = transactions.find(ftx => ftx.id === forecastRowId)
    if (!currentForecastTx) {
      alert('Could not locate the forecast row to delete.')
      return
    }
    const ok = window.confirm(
      `Delete this forecast occurrence on ${formatDateForDisplay(currentForecastTx.date)}?\n\n` +
      `This will remove it from the Forecast view and move it to History. ` +
      `The underlying transaction will continue to generate future occurrences.`
    )
    if (!ok) return
    try {
      // Create a suppressed history row to hide this occurrence from forecast
      await historyApi.create({
        transactionId: currentForecastTx.transactionId,
        accountId: currentForecastTx.accountId,
        categoryId: currentForecastTx.categoryId,
        date: formatDateForStorage(currentForecastTx.date),
        description: currentForecastTx.description,
        amount: currentForecastTx.amount,
        type: currentForecastTx.type,
        isSuppressed: true,
      })
      await loadForecastData({ silent: true })
      cancelEditRow(forecastRowId)
    } catch (error: any) {
      console.error('Error deleting forecast row:', error)
      alert(`Failed to delete: ${error?.response?.data?.error || error?.message || 'unknown error'}`)
    }
  }

  // Add a manual one-time transaction as a history row so it appears in
  // Forecast and History but NOT in the Budget (transactions table).
  const addManualTransaction = async () => {
    if (!manualForm.description || !manualForm.amount || !manualForm.accountId || !manualForm.categoryId ||
        manualForm.accountId === '' || manualForm.categoryId === '') {
      alert('Please fill in all required fields')
      return
    }
    try {
      const amountNum = parseFloat(manualForm.amount)
      const finalAmount = manualForm.type === 'expense' ? -Math.abs(amountNum) : Math.abs(amountNum)

      await historyApi.create({
        accountId: manualForm.accountId,
        categoryId: manualForm.categoryId,
        date: manualForm.date,
        description: manualForm.description,
        amount: finalAmount,
        type: manualForm.type,
        isTransfer: manualForm.isTransfer,
        transferToAccountId: manualForm.isTransfer ? manualForm.transferToAccountId : undefined,
        isPosted: false,
      })

      // Reset form and reload
      setManualForm({
        description: '',
        amount: '',
        date: formatDateForStorage(new Date()),
        accountId: '',
        categoryId: '',
        type: 'expense',
        isTransfer: false,
        transferToAccountId: '',
      })
      setIsAddingManual(false)
      await loadForecastData({ silent: true })
    } catch (error: any) {
      console.error('Error adding manual transaction:', error)
      const details = error?.response?.data?.details?.join(', ')
      alert(`Failed to add: ${details || error?.response?.data?.error || error?.message || 'unknown error'}`)
    }
  }

  // True running totals per account, keyed by forecast row id.
  // Walks transactions in chronological order, starting from the first
  // BalanceForecast entry's per-account balances, and applies each
  // transaction's amount to its account as we go.
  const accountRunningTotalsByRow = React.useMemo<Record<string, Record<string, number>>>(() => {
    const result: Record<string, Record<string, number>> = {}
    if (forecasts.length === 0 || transactions.length === 0) return result

    const totals: Record<string, number> = {}
    forecasts[0].accountBalances.forEach(b => {
      totals[b.accountId] = b.balance
    })

    // Sort by date ascending to guarantee a correct running balance even if
    // the source list happened to arrive unsorted.
    const ordered = [...transactions].sort((a, b) => a.date.getTime() - b.date.getTime())
    ordered.forEach(tx => {
      if (tx.accountId) {
        totals[tx.accountId] = (totals[tx.accountId] ?? 0) + (tx.amount || 0)
      }
      result[tx.id] = { ...totals }
    })
    return result
  }, [transactions, forecasts])
  
  // Calculate end date for display
  const endDate = createSafeDate(startDate)
  endDate.setMonth(endDate.getMonth() + forecastMonths)

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-500">Loading forecast...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Forecast</h1>
          <p className="text-gray-600">View and manage your financial forecast</p>
        </div>
        <div className="flex space-x-3">
          <input 
            type="date" 
            className="form-input" 
            value={startDate}
            onChange={(e) => handleStartDateChange(e.target.value)}
          />
          <select 
            className="form-input"
            value={forecastMonths}
            onChange={(e) => setForecastMonths(Number(e.target.value))}
          >
            <option value={6}>6 months</option>
            <option value={12}>12 months</option>
            <option value={18}>18 months</option>
            <option value={24}>24 months</option>
            <option value={36}>36 months</option>
            <option value={48}>48 months</option>
            <option value={60}>60 months (Full Forecast)</option>
          </select>
          <button className="btn-secondary" onClick={handleResetForecast}>
            Reset Forecast
          </button>
        </div>
      </div>

      {/* Low Balance Alerts */}
      <div className="card">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Low Balance Alerts</h3>
        <div className="space-y-3">
          {lowBalanceAnalysis.length > 0 ? (
            lowBalanceAnalysis.map(analysis => {
              const lowest = analysis.overallLowest
              const isCritical = lowest.balance < 500
              const isWarning = lowest.balance >= 500 && lowest.balance < 1000
              
              if (!isCritical && !isWarning) return null
              
              return (
                <div 
                  key={analysis.accountId} 
                  className={`flex items-center justify-between p-4 border rounded-lg ${
                    isCritical ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${
                      isCritical ? 'bg-red-500' : 'bg-yellow-500'
                    }`}></div>
                    <div>
                      <p className={`font-medium ${
                        isCritical ? 'text-red-900' : 'text-yellow-900'
                      }`}>
                        {isCritical ? 'Critical' : 'Warning'}: {analysis.accountName}
                      </p>
                      <p className={`text-sm ${
                        isCritical ? 'text-red-700' : 'text-yellow-700'
                      }`}>
                        Balance drops to ${lowest.balance.toFixed(2)} on {formatDateForDisplay(lowest.date)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`font-medium ${
                      isCritical ? 'text-red-600' : 'text-yellow-600'
                    }`}>
                      ${lowest.balance.toFixed(2)}
                    </p>
                    <button className="btn-secondary text-xs mt-1">View Details</button>
                  </div>
                </div>
              )
            }).filter(Boolean)
          ) : (
            <div className="text-center py-8 text-gray-500">
              <p>No low balance alerts</p>
              <p className="text-sm mt-1">All accounts maintain healthy balances</p>
            </div>
          )}
        </div>
      </div>

      {/* Forecast Transactions - DOMINANT FEATURE */}
      <div className="card">
        <div className="flex flex-wrap gap-3 justify-between items-center mb-6">
          <div>
            <h3 className="text-xl font-bold text-gray-900">Forecast Transactions</h3>
            <p className="text-gray-600">The core feature - manage and adjust your financial future</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Fixed min-widths keep these buttons from jittering when the
                selected count grows from 0 → N (e.g. "Select all"). */}
            <button
              className="btn-primary min-w-[11rem] whitespace-nowrap"
              disabled={selectedTransactions.length === 0}
              onClick={acceptSelectedRows}
            >
              Accept Selected ({selectedTransactions.length})
            </button>
            <button
              className="btn-primary min-w-[11rem] whitespace-nowrap"
              disabled={selectedTransactions.length === 0}
              onClick={editSelectedRows}
            >
              Edit Selected ({selectedTransactions.length})
            </button>
            <button
              className="btn-secondary"
              onClick={() => setIsAddingManual(!isAddingManual)}
            >
              {isAddingManual ? 'Cancel' : '+ Add Manual'}
            </button>
          </div>
        </div>

        {isAddingManual && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 p-4 bg-gray-50 rounded-lg mb-4">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Description</label>
              <input
                type="text"
                className="input w-full"
                value={manualForm.description}
                onChange={e => setManualForm({ ...manualForm, description: e.target.value })}
                placeholder="e.g., Birthday Gift"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Amount</label>
              <input
                type="number"
                step="0.01"
                className="input w-full"
                value={manualForm.amount}
                onChange={e => setManualForm({ ...manualForm, amount: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Date</label>
              <input
                type="date"
                className="input w-full"
                value={manualForm.date}
                onChange={e => setManualForm({ ...manualForm, date: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Type</label>
              <select
                className="input w-full"
                value={manualForm.type}
                onChange={e => setManualForm({ ...manualForm, type: e.target.value as 'income' | 'expense' | 'administrative' })}
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
                <option value="administrative">Administrative</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Account</label>
              <select
                className="input w-full"
                value={manualForm.accountId}
                onChange={e => setManualForm({ ...manualForm, accountId: e.target.value })}
              >
                <option value="">Select...</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="form-checkbox h-4 w-4 text-blue-600"
                  checked={manualForm.isTransfer}
                  onChange={(e) => setManualForm(prev => ({ ...prev, isTransfer: e.target.checked, transferToAccountId: e.target.checked ? prev.transferToAccountId : '' }))}
                />
                <span className="text-sm font-medium text-gray-700">Transfer</span>
              </label>
            </div>
            {manualForm.isTransfer && (
              <div>
                <label className="block text-xs text-gray-600 mb-1">Transfer To Account</label>
                <select
                  className="input w-full"
                  value={manualForm.transferToAccountId}
                  onChange={e => setManualForm(prev => ({ ...prev, transferToAccountId: e.target.value }))}
                >
                  <option value="">Select destination account</option>
                  {accounts
                    .filter(a => a.id !== manualForm.accountId)
                    .map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-600 mb-1">Category</label>
              <CategorySelector
                categories={categories}
                selectedCategoryId={manualForm.categoryId}
                onChange={(id: string) => setManualForm({ ...manualForm, categoryId: id })}
                onCategoryAdded={(cat: Category) => {
                  setCategories(prev => [...prev, cat])
                  setManualForm(prev => ({ ...prev, categoryId: cat.id }))
                }}
                required
              />
            </div>
            <div className="lg:col-span-6 flex justify-end">
              <button
                className="btn-primary text-sm"
                onClick={addManualTransaction}
              >
                Add Transaction
              </button>
            </div>
          </div>
        )}

        {transactions.length > 0 ? (() => {
          // Percentage-based widths so the table always fits the card.
          // With `table-fixed`, these widths are authoritative regardless
          // of whether a row is in view or edit mode — so column
          // boundaries never jiggle.
          const accountBalances = forecasts.length > 0
            ? forecasts[forecasts.length - 1].accountBalances
            : []
          const accountCount = accountBalances.length
          const checkboxPct = 4
          const datePct = 10
          const amountPct = 10
          const fixedSum = checkboxPct + datePct + amountPct
          const descPct = Math.max(22, 100 - fixedSum - accountCount * 14)
          const accountPct = accountCount > 0 ? (100 - fixedSum - descPct) / accountCount : 0
          const totalCols = 4 + accountCount
          return (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse table-fixed" style={{ minWidth: '640px' }}>
                <colgroup>
                  <col style={{ width: `${checkboxPct}%` }} />
                  <col style={{ width: `${datePct}%` }} />
                  <col style={{ width: `${descPct}%` }} />
                  <col style={{ width: `${amountPct}%` }} />
                  {accountBalances.map(a => (
                    <col key={`col-${a.accountId}`} style={{ width: `${accountPct}%` }} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="border-b-2 border-gray-200 bg-gray-50">
                    <th className="text-left py-3 px-3 text-sm font-medium text-gray-700">
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={selectedTransactions.length === transactions.length && transactions.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedTransactions(transactions.map(t => t.id))
                          } else {
                            setSelectedTransactions([])
                          }
                        }}
                      />
                    </th>
                    <th className="text-left py-3 px-3 text-sm font-medium text-gray-700">Date</th>
                    <th className="text-left py-3 px-3 text-sm font-medium text-gray-700">Description</th>
                    <th className="text-right py-3 px-3 text-sm font-medium text-gray-700">Amount</th>
                    {accountBalances.map(a => (
                      <th key={a.accountId} className="text-right py-3 px-3 text-sm font-medium text-gray-700">
                        <div className="truncate" title={a.accountName}>{a.accountName}</div>
                        <div className="text-xs text-gray-500 font-normal truncate">
                          Start: ${a.balance.toFixed(2)}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {transactions.slice(0, displayedTransactions).map((transaction) => {
                    const isEditing = editingTransactions.has(transaction.id)
                    const buf = editForms[transaction.id]
                    const rowTotals = accountRunningTotalsByRow[transaction.id] || {}
                    const originalTx = originalTransactions.find(tx => tx.id === transaction.transactionId)
                    const rowClass = `border-b ${
                      isEditing ? 'bg-blue-50' :
                      transaction.isOverride ? 'bg-yellow-50' :
                      transaction.isPosted ? 'bg-green-50' :
                      'hover:bg-gray-50'
                    }`
                    return (
                      <React.Fragment key={transaction.id}>
                        <tr className={rowClass}>
                          <td className="py-2 px-3 align-top">
                            <input
                              type="checkbox"
                              className="rounded"
                              checked={selectedTransactions.includes(transaction.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedTransactions([...selectedTransactions, transaction.id])
                                } else {
                                  setSelectedTransactions(selectedTransactions.filter((id: string) => id !== transaction.id))
                                }
                              }}
                            />
                          </td>
                          <td className="py-2 px-3 align-top">
                            {isEditing && buf ? (
                              <input
                                type="date"
                                value={buf.date}
                                onChange={(e) => updateEditField(transaction.id, { date: e.target.value })}
                                className="input-field text-sm w-full"
                              />
                            ) : (
                              <span className="text-sm text-gray-900 whitespace-nowrap">
                                {formatDateForDisplay(transaction.date)}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 align-top">
                            {isEditing && buf ? (
                              <input
                                type="text"
                                value={buf.description}
                                onChange={(e) => updateEditField(transaction.id, { description: e.target.value })}
                                className="input-field text-sm w-full"
                              />
                            ) : (
                              <div className="flex items-center space-x-2 min-w-0">
                                <div
                                  className="w-3 h-3 rounded-full flex-shrink-0"
                                  style={{ backgroundColor: transaction.categoryColor }}
                                />
                                <div className="min-w-0">
                                  <p className="font-medium text-gray-900 text-sm truncate">
                                    {transaction.description}
                                    {transaction.isOverride && <span className="text-yellow-600 ml-1">(Override)</span>}
                                    {transaction.isEdited && (
                                      <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                                        Edited
                                      </span>
                                    )}
                                  </p>
                                  <p className="text-xs text-gray-500 truncate">
                                    {transaction.type === 'income' ? 'Income' : transaction.type === 'expense' ? 'Expense' : 'Administrative'} • {transaction.isPosted ? 'Posted' : 'Recurring'}
                                  </p>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>

                        {isEditing && buf && (
                          <tr className="bg-blue-50 border-b">
                            <td colSpan={totalCols} className="py-3 px-4">
                              <div className="flex flex-wrap items-end gap-3">
                                <div className="flex flex-col min-w-[160px]">
                                  <label className="text-xs text-gray-600 mb-1">Account</label>
                                  <select
                                    value={buf.accountId}
                                    onChange={(e) => updateEditField(transaction.id, { accountId: e.target.value })}
                                    className="input-field text-sm"
                                  >
                                    <option value="">Select Account</option>
                                    {accountBalances.map(a => (
                                      <option key={a.accountId} value={a.accountId}>{a.accountName}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="flex flex-col min-w-[140px]">
                                  <label className="text-xs text-gray-600 mb-1">Start date</label>
                                  <input
                                    type="date"
                                    value={buf.startDate}
                                    onChange={(e) => updateEditField(transaction.id, { startDate: e.target.value })}
                                    className="input-field text-sm"
                                  />
                                </div>
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-600 mb-1">Frequency</label>
                                  <div className="flex gap-2">
                                    <input
                                      type="number"
                                      value={buf.frequencyValue}
                                      onChange={(e) => updateEditField(transaction.id, { frequencyValue: e.target.value })}
                                      className="input-field text-sm w-20"
                                      placeholder="Every"
                                    />
                                    <select
                                      value={buf.frequencyUnit}
                                      onChange={(e) => updateEditField(transaction.id, { frequencyUnit: e.target.value })}
                                      className="input-field text-sm"
                                    >
                                      <option value="days">Days</option>
                                      <option value="weeks">Weeks</option>
                                      <option value="months">Months</option>
                                      <option value="years">Years</option>
                                      <option value="custom">Custom</option>
                                    </select>
                                  </div>
                                </div>
                                {buf.frequencyUnit === 'custom' && (
                                  <div className="flex flex-col min-w-[220px] flex-1">
                                    <label className="text-xs text-gray-600 mb-1">Custom pattern</label>
                                    <input
                                      type="text"
                                      value={buf.customPattern}
                                      onChange={(e) => updateEditField(transaction.id, { customPattern: e.target.value })}
                                      className="input-field text-sm"
                                      placeholder="e.g., 1st and 15th"
                                    />
                                  </div>
                                )}
                                <div className="flex gap-2 ml-auto">
                                  {/* Delete sits on the left of Cancel/Save so
                                      the destructive action is visually
                                      separated from the confirm pair. */}
                                  <button
                                    onClick={() => deleteEditRow(transaction.id)}
                                    className="text-sm px-3 py-1.5 rounded border border-red-200 text-red-600 hover:bg-red-50"
                                  >
                                    Delete
                                  </button>
                                  {transaction.isEdited && (
                                    <button
                                      onClick={() => {
                                        if (window.confirm('Reset this occurrence to the original transaction values?')) {
                                          resetEditRow(transaction.id)
                                          cancelEditRow(transaction.id)
                                        }
                                      }}
                                      className="text-sm px-3 py-1.5 rounded border border-amber-200 text-amber-700 hover:bg-amber-50"
                                    >
                                      Reset
                                    </button>
                                  )}
                                  <button
                                    onClick={() => cancelEditRow(transaction.id)}
                                    className="btn-secondary text-sm"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => saveEditRow(transaction.id)}
                                    className="btn-primary text-sm"
                                  >
                                    Save
                                  </button>
                                </div>
                              </div>
                              {originalTx && (
                                <p className="text-xs text-gray-500 mt-2">
                                  Source: <span className="font-medium">{originalTx.name}</span> starting {formatDateForDisplay(originalTx.startDate)}
                                </p>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })() : (
          <div className="text-center py-12 text-gray-500">
            <p className="text-lg font-medium">No forecast transactions found</p>
            <p className="text-sm mt-2">Add transactions to see your financial forecast</p>
          </div>
        )}
        
        {/* Pagination - only show when there are transactions */}
        {transactions.length > 0 && (
          <div className="mt-4">
            {transactions.length > displayedTransactions && (
              <div className="text-center">
                <button 
                  onClick={() => setDisplayedTransactions(prev => Math.min(prev + 100, transactions.length))}
                  className="btn-secondary"
                >
                  See More ({Math.min(100, transactions.length - displayedTransactions)} of {transactions.length - displayedTransactions} remaining)
                </button>
                <div className="text-sm text-gray-500 mt-2">
                  Showing {displayedTransactions} of {transactions.length} transactions
                </div>
              </div>
            )}
            {transactions.length <= displayedTransactions && (
              <div className="text-center">
                <button 
                  disabled
                  className="btn-secondary opacity-50 cursor-not-allowed"
                >
                  No More Transactions
                </button>
                <div className="text-sm text-gray-500 mt-2">
                  Showing all {transactions.length} transactions
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default Forecast
