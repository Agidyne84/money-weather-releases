import axios from 'axios'
import { 
  Account, 
  Category, 
  Transaction, 
  BalanceForecast, 
  ForecastTransaction, 
  LowBalanceAnalysis 
} from '../types'
import { createSafeDate, formatDateForStorage } from '../utils/dateUtils'

const API_BASE_URL = 'http://localhost:3001/api'

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// API Functions
export const accountsApi = {
  getAll: async (): Promise<Account[]> => {
    const response = await api.get('/accounts')
    
    // Transform flat API response to Account objects
    return response.data.map((item: any): Account => ({
      id: item.id,
      name: item.name,
      type: item.type,
      startingBalance: item.startingBalance,
      currentBalance: item.currentBalance,
      includeInLowBalanceAnalysis: Boolean(item.includeInLowBalanceAnalysis),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }))
  },
  
  create: async (account: Omit<Account, 'id' | 'createdAt' | 'updatedAt'>): Promise<Account> => {
    const response = await api.post('/accounts', account)
    
    // Transform the response back to Account format
    const item = response.data
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      startingBalance: item.startingBalance,
      currentBalance: item.currentBalance,
      includeInLowBalanceAnalysis: Boolean(item.includeInLowBalanceAnalysis),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }
  },

  update: async (id: string, account: Partial<Account>): Promise<Account> => {
    const response = await api.put(`/accounts/${id}`, account)
    
    // Transform the response back to Account format
    const item = response.data
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      startingBalance: item.startingBalance,
      currentBalance: item.currentBalance,
      includeInLowBalanceAnalysis: Boolean(item.includeInLowBalanceAnalysis),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    const response = await api.delete(`/accounts/${id}`)
    return response.data
  },
}

export const categoriesApi = {
  getAll: async (): Promise<Category[]> => {
    const response = await api.get('/categories')

    // Backend returns hierarchical data (root categories with children arrays).
    // Flatten into a single array so every category is selectable.
    const flat: Category[] = []
    const flatten = (nodes: any[]) => {
      nodes.forEach((node: any) => {
        flat.push({
          id: node.id,
          name: node.name,
          parentId: node.parentId || undefined,
          color: node.color,
          sortOrder: node.sortOrder,
          createdAt: node.createdAt
        })
        if (node.children && node.children.length > 0) {
          flatten(node.children)
        }
      })
    }
    flatten(response.data)
    return flat
  },

  create: async (category: Omit<Category, 'id' | 'createdAt'>): Promise<Category> => {
    const response = await api.post('/categories', category)
    
    // Transform the response back to Category format
    const item = response.data
    return {
      id: item.id,
      name: item.name,
      parentId: item.parentId || undefined,
      color: item.color,
      sortOrder: item.sortOrder,
      createdAt: item.createdAt
    }
  },

  update: async (id: string, category: Partial<Category>): Promise<Category> => {
    const response = await api.put(`/categories/${id}`, category)
    
    // Transform the response back to Category format
    const item = response.data
    return {
      id: item.id,
      name: item.name,
      parentId: item.parentId || undefined,
      color: item.color,
      sortOrder: item.sortOrder,
      createdAt: item.createdAt
    }
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    const response = await api.delete(`/categories/${id}`)
    return response.data
  },
}

export const transactionsApi = {
  getAll: async (limit = 50, offset = 0): Promise<Transaction[]> => {
    const response = await api.get('/transactions', { params: { limit, offset } })
    
    // Transform flat API response to nested Transaction objects
    return response.data.map((item: any): Transaction => ({
      id: item.id,
      name: item.name,
      amount: item.amount,
      frequency: {
        value: item.frequencyValue,
        unit: item.frequencyUnit,
        customPattern: item.customFrequencyPattern
      },
      startDate: createSafeDate(item.startDate),
      endDate: item.endDate ? createSafeDate(item.endDate) : undefined,
      pauseStartDate: item.pauseStartDate ? createSafeDate(item.pauseStartDate) : undefined,
      pauseEndDate: item.pauseEndDate ? createSafeDate(item.pauseEndDate) : undefined,
      categoryId: item.categoryId,
      accountId: item.accountId,
      type: item.type,
      isTransfer: Boolean(item.isTransfer),
      transferToAccountId: item.transferToAccountId ?? item.transfer_to_account_id ?? undefined,
      isActive: Boolean(item.isActive),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }))
  },
  
  create: async (transaction: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>): Promise<Transaction> => {
    // Convert nested frequency object to flat fields for API
    const apiTransaction = {
      ...transaction,
      frequencyValue: transaction.frequency.value,
      frequencyUnit: transaction.frequency.unit,
      customFrequencyPattern: transaction.frequency.customPattern,
      // Create plain date string without timezone metadata
      startDate: formatDateForStorage(createSafeDate(transaction.startDate)),
      endDate: transaction.endDate ? formatDateForStorage(createSafeDate(transaction.endDate)) : null,
      pauseStartDate: transaction.pauseStartDate ? formatDateForStorage(createSafeDate(transaction.pauseStartDate)) : null,
      pauseEndDate: transaction.pauseEndDate ? formatDateForStorage(createSafeDate(transaction.pauseEndDate)) : null,
      isTransfer: transaction.isTransfer,
      transferToAccountId: transaction.transferToAccountId
    }
    
    // Remove the nested frequency object
    const { frequency, ...transactionWithoutFrequency } = apiTransaction
    
    const response = await api.post('/transactions', transactionWithoutFrequency)
    
    // Transform the response back to nested format
    const item = response.data
    return {
      id: item.id,
      name: item.name,
      amount: item.amount,
      frequency: {
        value: item.frequencyValue,
        unit: item.frequencyUnit,
        customPattern: item.customFrequencyPattern
      },
      startDate: createSafeDate(item.startDate),
      endDate: item.endDate ? createSafeDate(item.endDate) : undefined,
      pauseStartDate: item.pauseStartDate ? createSafeDate(item.pauseStartDate) : undefined,
      pauseEndDate: item.pauseEndDate ? createSafeDate(item.pauseEndDate) : undefined,
      categoryId: item.categoryId,
      accountId: item.accountId,
      type: item.type,
      isTransfer: Boolean(item.isTransfer),
      transferToAccountId: item.transferToAccountId ?? item.transfer_to_account_id ?? undefined,
      isActive: Boolean(item.isActive),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }
  },

  update: async (id: string, transaction: Partial<Transaction>): Promise<Transaction> => {
    // Convert nested frequency object to flat fields for API
    const apiTransaction = {
      ...transaction,
      frequencyValue: transaction.frequency?.value,
      frequencyUnit: transaction.frequency?.unit,
      customFrequencyPattern: transaction.frequency?.customPattern,
      // Create plain date string without timezone metadata
      startDate: transaction.startDate ? formatDateForStorage(createSafeDate(transaction.startDate)) : null,
      endDate: transaction.endDate ? formatDateForStorage(createSafeDate(transaction.endDate)) : null,
      pauseStartDate: transaction.pauseStartDate ? formatDateForStorage(createSafeDate(transaction.pauseStartDate)) : null,
      pauseEndDate: transaction.pauseEndDate ? formatDateForStorage(createSafeDate(transaction.pauseEndDate)) : null,
    }
    
    // Remove the nested frequency object
    const { frequency, ...transactionWithoutFrequency } = apiTransaction
    
    const response = await api.put(`/transactions/${id}`, transactionWithoutFrequency)
    
    // Transform the response back to nested format
    const item = response.data
    return {
      id: item.id,
      name: item.name,
      amount: item.amount,
      frequency: {
        value: item.frequencyValue,
        unit: item.frequencyUnit,
        customPattern: item.customFrequencyPattern
      },
      startDate: createSafeDate(item.startDate),
      endDate: item.endDate ? createSafeDate(item.endDate) : undefined,
      pauseStartDate: item.pauseStartDate ? createSafeDate(item.pauseStartDate) : undefined,
      pauseEndDate: item.pauseEndDate ? createSafeDate(item.pauseEndDate) : undefined,
      categoryId: item.categoryId,
      accountId: item.accountId,
      type: item.type,
      isTransfer: Boolean(item.isTransfer),
      transferToAccountId: item.transferToAccountId ?? item.transfer_to_account_id ?? undefined,
      isActive: Boolean(item.isActive),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    const response = await api.delete(`/transactions/${id}`)
    return response.data
  },
}

export interface HistoryRow {
  id: string
  transactionId?: string | null
  accountId: string
  accountName?: string
  categoryId: string
  categoryName?: string
  categoryColor?: string
  date: Date
  description: string
  amount: number
  type: 'income' | 'expense'
  isTransfer?: boolean
  transferToAccountId?: string
  archivedAt?: string
  sourceTransactionName?: string | null
  isManualEdit?: boolean
  isSuppressed?: boolean
  isPosted?: boolean
  isExcluded?: boolean
  bankDescription?: string
}

export interface HistoryQuery {
  startDate?: string
  endDate?: string
  accountId?: string
  categoryId?: string
  limit?: number
  offset?: number
  includeUnposted?: boolean
  includeSuppressed?: boolean
  includeExcluded?: boolean
}

function mapHistoryRow(item: any): HistoryRow {
  return {
    id: item.id,
    transactionId: item.transactionId ?? null,
    accountId: item.accountId,
    accountName: item.accountName,
    categoryId: item.categoryId,
    categoryName: item.categoryName,
    categoryColor: item.categoryColor,
    date: createSafeDate(item.date),
    description: item.description,
    amount: Number(item.amount),
    type: item.type,
    isTransfer: Boolean(item.isTransfer),
    transferToAccountId: item.transferToAccountId ?? item.transfer_to_account_id ?? undefined,
    archivedAt: item.archivedAt,
    sourceTransactionName: item.sourceTransactionName ?? null,
    isManualEdit: Number(item.isManualEdit) !== 0,
    isSuppressed: Number(item.isSuppressed) !== 0,
    isPosted: item.isPosted !== undefined ? (Number(item.isPosted) !== 0) : true,
    isExcluded: Number(item.isExcluded) !== 0,
    bankDescription: item.bankDescription || undefined,
  }
}

export const historyApi = {
  getAll: async (query: HistoryQuery = {}): Promise<HistoryRow[]> => {
    const params = new URLSearchParams()
    if (query.startDate)  params.append('startDate', query.startDate)
    if (query.endDate)    params.append('endDate', query.endDate)
    if (query.accountId)  params.append('accountId', query.accountId)
    if (query.categoryId) params.append('categoryId', query.categoryId)
    if (query.limit !== undefined)  params.append('limit', String(query.limit))
    if (query.offset !== undefined) params.append('offset', String(query.offset))
    if (query.includeUnposted !== undefined)    params.append('includeUnposted', query.includeUnposted ? 'true' : 'false')
    if (query.includeSuppressed !== undefined)  params.append('includeSuppressed', query.includeSuppressed ? 'true' : 'false')
    if (query.includeExcluded !== undefined)    params.append('includeExcluded', query.includeExcluded ? 'true' : 'false')
    const response = await api.get(`/history?${params.toString()}`)
    return response.data.map(mapHistoryRow)
  },

  create: async (row: {
    transactionId?: string | null
    accountId: string
    categoryId: string
    date: string
    description: string
    amount: number
    type: 'income' | 'expense' | 'administrative'
    isTransfer?: boolean
    transferToAccountId?: string
    isSuppressed?: boolean
    isExcluded?: boolean
    isManualEdit?: boolean
    isPosted?: boolean
    bankDescription?: string
  }): Promise<HistoryRow> => {
    const response = await api.post('/history', row)
    return mapHistoryRow(response.data)
  },

  update: async (id: string, patch: Partial<{
    transactionId: string | null
    accountId: string
    categoryId: string
    date: string
    description: string
    amount: number
    type: 'income' | 'expense' | 'administrative'
    isTransfer?: boolean
    transferToAccountId?: string
    isSuppressed?: boolean
    isManualEdit?: boolean
    isPosted?: boolean
    isExcluded?: boolean
  }>): Promise<HistoryRow> => {
    const response = await api.put(`/history/${id}`, patch)
    return mapHistoryRow(response.data)
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    const response = await api.delete(`/history/${id}`)
    return response.data
  },

  reset: async (): Promise<{ success: boolean; message?: string }> => {
    const response = await api.post('/history/reset')
    return response.data
  },
}

export const preferencesApi = {
  getAll: async (): Promise<Record<string, string>> => {
    const response = await api.get('/preferences')
    return response.data
  },
  
  set: async (key: string, value: string): Promise<{ key: string; value: string }> => {
    const response = await api.post('/preferences', { key, value })
    return response.data
  },
}

export const healthApi = {
  check: async (): Promise<{ status: string; timestamp: string }> => {
    const response = await api.get('/health')
    return response.data
  },
}

export interface ImportRule {
  id: string
  transactionId: string | null
  accountId: string | null        // raw comma-separated string from DB
  accountIds: string[]            // parsed array (server-populated)
  restrictToAccount: boolean
  pattern: string
  categoryId: string
  isActive: boolean
  matchCount: number
  createdAt: string
  updatedAt: string
  transactionName?: string | null
  categoryName?: string | null
  accountName?: string | null     // name of first account (display only)
}

export interface RuleExamplesResult {
  examples: { bankDescription: string; accountId: string; amount: number; date: string }[]
  count: number
  suggestedPattern: string | null
  confidence: number | null
  existingRule: { id: string; pattern: string; isActive: boolean } | null
  /** All active rule patterns for this budget item — used client-side to filter session descriptions */
  existingRulePatterns: string[]
  suggestionsSuppressed: boolean
}

export const importApi = {
  preview: async (csv: string, accountId: string): Promise<{
    detectedColumns: { date: string | null; amount: string | null; description: string | null }
    rows: {
      date: string
      amount: number
      description: string
      isDuplicate: boolean
      ruleMatch: {
        ruleId: string
        transactionId: string | null
        categoryId: string
        pattern: string
        transactionName: string | null
      } | null
    }[]
    savedMapping: any
  }> => {
    const response = await api.post('/import/preview', { csv, accountId })
    return response.data
  },

  commit: async (payload: {
    accountId: string
    rows: {
      bankRow: { date: string; amount: number; description: string }
      budgetTransactionId?: string
      occurrenceDate?: string
      excluded?: boolean
      subRowEdits?: any[]
    }[]
    forecastOccurrences: { transactionId: string; date: string }[]
  }): Promise<{ success: boolean; committed: number }> => {
    const response = await api.post('/import/commit', payload)
    return response.data
  },
}

export const forecastApi = {
  getBalanceForecast: async (startDate?: string, endDate?: string): Promise<BalanceForecast[]> => {
    const params = new URLSearchParams()
    if (startDate) params.append('startDate', startDate)
    if (endDate) params.append('endDate', endDate)
    
    const response = await api.get(`/forecast/balance?${params.toString()}`)
    return response.data
  },
  
  getForecastTransactions: async (startDate?: string, endDate?: string): Promise<ForecastTransaction[]> => {
    const params = new URLSearchParams()
    if (startDate) params.append('startDate', startDate)
    if (endDate) params.append('endDate', endDate)
    
    const response = await api.get(`/forecast/transactions?${params.toString()}`)
    return response.data
  },
  
  getLowBalanceAnalysis: async (startDate?: string, endDate?: string): Promise<LowBalanceAnalysis[]> => {
    const params = new URLSearchParams()
    if (startDate) params.append('startDate', startDate)
    if (endDate) params.append('endDate', endDate)
    
    const response = await api.get(`/forecast/low-balance?${params.toString()}`)
    return response.data
  },
  
  addManualAdjustment: async (adjustment: {
    date: string
    amount: number
    description: string
    accountId: string
    categoryId?: string
  }): Promise<ForecastTransaction> => {
    const response = await api.post('/forecast/adjustments', adjustment)
    return response.data
  },
  
  removeManualAdjustment: async (id: string): Promise<void> => {
    await api.delete(`/forecast/adjustments/${id}`)
  },
  
  resetForecast: async (): Promise<void> => {
    await api.post('/forecast/reset')
  },
}

export const rulesApi = {
  getAll: async (): Promise<ImportRule[]> => {
    const response = await api.get('/rules')
    return response.data
  },

  create: async (rule: {
    transactionId?: string | null
    accountIds?: string[]
    restrictToAccount?: boolean
    pattern: string
    categoryId: string
  }): Promise<ImportRule> => {
    const response = await api.post('/rules', rule)
    return response.data
  },

  update: async (id: string, patch: Partial<{
    pattern: string
    restrictToAccount: boolean
    isActive: boolean
    accountIds: string[]
  }>): Promise<ImportRule> => {
    const response = await api.put(`/rules/${id}`, patch)
    return response.data
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    const response = await api.delete(`/rules/${id}`)
    return response.data
  },

  getExamples: async (transactionId: string): Promise<RuleExamplesResult> => {
    const response = await api.get(`/rules/examples?transactionId=${encodeURIComponent(transactionId)}`)
    return response.data
  },

  disableSuggestions: async (transactionId: string): Promise<{ success: boolean }> => {
    const response = await api.post('/rules/disable-suggestions', { transactionId })
    return response.data
  },

  suggestPattern: async (descriptions: string[]): Promise<{ pattern: string | null; confidence: number | null }> => {
    const response = await api.post('/rules/suggest-pattern', { descriptions })
    return response.data
  },

  suggestPatternDiscriminating: async (params: {
    positives: string[]
    sessionNegatives: string[]
    accountId: string
    transactionId: string
  }): Promise<{ pattern: string | null; confidence: number | null }> => {
    const response = await api.post('/rules/suggest-pattern-discriminating', params)
    return response.data
  },
}

export default api
