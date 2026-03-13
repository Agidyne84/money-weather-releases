// Shared types between client and server

export interface Transaction {
  id: string
  date: string
  description: string
  amount: number
  category_id: string
  type: 'income' | 'expense'
  is_recurring: boolean
  recurring_frequency?: 'daily' | 'weekly' | 'monthly' | 'yearly'
  created_at?: string
  updated_at?: string
}

export interface Category {
  id: string
  name: string
  color: string
  created_at?: string
}

export interface Budget {
  id: string
  month: number
  year: number
  total_income: number
  total_expenses: number
  created_at?: string
  updated_at?: string
}

export interface BudgetCategory {
  id: string
  budget_id: string
  category_id: string
  budgeted_amount: number
  created_at?: string
}

export interface Forecast {
  id: string
  month: number
  year: number
  projected_income: number
  projected_expenses: number
  projected_net_income: number
  confidence: number
  created_at?: string
}

export interface ForecastChokepoint {
  id: string
  forecast_id: string
  category_id: string
  severity: 'low' | 'medium' | 'high'
  description: string
  projected_overrun: number
  recommendations: string[]
  created_at?: string
}

export interface UserPreferences {
  currency: string
  date_format: string
  start_of_month: number
  forecast_months: number
}

export interface ExportData {
  exported_at: string
  version: string
  data: {
    transactions: Transaction[]
    categories: Category[]
  }
}

export interface ImportResult {
  success: boolean
  imported: {
    transactions: number
    categories: number
  }
  error?: string
}
