// Shared types between client and server

export interface Account {
  id: string
  name: string
  type: 'checking' | 'savings' | 'credit' | 'investment'
  starting_balance: number
  current_balance: number
  include_in_low_balance_analysis: boolean
  import_settings?: string // JSON string
  created_at?: string
  updated_at?: string
}

export interface Category {
  id: string
  name: string
  parent_id?: string
  color: string
  sort_order: number
  created_at?: string
}

export interface Transaction {
  id: string
  name: string
  amount: number
  frequency_value: number
  frequency_unit: 'days' | 'weeks' | 'months' | 'years' | 'custom'
  custom_frequency_pattern?: string
  start_date: string // ISO date string
  end_date?: string
  pause_start_date?: string
  pause_end_date?: string
  category_id: string
  account_id: string
  type: 'income' | 'expense'
  is_active: boolean
  created_at?: string
  updated_at?: string
}

export interface ForecastOverride {
  id: string
  transaction_id: string
  date: string
  original_amount: number
  override_amount: number
  is_posted: boolean
  notes?: string
  created_at?: string
  updated_at?: string
}

export interface TransactionRule {
  id: string
  account_id: string
  pattern: string
  category_id: string
  confidence: number
  match_count: number
  created_at?: string
}

export interface HistoricalTransaction {
  id: string
  transaction_id?: string
  account_id: string
  category_id: string
  date: string
  description: string
  amount: number
  type: 'income' | 'expense'
  archived_at: string
}

export interface UserPreference {
  key: string
  value: string
  updated_at?: string
}

export interface ForecastTransaction {
  id: string
  transaction_id: string
  date: string
  description: string
  amount: number
  type: 'income' | 'expense'
  category_id: string
  category_name: string
  category_color: string
  account_id: string
  account_name: string
  is_override: boolean
  is_posted: boolean
  original_amount?: number
}

export interface BalanceForecast {
  date: string
  account_balances: {
    account_id: string
    account_name: string
    balance: number
    change: number
  }[]
  total_balance: number
  net_worth: number
  lowest_balance_accounts: {
    account_id: string
    account_name: string
    balance: number
    rank: number
  }[]
}

export interface ImportSettings {
  date_format: string
  has_headers: boolean
  column_mapping: {
    date: number
    amount: number
    description: number
  }
}

export interface ImportedTransaction {
  date: string
  description: string
  amount: number
  suggested_category_id?: string
  suggested_category_name?: string
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

// Database row types (snake_case)
export interface DatabaseAccount {
  id: string
  name: string
  type: string
  starting_balance: number
  current_balance: number
  include_in_low_balance_analysis: number // 0 or 1
  import_settings?: string
  created_at: string
  updated_at: string
}

export interface DatabaseCategory {
  id: string
  name: string
  parent_id?: string
  color: string
  sort_order: number
  created_at: string
}

export interface DatabaseTransaction {
  id: string
  name: string
  amount: number
  frequency_value: number
  frequency_unit: string
  custom_frequency_pattern?: string
  start_date: string
  end_date?: string
  pause_start_date?: string
  pause_end_date?: string
  category_id: string
  account_id: string
  type: string
  is_active: number // 0 or 1
  created_at: string
  updated_at: string
}
