import axios from 'axios'
import { 
  Account, 
  Category, 
  Transaction, 
  TransactionFormData, 
  AccountFormData, 
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
    
    // Transform flat API response to Category objects
    return response.data.map((item: any): Category => ({
      id: item.id,
      name: item.name,
      parentId: item.parentId || undefined,
      color: item.color,
      sortOrder: item.sortOrder,
      createdAt: item.createdAt
    }))
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
  archivedAt?: string
  sourceTransactionName?: string | null
  isManualEdit?: boolean
  isSuppressed?: boolean
  isPosted?: boolean
}

export interface HistoryQuery {
  startDate?: string
  endDate?: string
  accountId?: string
  categoryId?: string
  limit?: number
  offset?: number
  includeUnposted?: boolean
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
    archivedAt: item.archivedAt,
    sourceTransactionName: item.sourceTransactionName ?? null,
    isManualEdit: Boolean(item.isManualEdit),
    isSuppressed: Boolean(item.isSuppressed),
    isPosted: item.isPosted !== undefined ? Boolean(item.isPosted) : true,
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
    if (query.includeUnposted)    params.append('includeUnposted', 'true')
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
    isSuppressed?: boolean
    isManualEdit?: boolean
    isPosted?: boolean
  }): Promise<HistoryRow> => {
    const response = await api.post('/history', row)
    return mapHistoryRow(response.data)
  },

  update: async (id: string, patch: Partial<{
    accountId: string
    categoryId: string
    date: string
    description: string
    amount: number
    type: 'income' | 'expense' | 'administrative'
    isManualEdit?: boolean
    isPosted?: boolean
  }>): Promise<HistoryRow> => {
    const response = await api.put(`/history/${id}`, patch)
    return mapHistoryRow(response.data)
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    const response = await api.delete(`/history/${id}`)
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

export default api
