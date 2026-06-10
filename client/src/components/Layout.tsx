import React, { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import ConnectionStatus from './ConnectionStatus'
import ScrollToTop from './ScrollToTop'
import MobileBottomNav from './MobileBottomNav'
import AppLock from './AppLock'
import FirstTimeLockSetup from './FirstTimeLockSetup'
import MobileUpdatePrompt from './MobileUpdatePrompt'
import AppVersion from './AppVersion'
import { isLockEnabled, isLockSetupComplete } from '../services/lockService'
import { getCloudSyncSettings, checkCloudSyncStatus, performSync } from '../services/syncEngine'
import { isDirty } from '../services/dirtyTracker'
import { getSessionPassphrase } from '../services/securePassphrase'

function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform()
}

interface UpdateProgress {
  percent: number
  transferred: number
  total: number
}

const UpdateStatus: React.FC = () => {
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [downloaded, setDownloaded] = useState(false)

  useEffect(() => {
    const api = (window as any).electronAPI
    if (!api) return

    const handleProgress = (_: any, data: UpdateProgress) => setProgress(data)
    const handleDone = () => { setProgress(null); setDownloaded(true) }

    api.onUpdateDownloadProgress?.(handleProgress)
    api.onUpdateDownloaded?.(handleDone)
    // No cleanup needed — these run for app lifetime
  }, [])

  if (downloaded) {
    return (
      <div className="px-4 py-1 bg-green-50 border-b border-green-200 text-center">
        <span className="text-xs text-green-700 font-medium">Update downloaded — restart the app to apply it</span>
      </div>
    )
  }

  if (!progress) return null

  return (
    <div className="px-4 py-1 bg-blue-50 border-b border-blue-200">
      <div className="max-w-7xl mx-auto flex items-center gap-2">
        <span className="text-xs text-blue-700 font-medium">Downloading update… {progress.percent}%</span>
        <div className="flex-1 h-1.5 bg-blue-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 rounded-full transition-all duration-300"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      </div>
    </div>
  )
}

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation()
  const [locked, setLocked] = useState(false)
  const [lockReady, setLockReady] = useState(false)
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null)

  useEffect(() => {
    let backgroundedAt: number | null = null

    const init = async () => {
      const complete = await isLockSetupComplete()
      setSetupComplete(complete)
      if (complete) {
        const enabled = await isLockEnabled()
        console.log('[Layout] isLockEnabled =', enabled)
        if (enabled) setLocked(true)
      }
      setLockReady(true)

      // After lock init, check cloud sync status
      if (!locked) {
        try {
          const syncSettings = await getCloudSyncSettings()
          if (syncSettings.enabled && syncSettings.filePath) {
            const status = await checkCloudSyncStatus(syncSettings.filePath)
            if (status === 'newer') {
              const wantsSync = window.confirm(
                'A newer cloud backup was found. Would you like to sync now?'
              )
              if (wantsSync) {
                const passphrase = getSessionPassphrase()
                if (passphrase) {
                  await performSync(syncSettings.filePath)
                  window.alert('Cloud sync completed successfully.')
                } else {
                  window.alert('Please enter your PIN to unlock the cloud sync password in Setup > Cloud Sync.')
                }
              }
            }
          }
        } catch (e) {
          console.error('[Layout] Cloud sync check failed:', e)
        }
      }
    }
    init()

    // Prompt to save on close if dirty
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty()) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    // Track background time and re-lock after 5+ minutes of inactivity (native only)
    const handleVisibilityChange = () => {
      if (!isNativePlatform()) return
      if (document.visibilityState === 'hidden') {
        backgroundedAt = Date.now()
        console.log('[Layout] App backgrounded at', backgroundedAt)
      } else if (document.visibilityState === 'visible') {
        console.log('[Layout] App resumed. backgroundedAt =', backgroundedAt)
        if (backgroundedAt) {
          const elapsedMinutes = (Date.now() - backgroundedAt) / (1000 * 60)
          console.log('[Layout] Minutes in background:', elapsedMinutes)
          if (elapsedMinutes > 5) {
            console.log('[Layout] Re-locking app (5+ min in background)')
            isLockEnabled().then((enabled) => {
              if (enabled) setLocked(true)
            })
          }
          backgroundedAt = null
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  const handleUnlock = () => setLocked(false)

  const handleSetupComplete = () => {
    setSetupComplete(true)
    // App unlocks immediately after PIN creation — user already authenticated
  }

  const isActive = (path: string) => location.pathname === path

  return (
    <div className="min-h-screen bg-gray-50">
      {setupComplete === false && <FirstTimeLockSetup onComplete={handleSetupComplete} />}
      {lockReady && locked && <AppLock onUnlock={handleUnlock} />}

      <UpdateStatus />
      {isNativePlatform() && <MobileUpdatePrompt />}
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex flex-col justify-center">
              <h1 className="text-xl font-bold text-gray-900 leading-tight">Money Weather</h1>
              {!isNativePlatform() && (
                <p className="text-xs text-gray-500 leading-tight">A complete budgeting app which forecasts future transactions to help identify and resolve low balance periods</p>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Desktop Navigation */}
      {!isNativePlatform() && (
        <nav className="bg-white shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex space-x-6 overflow-x-auto whitespace-nowrap scrollbar-hide">
              <Link
                to="/"
                className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                  isActive('/')
                    ? 'border-blue-500 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Dashboard
              </Link>
              <Link
                to="/budget"
                className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                  isActive('/budget')
                    ? 'border-blue-500 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Budget
              </Link>
              <Link
                to="/forecast"
                className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                  isActive('/forecast')
                    ? 'border-blue-500 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Forecast
              </Link>
              <Link
                to="/history"
                className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                  isActive('/history')
                    ? 'border-blue-500 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                History
              </Link>
              <Link
                to="/setup"
                className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                  isActive('/setup')
                    ? 'border-blue-500 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Setup
              </Link>
            </div>
          </div>
        </nav>
      )}

      {/* Main Content */}
      <main className={`max-w-7xl mx-auto py-2 sm:px-6 lg:px-8 ${isNativePlatform() ? 'pb-28' : ''}`}>
        <div className="px-4 py-2 sm:px-0">
          {children}
        </div>
        {isNativePlatform() && <AppVersion />}
      </main>

      {!isNativePlatform() && <ConnectionStatus />}

      {isNativePlatform() && <MobileBottomNav />}

      <ScrollToTop />
    </div>
  )
}

export default Layout
