// Core data types for Budget App

export interface Account {
  id: string
  name: string
  type: 'checking' | 'savings' | 'credit' | 'investment'
  startingBalance: number
  currentBalance: number
  includeInLowBalanceAnalysis: boolean
  importSettings?: {
    dateFormat: string
    hasHeaders: boolean
    columnMapping: {
      date: number
      amount: number
      description: number
    }
  }
  createdAt?: string
  updatedAt?: string
}

export interface Category {
  id: string
  name: string
  parentId?: string
  color: string
  sortOrder: number
  children?: Category[]
  createdAt?: string
}

export interface Transaction {
  id: string
  name: string
  amount: number
  frequency: {
    value: number
    unit: 'days' | 'weeks' | 'months' | 'years' | 'custom'
    customPattern?: string // e.g., "1st and 15th"
  }
  startDate: Date
  endDate?: Date
  pauseStartDate?: Date
  pauseEndDate?: Date
  categoryId: string
  categoryName?: string
  accountId: string
  accountName?: string
  type: 'income' | 'expense' | 'administrative'
  isTransfer: boolean
  transferToAccountId?: string
  isActive: boolean
  createdAt?: string
  updatedAt?: string
}

export interface ForecastOverride {
  id: string
  transactionId: string
  date: Date
  originalAmount: number
  overrideAmount: number
  isPosted: boolean
  notes?: string
  createdAt?: string
  updatedAt?: string
}

export interface TransactionRule {
  id: string
  accountId: string
  pattern: string
  categoryId: string
  confidence: number
  matchCount: number
  createdAt?: string
}

export interface HistoricalTransaction {
  id: string
  transactionId?: string
  accountId: string
  categoryId: string
  date: Date
  description: string
  bankDescription?: string
  amount: number
  type: 'income' | 'expense' | 'administrative'
  isTransfer: boolean
  transferToAccountId?: string
  isExcluded: boolean
  archivedAt: string
}

export interface UserPreferences {
  currency: string
  dateFormat: string
  forecastStartDate: string
  lowBalanceTrackingCount: number
  includeNetWorthInAnalysis: boolean
}

export interface ForecastTransaction {
  id: string
  transactionId: string
  date: Date
  description: string
  amount: number
  type: 'income' | 'expense' | 'administrative'
  categoryId: string
  categoryName: string
  categoryColor: string
  accountId: string
  accountName: string
  isTransfer: boolean
  transferToAccountId?: string
  isOverride: boolean
  isPosted: boolean
  isEdited?: boolean
  originalAmount?: number
}

export interface BalanceForecast {
  date: Date
  accountBalances: {
    accountId: string
    accountName: string
    balance: number
    change: number
  }[]
  totalBalance: number
  netWorth: number
  lowestBalanceAccounts: {
    accountId: string
    accountName: string
    balance: number
    rank: number
  }[]
}

export interface LowBalanceAnalysis {
  accountId: string
  accountName: string
  alertType?: 'lowest' | 'firstNegative'
  lowestBalances: {
    date: Date
    balance: number
    rank: number
  }[]
  overallLowest: {
    date: Date
    balance: number
  }
}

export interface ImportSettings {
  dateFormat: string
  hasHeaders: boolean
  columnMapping: {
    date: number
    amount: number
    description: number
  }
}

export interface ImportedTransaction {
  date: Date
  description: string
  amount: number
  suggestedCategoryId?: string
  suggestedCategoryName?: string
  confidence?: number
  excluded: boolean
  notes?: string
}

export interface ImportResult {
  success: boolean
  imported: number
  skipped: number
  errors: string[]
  transactions: ImportedTransaction[]
}

// UI Component Props Types
export interface TransactionFormData {
  name: string
  amount: string
  frequencyValue: string
  frequencyUnit: 'days' | 'weeks' | 'months' | 'years' | 'custom'
  customPattern: string
  startDate: string
  endDate: string
  pauseStartDate: string
  pauseEndDate: string
  categoryId: string
  accountId: string
  type: 'income' | 'expense' | 'administrative'
  isTransfer: boolean
  transferToAccountId?: string
}

export interface AccountFormData {
  name: string
  type: 'checking' | 'savings' | 'credit' | 'investment'
  startingBalance: string
  includeInLowBalanceAnalysis: boolean
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasNext: boolean
  hasPrev: boolean
}
