import React, { useState, useRef, useCallback, useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { getCloudSyncSettings, pullCloudBackup, refreshLocalPreferences } from '../services/syncEngine'
import { getSessionPassphrase, hasStoredPassphrase, unlockPassphraseFromSecureStorage } from '../services/securePassphrase'
import { closeDatabase } from '../services/database/mobileDb'

const isNative = Capacitor.isNativePlatform()
const PULL_THRESHOLD = 80 // px
const WHEEL_IDLE_RESET_MS = 350 // desktop: settle time after the wheel stops moving

interface PullToRefreshProps {
  children: React.ReactNode
  onRefresh?: () => void
}

/**
 * Wraps page content with a pull-to-refresh gesture.
 * Mobile: touch drag down from scrollTop 0.
 * Desktop: scroll to the top of the page, then keep scrolling up (wheel) past it.
 * Past the threshold, a spinner is shown and a force pull runs against the cloud backup.
 */
const PullToRefresh: React.FC<PullToRefreshProps> = ({ children, onRefresh }) => {
  const [refreshing, setRefreshing] = useState(false)
  const [offsetDisplay, setOffsetDisplay] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const startY = useRef(0)
  const pullingRef = useRef(false)
  const offsetRef = useRef(0)
  const refreshingRef = useRef(false)
  const wheelIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const setOffset = (value: number) => {
    offsetRef.current = value
    setOffsetDisplay(value)
  }

  const doRefresh = useCallback(async () => {
    if (refreshingRef.current) return
    refreshingRef.current = true
    setRefreshing(true)
    setMessage(null)
    try {
      const settings = await getCloudSyncSettings()
      if (!settings.enabled || !settings.filePath) {
        setMessage('Cloud sync is not enabled')
        return
      }
      // Pull-to-refresh is explicitly a force pull from cloud. It should always
      // restore the latest cloud backup, not skip because local changes have not
      // been pushed. If local changes need to be preserved the user should force
      // push from Settings first.

      // Recover the passphrase from secure storage if it isn't already in session memory.
      // Without this, a sync shortly after app unlock can fail with a password prompt
      // even though the app is already unlocked.
      if (!getSessionPassphrase() && (await hasStoredPassphrase())) {
        const recovered = await unlockPassphraseFromSecureStorage()
        console.log('[PullToRefresh] Passphrase recovery from secure storage:', recovered)
      }

      const result = await pullCloudBackup(settings.filePath)
      if (result.success) {
        await refreshLocalPreferences()
        window.dispatchEvent(new CustomEvent('sync:pulled', { detail: result }))
        setMessage('Pulled latest backup from cloud')
        // Reload the app so every page re-reads the freshly pulled data. Individual
        // pages only listened for 'sync:pulled' to refresh a few preference values,
        // not the full accounts/transactions/budget data, so pulled changes were
        // invisible until the user manually navigated away and back. Close the native
        // DB before tearing down the webview so the reloaded page opens a fresh
        // connection and actually sees the pulled data.
        setTimeout(async () => {
          try { await closeDatabase() } catch (e) { console.warn('[PullToRefresh] closeDatabase before reload failed:', e) }
          window.location.reload()
        }, 1200)
      } else {
        setMessage('Pull failed')
      }
    } catch (err) {
      console.error('[PullToRefresh] refresh failed:', err)
      setMessage(err instanceof Error ? err.message : 'Refresh failed')
    } finally {
      refreshingRef.current = false
      setRefreshing(false)
      onRefresh?.()
      // Auto-hide message after 2 seconds
      setTimeout(() => setMessage(null), 2000)
    }
  }, [onRefresh])

  // Mobile: touch drag gesture on the scrollable content container
  useEffect(() => {
    if (!isNative) return
    const container = containerRef.current
    if (!container) return

    const onTouchStart = (e: TouchEvent) => {
      if (container.scrollTop > 0) return
      startY.current = e.touches[0].clientY
      pullingRef.current = true
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!pullingRef.current) return
      const y = e.touches[0].clientY
      const delta = y - startY.current
      if (delta > 0) {
        // Dampen the pull so it doesn't fly off screen
        setOffset(Math.min(delta * 0.5, 120))
        if (container.scrollTop <= 0) {
          e.preventDefault()
        }
      }
    }

    const onTouchEnd = () => {
      if (!pullingRef.current) return
      pullingRef.current = false
      if (offsetRef.current >= PULL_THRESHOLD) {
        doRefresh()
      }
      setOffset(0)
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('touchend', onTouchEnd)
    container.addEventListener('touchcancel', onTouchEnd)

    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
      container.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [doRefresh])

  // Desktop: wheel gesture — scroll to the top of the page, then keep scrolling up
  useEffect(() => {
    if (isNative) return

    const isAtTop = () => (document.scrollingElement?.scrollTop ?? window.scrollY) <= 0

    const onWheel = (e: WheelEvent) => {
      if (refreshingRef.current) return
      if (e.deltaY >= 0) {
        // Scrolling down (or no vertical movement) — cancel any in-progress pull.
        if (offsetRef.current > 0) setOffset(0)
        return
      }
      if (!isAtTop()) {
        if (offsetRef.current > 0) setOffset(0)
        return
      }
      // Scrolling up while already at the top — accumulate the pull.
      e.preventDefault()
      setOffset(Math.min(offsetRef.current + -e.deltaY * 0.5, 120))

      if (wheelIdleTimer.current) clearTimeout(wheelIdleTimer.current)
      wheelIdleTimer.current = setTimeout(() => {
        if (offsetRef.current >= PULL_THRESHOLD) {
          doRefresh()
        } else {
          setOffset(0)
        }
      }, WHEEL_IDLE_RESET_MS)
    }

    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('wheel', onWheel)
      if (wheelIdleTimer.current) clearTimeout(wheelIdleTimer.current)
    }
  }, [doRefresh])

  return (
    <div
      ref={containerRef}
      className={isNative ? 'relative overflow-y-auto h-full' : 'relative'}
      style={isNative ? { touchAction: 'pan-y' } : undefined}
    >
      {/* Pull indicator */}
      <div
        className="fixed left-0 right-0 flex flex-col items-center justify-center text-blue-600 transition-all duration-150 z-40"
        style={{
          top: -60 + offsetDisplay,
          height: 60,
        }}
      >
        {refreshing ? (
          <svg className="animate-spin h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        ) : (
          <>
            <svg
              className={`h-6 w-6 transition-transform duration-200 ${offsetDisplay >= PULL_THRESHOLD ? 'rotate-180' : ''}`}
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7-7-7" />
            </svg>
            <span className="text-xs font-medium mt-1">
              {offsetDisplay >= PULL_THRESHOLD ? 'Release to refresh' : 'Pull down to refresh'}
            </span>
          </>
        )}
      </div>

      {/* Message toast */}
      {message && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-xs px-3 py-1.5 rounded-full shadow-lg">
          {message}
        </div>
      )}

      <div style={{ marginTop: offsetDisplay }}>{children}</div>
    </div>
  )
}

export default PullToRefresh
