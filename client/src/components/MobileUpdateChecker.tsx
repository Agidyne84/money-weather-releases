import React, { useState } from 'react'
import { Capacitor } from '@capacitor/core'
import {
  checkForMobileUpdate,
  downloadAndInstallUpdate,
  canInstallPackages,
  openInstallPermissionSettings,
  type MobileVersionInfo,
} from '../services/otaUpdate'

const MobileUpdateChecker: React.FC = () => {
  const [checking, setChecking] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<MobileVersionInfo | null>(null)
  const [currentVersion, setCurrentVersion] = useState<string>('')
  const [downloading, setDownloading] = useState(false)
  const [needsPermission, setNeedsPermission] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!Capacitor.isNativePlatform()) return null

  const handleCheck = async () => {
    setChecking(true)
    setUpdateInfo(null)
    setError(null)
    try {
      const result = await checkForMobileUpdate()
      if (result.available && result.info) {
        setUpdateInfo(result.info)
        setCurrentVersion(result.currentVersion || '')
      } else {
        setUpdateInfo(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setChecking(false)
    }
  }

  const handleUpdate = async () => {
    if (!updateInfo) return
    setError(null)

    const canInstall = await canInstallPackages()
    if (!canInstall) {
      setNeedsPermission(true)
      return
    }

    setDownloading(true)
    try {
      await downloadAndInstallUpdate(updateInfo.downloadUrl)
      // Android install dialog will appear automatically
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDownloading(false)
    }
  }

  const handleOpenSettings = () => {
    openInstallPermissionSettings()
    setNeedsPermission(false)
  }

  return (
    <div className="card p-6">
      <h2 className="text-xl font-bold text-gray-900 mb-1">App Update</h2>
      <p className="text-sm text-gray-500 mb-4">Check for the latest version of Money Weather.</p>

      {error && (
        <div className="mb-4 px-4 py-3 rounded text-sm font-medium bg-red-50 text-red-800 border border-red-200">
          {error}
        </div>
      )}

      {needsPermission && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
          <p className="mb-2">To install updates, allow <strong>Install unknown apps</strong> for Money Weather in system settings.</p>
          <button
            onClick={handleOpenSettings}
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
          >
            Open Settings
          </button>
        </div>
      )}

      {updateInfo ? (
        <div className="space-y-3">
          <div className="bg-green-50 border border-green-200 rounded p-3">
            <p className="text-sm text-green-800 font-medium">Update available: v{updateInfo.version}</p>
            {currentVersion && (
              <p className="text-xs text-green-700 mt-1">Current: v{currentVersion}</p>
            )}
            {updateInfo.releaseNotes && (
              <p className="text-xs text-gray-600 mt-1">{updateInfo.releaseNotes}</p>
            )}
          </div>
          <button
            onClick={handleUpdate}
            disabled={downloading}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {downloading ? 'Downloading...' : 'Update Now'}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button
            onClick={handleCheck}
            disabled={checking}
            className="btn-secondary text-sm disabled:opacity-50"
          >
            {checking ? 'Checking...' : 'Check for Updates'}
          </button>
          {!checking && (
            <span className="text-xs text-gray-500">Tap to manually check for the latest version.</span>
          )}
        </div>
      )}
    </div>
  )
}

export default MobileUpdateChecker
