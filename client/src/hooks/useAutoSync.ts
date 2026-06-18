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
 * periodically checks the cloud backup and syncs if needed:
 *  - Pulls if the cloud backup is newer.
 *  - Pushes if local data is dirty or the cloud backup is older/missing.
 *
 * Respects the app lock state: pauses entirely while locked.
 * Also pauses (slows down) when the browser tab/app is backgrounded.
 */
export function useAutoSync(locked: boolean) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visibleRef = useRef(true)

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

      try {
        const result = await performSync(settings.filePath)
        if (result.action !== 'none') {
          console.log('[AutoSync]', result.action, result.message)
        }
      } catch (err) {
        console.error('[AutoSync] Error:', err)
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
