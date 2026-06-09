import React, { useState, useEffect, useCallback } from 'react'
import {
  checkForMobileUpdate,
  canInstallPackages,
  openInstallPermissionSettings,
  downloadAndInstallUpdate,
  getDownloadStatus,
  skipVersion,
  type MobileVersionInfo,
} from '../services/otaUpdate'

interface UpdateState {
  checking: boolean
  available: boolean
  info?: MobileVersionInfo
  currentVersion?: string
  downloading: boolean
  downloadProgress: number
  needsPermission: boolean
  error: string | null
}

const POLL_INTERVAL = 2000 // ms

const MobileUpdatePrompt: React.FC = () => {
  const [state, setState] = useState<UpdateState>({
    checking: true,
    available: false,
    downloading: false,
    downloadProgress: 0,
    needsPermission: false,
    error: null,
  })

  const check = useCallback(async () => {
    const result = await checkForMobileUpdate()
    setState((prev) => ({
      ...prev,
      checking: false,
      available: result.available,
      info: result.info,
      currentVersion: result.currentVersion,
    }))
  }, [])

  useEffect(() => {
    check()
  }, [check])

  const handleUpdate = async () => {
    if (!state.info) return
    setState((prev) => ({ ...prev, error: null }))

    const canInstall = await canInstallPackages()
    if (!canInstall) {
      setState((prev) => ({ ...prev, needsPermission: true }))
      return
    }

    setState((prev) => ({ ...prev, downloading: true, downloadProgress: 0 }))

    try {
      await downloadAndInstallUpdate(state.info.downloadUrl)

      // Poll download status
      const interval = setInterval(async () => {
        try {
          const status = await getDownloadStatus()
          if (status.totalBytes > 0) {
            const pct = Math.round((status.bytesDownloaded / status.totalBytes) * 100)
            setState((prev) => ({ ...prev, downloadProgress: pct }))
          }

          if (status.statusText === 'success') {
            clearInterval(interval)
            setState((prev) => ({ ...prev, downloading: false, downloadProgress: 100 }))
            // Android install dialog will appear automatically
          } else if (status.statusText === 'failed') {
            clearInterval(interval)
            setState((prev) => ({
              ...prev,
              downloading: false,
              error: 'Download failed. Please try again.',
            }))
          }
        } catch {
          // Stop polling if check fails repeatedly
        }
      }, POLL_INTERVAL)

      // Safety: stop polling after 5 minutes
      setTimeout(() => clearInterval(interval), 5 * 60 * 1000)
    } catch (err) {
      setState((prev) => ({
        ...prev,
        downloading: false,
        error: err instanceof Error ? err.message : String(err),
      }))
    }
  }

  const handleLater = () => {
    if (state.info) {
      skipVersion(state.info.version)
    }
    setState((prev) => ({ ...prev, available: false }))
  }

  const handleOpenSettings = () => {
    openInstallPermissionSettings()
    setState((prev) => ({ ...prev, needsPermission: false }))
  }

  if (state.checking) return null
  if (!state.available && !state.needsPermission && !state.error) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-5 space-y-4">
        {state.needsPermission ? (
          <>
            <h3 className="text-lg font-semibold text-gray-900">Permission Required</h3>
            <p className="text-sm text-gray-600">
              To install updates, you need to allow <strong>Install unknown apps</strong> for Money Weather
              in your system settings.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleOpenSettings}
                className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
              >
                Open Settings
              </button>
              <button
                onClick={() => setState((prev) => ({ ...prev, needsPermission: false }))}
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
            </div>
          </>
        ) : state.downloading ? (
          <>
            <h3 className="text-lg font-semibold text-gray-900">Downloading Update</h3>
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-gray-600">
                <span>Money Weather {state.info?.version}</span>
                <span>{state.downloadProgress}%</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 rounded-full transition-all duration-300"
                  style={{ width: `${state.downloadProgress}%` }}
                />
              </div>
              <p className="text-xs text-gray-500">
                The installer will open automatically when the download is complete.
              </p>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-lg font-semibold text-gray-900">Update Available</h3>
            <p className="text-sm text-gray-600">
              Money Weather {state.info?.version} is available.
              {state.currentVersion && (
                <span className="block mt-1 text-xs text-gray-500">
                  Current version: {state.currentVersion}
                </span>
              )}
            </p>
            {state.info?.releaseNotes && (
              <div className="bg-gray-50 rounded p-2 text-sm text-gray-700">
                {state.info.releaseNotes}
              </div>
            )}
            {state.error && (
              <div className="bg-red-50 text-red-700 text-sm p-2 rounded">{state.error}</div>
            )}
            <div className="flex gap-2">
              {!state.info?.force && (
                <button
                  onClick={handleLater}
                  className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-md hover:bg-gray-200"
                >
                  Later
                </button>
              )}
              <button
                onClick={handleUpdate}
                className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
              >
                Update Now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default MobileUpdatePrompt
