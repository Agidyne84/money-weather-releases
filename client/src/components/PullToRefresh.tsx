import React, { useState, useRef, useCallback, useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { getCloudSyncSettings, checkCloudSyncStatus, pullCloudBackup, refreshLocalPreferences } from '../services/syncEngine'
import { getSessionPassphrase } from '../services/securePassphrase'

const isNative = Capacitor.isNativePlatform()
const PULL_THRESHOLD = 80 // px

interface PullToRefreshProps {
  children: React.ReactNode
  onRefresh?: () => void
}

/**
 * Wraps page content with a mobile-style pull-to-refresh gesture.
 * Only active on native platforms. When the user is at scrollTop 0 and
 * pulls down past the threshold, a spinner is shown and on release the
 * cloud backup is checked; if it is newer than local, a force pull runs.
 */
const PullToRefresh: React.FC<PullToRefreshProps> = ({ children, onRefresh }) => {
  const [pulling, setPulling] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [offset, setOffset] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const startY = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const doRefresh = useCallback(async () => {
    setRefreshing(true)
    setMessage(null)
    try {
      const settings = await getCloudSyncSettings()
      if (!settings.enabled || !settings.filePath) {
        setMessage('Cloud sync is not enabled')
        return
      }
      if (!getSessionPassphrase()) {
        setMessage('Unlock cloud sync password to refresh')
        return
      }
      const status = await checkCloudSyncStatus(settings.filePath)
      if (status === 'newer') {
        const result = await pullCloudBackup(settings.filePath)
        if (result.success) {
          await refreshLocalPreferences()
          window.dispatchEvent(new CustomEvent('sync:pulled', { detail: result }))
          setMessage('Pulled latest backup from cloud')
        } else {
          setMessage('Pull failed')
        }
      } else if (status === 'older') {
        setMessage('Local changes are newer — pushing instead')
        window.dispatchEvent(new CustomEvent('sync:dirty'))
      } else if (status === 'same') {
        setMessage('Already up to date')
      } else if (status === 'missing') {
        setMessage('Cloud backup file not found')
      } else {
        setMessage('Could not check cloud backup status')
      }
    } catch (err) {
      console.error('[PullToRefresh] refresh failed:', err)
      setMessage(err instanceof Error ? err.message : 'Refresh failed')
    } finally {
      setRefreshing(false)
      onRefresh?.()
      // Auto-hide message after 2 seconds
      setTimeout(() => setMessage(null), 2000)
    }
  }, [onRefresh])

  useEffect(() => {
    if (!isNative) return
    const container = containerRef.current
    if (!container) return

    const onTouchStart = (e: TouchEvent) => {
      if (container.scrollTop > 0) return
      startY.current = e.touches[0].clientY
      setPulling(true)
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!pulling) return
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
      if (!pulling) return
      setPulling(false)
      if (offset >= PULL_THRESHOLD) {
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
  }, [pulling, offset, doRefresh])

  // Desktop: no pull-to-refresh, just render children
  if (!isNative) {
    return <>{children}</>
  }

  return (
    <div ref={containerRef} className="relative overflow-y-auto h-full" style={{ touchAction: 'pan-y' }}>
      {/* Pull indicator */}
      <div
        className="absolute left-0 right-0 flex flex-col items-center justify-center text-blue-600 transition-all duration-150"
        style={{
          top: -60 + offset,
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
              className={`h-6 w-6 transition-transform duration-200 ${offset >= PULL_THRESHOLD ? 'rotate-180' : ''}`}
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7-7-7" />
            </svg>
            <span className="text-xs font-medium mt-1">
              {offset >= PULL_THRESHOLD ? 'Release to refresh' : 'Pull down to refresh'}
            </span>
          </>
        )}
      </div>

      {/* Message toast */}
      {message && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-xs px-3 py-1.5 rounded-full shadow-lg">
          {message}
        </div>
      )}

      <div style={{ marginTop: offset }}>{children}</div>
    </div>
  )
}

export default PullToRefresh
