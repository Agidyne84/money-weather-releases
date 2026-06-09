// Desktop Adapter — Re-exports the existing REST API layer with dirty tracking.
// When running in Electron or browser (desktop), all database calls go through
// the local Express server via axios. Write operations mark the dirty flag so
// the cloud sync engine knows local data has changed.

import {
  accountsApi as rawAccounts,
  categoriesApi as rawCategories,
  transactionsApi as rawTransactions,
  historyApi as rawHistory,
  preferencesApi as rawPreferences,
  importApi as rawImport,
  forecastApi as rawForecast,
  rulesApi as rawRules,
  healthApi as rawHealth,
} from '../api'
import { markDirty } from '../dirtyTracker'

function wrapWrites<T extends Record<string, (...args: any[]) => Promise<any>>>(
  api: T,
  writeKeys: (keyof T)[]
): T {
  const wrapped = { ...api }
  for (const key of writeKeys) {
    const original = wrapped[key] as (...args: any[]) => Promise<any>
    wrapped[key] = ((...args: any[]) => {
      markDirty()
      return original(...args)
    }) as T[keyof T]
  }
  return wrapped
}

export const accountsApi = wrapWrites(rawAccounts, ['create', 'update', 'delete'])
export const categoriesApi = wrapWrites(rawCategories, ['create', 'update', 'delete'])
export const transactionsApi = wrapWrites(rawTransactions, ['create', 'update', 'delete'])
export const historyApi = wrapWrites(rawHistory, ['create', 'update', 'delete', 'reset'])
export const preferencesApi = wrapWrites(rawPreferences, ['set'])
export const importApi = wrapWrites(rawImport, ['commit'])
export const forecastApi = wrapWrites(rawForecast, ['addManualAdjustment', 'removeManualAdjustment', 'resetForecast'])
export const rulesApi = wrapWrites(rawRules, ['create', 'update', 'delete', 'disableSuggestions'])
export const healthApi = rawHealth

export type { HistoryRow, HistoryQuery, ImportRule, RuleExamplesResult } from '../api'
