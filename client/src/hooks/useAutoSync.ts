import { useEffect, useRef } from 'react'
import {
  getCloudSyncSettings,
  checkCloudSyncStatus,
  performSync,
} from '../services/syncEngine'
import { getSessionPassphrase } from '../services/securePassphrase'
import { isDirty } from '../services/dirtyTracker'

const POLL_INTERVAL = 15000 // 15 seconds normal
const DIRTY_POLL_INTERVAL = 3000 // 3 seconds when local data is dirty
const BACKGROUND_POLL_INTERVAL = 60000 // 60 seconds when tab is hidden

/**
 * Background auto-sync hook.
 * When cloud sync is set to 'auto' mode and the app is unlocked,
 * periodically checks the cloud backup:
 *  - If the cloud backup is newer, dispatches a 'sync:conflict' event
 *    so the UI can prompt the user to Accept (pull) or Reject (push local).
 *  - Pushes if local data is dirty or the cloud backup is older/missing.
 *
 * Respects the app lock state: pauses entirely while locked.
 * Also pauses (slows down) when the browser tab/app is backgrounded.
 */
export function useAutoSync(locked: boolean) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visibleRef = useRef(true)
  const conflictRef = useRef(false) // prevents duplicate conflict events

  useEffect(() => {
    if (locked) {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      return
    }

    let cancelled = false

    const tick = async () => {
      if (cancelled) return

      const settings = await getCloudSyncSettings()
      if (!settings.enabled || settings.syncMode !== 'auto' || !settings.filePath) {
        timerRef.current = setTimeout(tick, POLL_INTERVAL)
        return
      }

      const passphrase = getSessionPassphrase()
      if (!passphrase) {
        timerRef.current = setTimeout(tick, POLL_INTERVAL)
        return
      }

      // If the cloud file is missing, skip syncing until the user fixes it
      const status = await checkCloudSyncStatus(settings.filePath)
      if (status === 'missing') {
        timerRef.current = setTimeout(tick, POLL_INTERVAL)
        return
      }

      // If cloud is newer and we haven't already fired a conflict event,
      // dispatch one so the UI can prompt the user.
      if (status === 'newer' && !conflictRef.current) {
        conflictRef.current = true
        window.dispatchEvent(new CustomEvent('sync:conflict', {
          detail: { filePath: settings.filePath },
        }))
        console.log('[AutoSync] Conflict detected — waiting for user action')
        timerRef.current = setTimeout(tick, POLL_INTERVAL)
        return
      }

      // If conflict was resolved (or cloud changed), reset the flag
      if (status !== 'newer' && conflictRef.current) {
        conflictRef.current = false
      }

      // Only auto-push when local is dirty or cloud is older/missing.
      // Never silently pull — that requires explicit user approval.
      if (status === 'older' || status === 'same' || isDirty()) {
        try {
          const result = await performSync(settings.filePath)
          if (result.action !== 'none') {
            console.log('[AutoSync]', result.action, result.message)
          }
        } catch (err) {
          console.error('[AutoSync] Error:', err)
        }
      }

      const interval = visibleRef.current
        ? isDirty()
          ? DIRTY_POLL_INTERVAL
          : POLL_INTERVAL
        : BACKGROUND_POLL_INTERVAL

      timerRef.current = setTimeout(tick, interval)
    }

    timerRef.current = setTimeout(tick, POLL_INTERVAL)

    const handleVisibilityChange = () => {
      visibleRef.current = document.visibilityState === 'visible'
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [locked])
}
