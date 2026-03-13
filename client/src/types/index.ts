export interface Transaction {
  id: string
  date: string
  description: string
  amount: number
  category: string
  type: 'income' | 'expense'
  isRecurring: boolean
  recurringFrequency?: 'daily' | 'weekly' | 'monthly' | 'yearly'
}

export interface Category {
  id: string
  name: string
  budget: number
  color: string
}

export interface Budget {
  id: string
  month: string
  year: number
  categories: BudgetCategory[]
  totalIncome: number
  totalExpenses: number
  netIncome: number
}

export interface BudgetCategory {
  categoryId: string
  budgeted: number
  actual: number
  remaining: number
}

export interface Forecast {
  id: string
  month: string
  year: number
  projectedIncome: number
  projectedExpenses: number
  projectedNetIncome: number
  confidence: number
  chokepoints: Chokepoint[]
}

export interface Chokepoint {
  category: string
  severity: 'low' | 'medium' | 'high'
  description: string
  projectedOverrun: number
  recommendations: string[]
}

export interface UserPreferences {
  currency: string
  dateFormat: string
  startOfMonth: number
  forecastMonths: number
}
