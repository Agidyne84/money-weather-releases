// Platform-Aware Database Service
// This is the single entry point for all data access in the application.
// At runtime, it detects whether we're running in a Capacitor native app (mobile)
// or in Electron/browser (desktop) and routes to the appropriate adapter.

import { Capacitor } from '@capacitor/core'
import * as desktop from './desktopAdapter'
import * as mobile from './mobileAdapter'

const isNative = Capacitor.isNativePlatform()

// Re-export types (identical in both adapters)
export type { HistoryRow, HistoryQuery, ImportRule, RuleExamplesResult } from './mobileAdapter'

// Re-export APIs from the platform-appropriate adapter
export const accountsApi = isNative ? mobile.accountsApi : desktop.accountsApi
export const categoriesApi = isNative ? mobile.categoriesApi : desktop.categoriesApi
export const transactionsApi = isNative ? mobile.transactionsApi : desktop.transactionsApi
export const historyApi = isNative ? mobile.historyApi : desktop.historyApi
export const preferencesApi = isNative ? mobile.preferencesApi : desktop.preferencesApi
export const healthApi = isNative ? mobile.healthApi : desktop.healthApi
export const importApi = isNative ? mobile.importApi : desktop.importApi
export const forecastApi = isNative ? mobile.forecastApi : desktop.forecastApi
export const rulesApi = isNative ? mobile.rulesApi : desktop.rulesApi
