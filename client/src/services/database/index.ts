// Platform-Aware Database Service
// This is the single entry point for all data access in the application.
// At runtime, it detects whether we're running in a Capacitor native app (mobile)
// or in Electron/browser (desktop) and routes to the appropriate adapter.
// Platform detection is done lazily on each call to avoid race conditions
// where Capacitor bridge isn't ready at module load time.

import { Capacitor } from '@capacitor/core'
import * as desktop from './desktopAdapter'
import * as mobile from './mobileAdapter'

function getAdapter() {
  return Capacitor.isNativePlatform() ? mobile : desktop
}

// Re-export types (identical in both adapters)
export type { HistoryRow, HistoryQuery, ImportRule, RuleExamplesResult } from './mobileAdapter'

// Re-export APIs via lazy proxies so platform is detected at call time
export const accountsApi = new Proxy({} as typeof mobile.accountsApi, {
  get(_, prop) { return getAdapter().accountsApi[prop as keyof typeof mobile.accountsApi] }
})
export const categoriesApi = new Proxy({} as typeof mobile.categoriesApi, {
  get(_, prop) { return getAdapter().categoriesApi[prop as keyof typeof mobile.categoriesApi] }
})
export const transactionsApi = new Proxy({} as typeof mobile.transactionsApi, {
  get(_, prop) { return getAdapter().transactionsApi[prop as keyof typeof mobile.transactionsApi] }
})
export const historyApi = new Proxy({} as typeof mobile.historyApi, {
  get(_, prop) { return getAdapter().historyApi[prop as keyof typeof mobile.historyApi] }
})
export const preferencesApi = new Proxy({} as typeof mobile.preferencesApi, {
  get(_, prop) { return getAdapter().preferencesApi[prop as keyof typeof mobile.preferencesApi] }
})
export const healthApi = new Proxy({} as typeof mobile.healthApi, {
  get(_, prop) { return getAdapter().healthApi[prop as keyof typeof mobile.healthApi] }
})
export const importApi = new Proxy({} as typeof mobile.importApi, {
  get(_, prop) { return getAdapter().importApi[prop as keyof typeof mobile.importApi] }
})
export const forecastApi = new Proxy({} as typeof mobile.forecastApi, {
  get(_, prop) { return getAdapter().forecastApi[prop as keyof typeof mobile.forecastApi] }
})
export const rulesApi = new Proxy({} as typeof mobile.rulesApi, {
  get(_, prop) { return getAdapter().rulesApi[prop as keyof typeof mobile.rulesApi] }
})
