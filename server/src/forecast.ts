import { isTransactionOnDate as recurrenceHit } from '../../shared/recurrence'

export function generateBalanceForecast(
  accounts: any[], 
  transactions: any[], 
  startDate: Date, 
  endDate: Date
): any[] {
  const forecasts: any[] = []
  const currentDate = new Date(startDate)
  
  // Initialize account balances from current balances
  const accountBalances: { [key: string]: number } = {}
  accounts.forEach(account => {
    accountBalances[account.id] = account.current_balance || 0
  })
  
  // Generate daily forecasts
  while (currentDate <= endDate) {
    // Calculate daily balance changes
    const dailyTransactions = transactions.filter(t => recurrenceHit(t, currentDate))
    
    // Update account balances
    const accountBalanceChanges: { [key: string]: number } = {}
    dailyTransactions.forEach(tx => {
      // Source account
      if (!accountBalanceChanges[tx.account_id]) {
        accountBalanceChanges[tx.account_id] = 0
      }
      accountBalanceChanges[tx.account_id] += tx.amount
      accountBalances[tx.account_id] = (accountBalances[tx.account_id] || 0) + tx.amount
      
      // Transfer: destination account receives the opposite amount
      if ((tx.is_transfer || tx.isTransfer) && tx.transfer_to_account_id) {
        if (!accountBalanceChanges[tx.transfer_to_account_id]) {
          accountBalanceChanges[tx.transfer_to_account_id] = 0
        }
        const transferAmount = Math.abs(tx.amount)
        accountBalanceChanges[tx.transfer_to_account_id] += transferAmount
        accountBalances[tx.transfer_to_account_id] = (accountBalances[tx.transfer_to_account_id] || 0) + transferAmount
      }
    })
    
    // Create forecast entry
    const forecast = {
      date: new Date(currentDate),
      accountBalances: accounts.map(account => ({
        accountId: account.id,
        accountName: account.name,
        balance: accountBalances[account.id] || 0,
        change: accountBalanceChanges[account.id] || 0
      })),
      totalBalance: Object.values(accountBalances).reduce((sum, balance) => sum + balance, 0),
      netWorth: Object.values(accountBalances).reduce((sum, balance) => sum + balance, 0), // Simplified
      lowestBalanceAccounts: []
    }
    
    forecasts.push(forecast)
    currentDate.setDate(currentDate.getDate() + 1)
  }
  
  return forecasts
}

export function generateForecastTransactions(
  transactions: any[], 
  categories: any[], 
  accounts: any[], 
  startDate: Date, 
  endDate: Date
): any[] {
  const forecastTransactions: any[] = []
  const currentDate = new Date(startDate)
  
  while (currentDate <= endDate) {
    transactions.forEach(tx => {
      if (recurrenceHit(tx, currentDate)) {
        const category = categories.find(c => c.id === tx.category_id)
        const account = accounts.find(a => a.id === tx.account_id)
        
        const forecastTx = {
          id: `forecast_${tx.id}_${currentDate.getTime()}`,
          transactionId: tx.id,
          date: new Date(currentDate),
          description: tx.name,
          amount: tx.amount,
          type: tx.type,
          categoryId: tx.category_id,
          categoryName: category?.name || 'Uncategorized',
          categoryColor: category?.color || '#6B7280',
          accountId: tx.account_id,
          accountName: account?.name || 'Unknown Account',
          isTransfer: tx.is_transfer === 1,
          transferToAccountId: tx.transfer_to_account_id,
          isOverride: tx.start_date === tx.end_date, // Manual adjustments have same start/end
          isPosted: currentDate < new Date(), // Past transactions are "posted"
          originalAmount: tx.amount
        }
        
        forecastTransactions.push(forecastTx)
      }
    })
    
    currentDate.setDate(currentDate.getDate() + 1)
  }
  
  return forecastTransactions.sort((a, b) => a.date.getTime() - b.date.getTime())
}

export function generateLowBalanceAnalysis(
  accounts: any[], 
  transactions: any[], 
  startDate: Date, 
  endDate: Date
): any[] {
  const analyses: any[] = []
  
  accounts.forEach(account => {
    const balanceForecasts = generateBalanceForecast([account], transactions, startDate, endDate)
    const lowestBalances = balanceForecasts
      .map((forecast, index) => ({
        date: forecast.date,
        balance: forecast.accountBalances[0]?.balance || 0,
        rank: index
      }))
      .sort((a, b) => a.balance - b.balance)
      .slice(0, 5) // Get 5 lowest balances
    
    const overallLowest = lowestBalances[0]
    
    const analysis = {
      accountId: account.id,
      accountName: account.name,
      lowestBalances,
      overallLowest: overallLowest ? {
        date: overallLowest.date,
        balance: overallLowest.balance,
        rank: overallLowest.rank
      } : {
        date: new Date(),
        balance: 0,
        rank: 0
      }
    }
    
    analyses.push(analysis)
  })
  
  return analyses
}

