import { useEffect, useRef } from 'react'
import {
  getCloudSyncSettings,
  checkCloudSyncStatus,
  performSync,
} from '../services/syncEngine'
import { getSessionPassphrase } from '../services/securePassphrase'
import { isDirty } from '../services/dirtyTracker'

const POLL_INTERVAL = 15000 // 15 seconds normal
const DIRTY_POLL_INTERVAL = 2000 // 2 seconds when local data is dirty
const BACKGROUND_POLL_INTERVAL = 60000 // 60 seconds when tab is hidden
const IMMEDIATE_SYNC_DEBOUNCE = 100 // 100ms debounce after a local change

/**
 * Background auto-sync hook.
 * When cloud sync is set to 'auto' mode and the app is unlocked,
 * keeps the local data and cloud backup in sync:
 *  - Pushes shortly after any local change.
 *  - Pulls automatically when the cloud backup is detected as newer.
 *
 * Respects the app lock state: pauses entirely while locked.
 * Also pauses (slows down) when the browser tab/app is backgrounded.
 */
export function useAutoSync(locked: boolean) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visibleRef = useRef(true)
  const dirtyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (locked) {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (dirtyDebounceRef.current) {
        clearTimeout(dirtyDebounceRef.current)
        dirtyDebounceRef.current = null
      }
      return
    }

    let cancelled = false

    const syncIfReady = async () => {
      if (cancelled) return

      const settings = await getCloudSyncSettings()
      if (!settings.enabled || settings.syncMode !== 'auto' || !settings.filePath) return

      const passphrase = getSessionPassphrase()
      if (!passphrase) {
        console.log('[AutoSync] No session passphrase available, skipping sync')
        return
      }

      let status: 'newer' | 'older' | 'same' | 'missing' | 'error'
      try {
        status = await checkCloudSyncStatus(settings.filePath)
      } catch (err) {
        console.error('[AutoSync] checkCloudSyncStatus failed:', err)
        // If local is dirty, we still want to attempt a push rather than drop the change.
        status = isDirty() ? 'older' : 'error'
      }
      console.log('[AutoSync] status:', status, 'dirty:', isDirty())

      try {
        const result = await performSync(settings.filePath)
        if (result.action !== 'none') {
          console.log('[AutoSync]', result.action, result.message)
        } else {
          console.log('[AutoSync] no action needed')
        }
      } catch (err) {
        console.error('[AutoSync] Error:', err)
      }
    }

    const tick = async () => {
      if (cancelled) return
      await syncIfReady()

      const interval = visibleRef.current
        ? isDirty()
          ? DIRTY_POLL_INTERVAL
          : POLL_INTERVAL
        : BACKGROUND_POLL_INTERVAL

      timerRef.current = setTimeout(tick, interval)
    }

    timerRef.current = setTimeout(tick, POLL_INTERVAL)

    const handleDirty = () => {
      if (dirtyDebounceRef.current) clearTimeout(dirtyDebounceRef.current)
      dirtyDebounceRef.current = setTimeout(() => {
        dirtyDebounceRef.current = null
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = null
        syncIfReady().finally(() => {
          if (!cancelled) {
            timerRef.current = setTimeout(tick, POLL_INTERVAL)
          }
        })
      }, IMMEDIATE_SYNC_DEBOUNCE)
    }

    const handleVisibilityChange = () => {
      visibleRef.current = document.visibilityState === 'visible'
    }

    window.addEventListener('sync:dirty', handleDirty)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
      if (dirtyDebounceRef.current) clearTimeout(dirtyDebounceRef.current)
      window.removeEventListener('sync:dirty', handleDirty)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [locked])
}
