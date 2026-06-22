import React, { useState, useEffect, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import {
  getCloudSyncSettings,
  setCloudSyncEnabled,
  setCloudSyncPath,
  setCloudSyncMode,
  clearCloudSyncSettings,
  checkCloudSyncStatus,
  getCloudFileInfo,
  pullCloudBackup,
  pushCloudBackup,
  performSync,
  refreshLocalPreferences,
  type CloudSyncMode,
} from '../services/syncEngine'
import {
  hasStoredPassphrase,
  storePassphrase,
  getSessionPassphrase,
  unlockPassphrase,
  deleteStoredPassphrase,
} from '../services/securePassphrase'
import { verifyBackupPassword } from '../utils/mobileBackup'
import CloudFile from '../plugins/CloudFilePlugin'
import AppLock from './AppLock'

const isNative = Capacitor.isNativePlatform()

type PasswordModalContext = 'create' | 'verify-existing' | 'create-new'
type SyncMode = 'push' | 'pull'

const CloudSyncSettings: React.FC = () => {
  const [settings, setSettings] = useState<{
    enabled: boolean
    filePath: string | null
    lastSyncTimestamp: string | null
    syncMode: CloudSyncMode
  }>({ enabled: false, filePath: null, lastSyncTimestamp: null, syncMode: 'manual' })

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [hasPassword, setHasPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [passwordModalContext, setPasswordModalContext] = useState<PasswordModalContext>('create')
  const [pendingAction, setPendingAction] = useState<'refresh-sync' | 'force-pull' | 'manual-sync' | 'save-password' | 'verify-file' | null>(null)
  const [showAppLock, setShowAppLock] = useState(false)
  const [appLockAction, setAppLockAction] = useState<'save-password' | 'verify-file' | 'unlock-sync'>('save-password')
  const [syncMode, setSyncMode] = useState<SyncMode>('pull')
  const [cloudFileInfo, setCloudFileInfo] = useState<{ modifiedAt: string | null; size: number | null }>({ modifiedAt: null, size: null })
  const [fileMissing, setFileMissing] = useState(false)
  const [fileStatus, setFileStatus] = useState<string>('')

  // For verifying an existing file
  const [pendingFileBuffer, setPendingFileBuffer] = useState<ArrayBuffer | null>(null)
  const [pendingFileName, setPendingFileName] = useState<string | null>(null)
  const [verifyError, setVerifyError] = useState(false)

  // Mobile folder browser for Create New
  const [showFolderBrowser, setShowFolderBrowser] = useState(false)
  const [folderBrowserPath, setFolderBrowserPath] = useState('')
  const [folderBrowserItems, setFolderBrowserItems] = useState<{ name: string; type: 'directory' | 'file' }[]>([])
  const [folderBrowserLoading, setFolderBrowserLoading] = useState(false)

  const loadSettings = useCallback(async () => {
    const s = await getCloudSyncSettings()
    setSettings(s)
    const hp = await hasStoredPassphrase()
    setHasPassword(hp)
    if (s.enabled && s.filePath) {
      const status = await checkCloudSyncStatus(s.filePath)
      const isMissing = status === 'missing'
      setFileMissing(isMissing)
      const statusMap: Record<string, string> = {
        newer: 'Cloud backup is newer than local',
        older: 'Local is newer than cloud backup',
        same: 'Cloud backup is up to date',
        missing: 'Cloud backup file not found',
        error: 'Error checking cloud backup',
      }
      setFileStatus(statusMap[status] || 'Unknown')
      // Fetch cloud file metadata for debug display
      try {
        const info = await getCloudFileInfo(s.filePath)
        setCloudFileInfo({ modifiedAt: info.modifiedAt, size: info.size ?? null })
      } catch {
        setCloudFileInfo({ modifiedAt: null, size: null })
      }
    } else {
      setFileStatus('')
      setFileMissing(false)
      setCloudFileInfo({ modifiedAt: null, size: null })
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const handleToggle = async () => {
    const next = !settings.enabled
    await setCloudSyncEnabled(next)
    setSettings(prev => ({ ...prev, enabled: next }))
    if (!next) {
      setFileStatus('')
      setFileMissing(false)
      setCloudFileInfo({ modifiedAt: null, size: null })
    } else {
      loadSettings()
    }
  }

  const handleSyncModeToggle = async () => {
    const next: CloudSyncMode = settings.syncMode === 'auto' ? 'manual' : 'auto'
    await setCloudSyncMode(next)
    setSettings(prev => ({ ...prev, syncMode: next }))
  }

  const createInitialBackup = async (filePath: string) => {
    setLoading(true)
    setMessage(null)
    try {
      await pushCloudBackup(filePath)
      setMessage({ type: 'success', text: 'Cloud backup file created successfully.' })
      loadSettings()
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }

  /* ─── Select Existing File ─── */
  const handleSelectExisting = async () => {
    if (!isNative) {
      // Desktop: use Electron file picker
      const electronAPI = (window as any).electronAPI
      if (!electronAPI?.showOpenDialog) {
        setMessage({ type: 'error', text: 'File picker not available.' })
        return
      }
      const result = await electronAPI.showOpenDialog({
        title: 'Select backup file',
        filters: [{ name: 'Budget Backup', extensions: ['budgetbackup'] }],
      })
      if (result.canceled || result.filePaths.length === 0) return
      const filePath = result.filePaths[0]

      // Read file for password verification
      if (electronAPI?.readFile) {
        try {
          const buffer = await electronAPI.readFile(filePath)
          // Convert Uint8Array (from IPC) to ArrayBuffer
          const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
          const arrayBuffer = uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength)
          setPendingFileBuffer(arrayBuffer)
          setPendingFileName(filePath)
          setPassword('')
          setConfirmPassword('')
          setVerifyError(false)
          setPasswordModalContext('verify-existing')
          setShowPasswordModal(true)
        } catch {
          setMessage({ type: 'error', text: 'Could not read the selected file.' })
        }
      } else {
        setMessage({ type: 'error', text: 'File reader not available.' })
      }
      return
    }

    // Mobile: use CloudFilePlugin (SAF) to pick a persistent content:// URI
    try {
      const pick = await CloudFile.pickFile({ mimeType: '*/*' })
      if (!pick.name.endsWith('.budgetbackup')) {
        setMessage({ type: 'error', text: 'Please select a .budgetbackup file.' })
        return
      }
      // Read file content for password verification
      const readResult = await CloudFile.readFile({ uri: pick.uri })
      const base64 = readResult.data
      const binaryString = atob(base64)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      setPendingFileBuffer(bytes.buffer)
      setPendingFileName(pick.uri) // store the persistent content:// URI as the path
      setPassword('')
      setConfirmPassword('')
      setVerifyError(false)
      setPasswordModalContext('verify-existing')
      setShowPasswordModal(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg !== 'User cancelled') {
        setMessage({ type: 'error', text: msg })
      }
    }
  }

  /* ─── Create New File ─── */
  const handleCreateNew = async () => {
    if (!isNative) {
      // Desktop: use Electron save dialog with default filename + .budgetbackup filter
      const electronAPI = (window as any).electronAPI
      if (electronAPI?.showSaveDialog) {
        const result = await electronAPI.showSaveDialog({
          title: 'Create Cloud Backup File',
          defaultPath: 'cloud-backup.budgetbackup',
          filters: [{ name: 'Budget Backup', extensions: ['budgetbackup'] }],
        })
        if (result.canceled || !result.filePath) return
        const safePath = result.filePath.endsWith('.budgetbackup')
          ? result.filePath
          : `${result.filePath}.budgetbackup`
        setPendingFileName(safePath)
        setPasswordModalContext('create-new')
        setPassword('')
        setConfirmPassword('')
        setVerifyError(false)
        setShowPasswordModal(true)
      } else {
        const path = prompt('Enter the full file path for your new cloud backup:', settings.filePath || '')
        if (path) {
          const safePath = path.endsWith('.budgetbackup') ? path : `${path}.budgetbackup`
          setPendingFileName(safePath)
          setPasswordModalContext('create-new')
          setPassword('')
          setConfirmPassword('')
          setVerifyError(false)
          setShowPasswordModal(true)
        }
      }
      return
    }

    // Mobile: open folder browser to select save location within Documents
    await openFolderBrowser()
  }

  const handleVerifyFilePassword = async () => {
    if (!pendingFileBuffer || !pendingFileName) return
    if (!password) return

    setLoading(true)
    setVerifyError(false)
    try {
      const ok = await verifyBackupPassword(pendingFileBuffer, password)
      if (ok) {
        setShowPasswordModal(false)
        setAppLockAction('verify-file')
        setPendingAction('verify-file')
        setShowAppLock(true)
      } else {
        setVerifyError(true)
      }
    } catch {
      setVerifyError(true)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveNewFilePassword = async () => {
    if (password.length < 8) {
      setMessage({ type: 'error', text: 'Password must be at least 8 characters.' })
      return
    }
    if (password !== confirmPassword) {
      setMessage({ type: 'error', text: 'Passwords do not match.' })
      return
    }
    setShowPasswordModal(false)
    setAppLockAction('save-password')
    setPendingAction('save-password')
    setShowAppLock(true)
  }

  const handleAppLockUnlock = () => {
    setShowAppLock(false)
    setPendingAction(null)
    setAppLockAction('save-password')
  }

  // Convert ArrayBuffer to base64 without hitting JS argument limit
  const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }

  // Ensure parent directories exist for a given file path
  const ensureParentDirs = async (filePath: string) => {
    const lastSlash = filePath.lastIndexOf('/')
    if (lastSlash <= 0) return
    const dirPath = filePath.slice(0, lastSlash)
    try {
      await Filesystem.mkdir({
        path: dirPath,
        directory: Directory.Documents,
        recursive: true,
      })
    } catch {
      // Directory may already exist
    }
  }

  /* ─── Mobile Folder Browser ─── */
  const loadFolderBrowser = async (path: string) => {
    setFolderBrowserLoading(true)
    try {
      const result = await Filesystem.readdir({
        path,
        directory: Directory.Documents,
      })
      const items = result.files.map((f) => ({
        name: f.name,
        type: f.type === 'directory' ? ('directory' as const) : ('file' as const),
      }))
      // Sort: directories first, then alphabetically
      items.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      setFolderBrowserItems(items)
      setFolderBrowserPath(path)
    } catch {
      setFolderBrowserItems([])
      setFolderBrowserPath(path)
    } finally {
      setFolderBrowserLoading(false)
    }
  }

  const openFolderBrowser = async () => {
    setShowFolderBrowser(true)
    setFolderBrowserPath('')
    await loadFolderBrowser('')
  }

  const navigateIntoFolder = async (folderName: string) => {
    const newPath = folderBrowserPath ? `${folderBrowserPath}/${folderName}` : folderName
    await loadFolderBrowser(newPath)
  }

  const navigateUp = async () => {
    if (!folderBrowserPath) return
    const lastSlash = folderBrowserPath.lastIndexOf('/')
    const parentPath = lastSlash > 0 ? folderBrowserPath.slice(0, lastSlash) : ''
    await loadFolderBrowser(parentPath)
  }

  const selectFolderBrowserPath = () => {
    const folderPath = folderBrowserPath ? folderBrowserPath + '/' : ''
    const filePath = folderPath + 'cloud-backup.budgetbackup'
    setPendingFileName(filePath)
    setShowFolderBrowser(false)
    setPasswordModalContext('create-new')
    setPassword('')
    setConfirmPassword('')
    setVerifyError(false)
    setShowPasswordModal(true)
  }

  const handleAppLockUnlockWithPin = async (pin: string) => {
    if (!pendingAction) return
    setLoading(true)
    try {
      // Unlocking passphrase for sync after app restart
      if (appLockAction === 'unlock-sync') {
        const ok = await unlockPassphrase(pin)
        if (!ok) {
          setMessage({ type: 'error', text: 'Invalid PIN. Could not unlock cloud sync password.' })
          return
        }
        setMessage({ type: 'success', text: 'Cloud sync password unlocked.' })
        // Execute the specific sync action that was pending when the PIN prompt appeared
        if (pendingAction === 'refresh-sync') {
          await runRefreshSync()
        } else if (pendingAction === 'force-pull') {
          await runForcePull()
        } else if (pendingAction === 'manual-sync') {
          await executeManualSync()
        }
        return
      }

      await storePassphrase(pin, password)
      setHasPassword(true)
      setPassword('')
      setConfirmPassword('')
      setMessage({ type: 'success', text: 'Password saved securely.' })

      // Verifying existing file: save the path (content:// URI or Documents path)
      if (appLockAction === 'verify-file' && pendingFileName && pendingFileBuffer) {
        if (pendingFileName.startsWith('content://')) {
          // SAF persistent URI: no local copy needed
          await setCloudSyncPath(pendingFileName)
          setSettings(prev => ({ ...prev, filePath: pendingFileName }))
        } else {
          // Legacy Documents path: write local copy
          await ensureParentDirs(pendingFileName)
          const base64 = arrayBufferToBase64(pendingFileBuffer)
          await Filesystem.writeFile({
            path: pendingFileName,
            directory: Directory.Documents,
            data: base64,
            encoding: 'base64' as any,
          })
          await setCloudSyncPath(pendingFileName)
          setSettings(prev => ({ ...prev, filePath: pendingFileName }))
        }
        setPendingFileBuffer(null)
        setPendingFileName(null)
        loadSettings()
      }

      // Creating new file: create initial backup
      if (appLockAction === 'save-password' && pendingFileName) {
        await ensureParentDirs(pendingFileName)
        await setCloudSyncPath(pendingFileName)
        setSettings(prev => ({ ...prev, filePath: pendingFileName }))
        await createInitialBackup(pendingFileName)
        setPendingFileName(null)
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessage({ type: 'error', text: msg })
      console.error('[CloudSync] AppLock save failed:', err)
    } finally {
      setLoading(false)
      setPendingAction(null)
      setShowAppLock(false)
    }
  }

  const doSync = async () => {
    if (!settings.filePath) {
      setMessage({ type: 'error', text: 'Please set a cloud backup file path first.' })
      return
    }

    // Session passphrase is volatile JS memory — if the app was restarted,
    // we need to prompt for the PIN to decrypt it again.
    if (!getSessionPassphrase()) {
      const hasStored = await hasStoredPassphrase()
      if (hasStored) {
        setAppLockAction('unlock-sync')
        setPendingAction('manual-sync')
        setShowAppLock(true)
        return
      }
      setMessage({ type: 'error', text: 'Cloud sync password not found. Please set up cloud sync again.' })
      return
    }

    await executeManualSync()
  }

  const executeManualSync = async () => {
    if (!settings.filePath) {
      setMessage({ type: 'error', text: 'Please set a cloud backup file path first.' })
      return
    }
    setLoading(true)
    setMessage(null)
    try {
      if (syncMode === 'push') {
        const r = await pushCloudBackup(settings.filePath)
        setMessage({ type: 'success', text: `Pushed to cloud (${r.size} bytes).` })
      } else {
        const r = await pullCloudBackup(settings.filePath)
        const counts = Object.entries(r.summary)
          .map(([table, count]) => `${table.replace(/_/g, ' ')}: ${count}`)
          .join(', ')
        setMessage({ type: 'success', text: `Pulled from cloud: ${counts}.` })
      }
      loadSettings()
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }

  const handleRefreshSync = async () => {
    if (!settings.filePath) {
      setMessage({ type: 'error', text: 'Please set a cloud backup file path first.' })
      return
    }

    // Prompt for PIN if passphrase is not in session memory
    if (!getSessionPassphrase()) {
      const hasStored = await hasStoredPassphrase()
      if (hasStored) {
        setAppLockAction('unlock-sync')
        setPendingAction('refresh-sync')
        setShowAppLock(true)
        return
      }
      setMessage({ type: 'error', text: 'Cloud sync password not found. Please set up cloud sync again.' })
      return
    }

    await runRefreshSync()
  }

  const runRefreshSync = async () => {
    if (!settings.filePath) {
      setMessage({ type: 'error', text: 'Please set a cloud backup file path first.' })
      return
    }
    setLoading(true)
    setMessage(null)
    try {
      const result = await performSync(settings.filePath)
      if (result.action === 'pulled') {
        await refreshLocalPreferences()
        window.dispatchEvent(new CustomEvent('sync:pulled', { detail: result }))
      }
      setMessage({ type: result.action === 'error' ? 'error' : 'success', text: result.message })
      loadSettings()
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }

  const handleForcePull = async () => {
    if (!settings.filePath) {
      setMessage({ type: 'error', text: 'Please set a cloud backup file path first.' })
      return
    }

    if (!getSessionPassphrase()) {
      const hasStored = await hasStoredPassphrase()
      if (hasStored) {
        setAppLockAction('unlock-sync')
        setPendingAction('force-pull')
        setShowAppLock(true)
        return
      }
      setMessage({ type: 'error', text: 'Cloud sync password not found. Please set up cloud sync again.' })
      return
    }

    await runForcePull()
  }

  const runForcePull = async () => {
    if (!settings.filePath) {
      setMessage({ type: 'error', text: 'Please set a cloud backup file path first.' })
      return
    }
    setLoading(true)
    setMessage(null)
    try {
      const result = await pullCloudBackup(settings.filePath)
      if (result.success) {
        await refreshLocalPreferences()
        window.dispatchEvent(new CustomEvent('sync:pulled', { detail: result }))
        setMessage({ type: 'success', text: 'Force pull complete. Data restored from cloud backup.' })
      } else {
        setMessage({ type: 'error', text: 'Force pull failed.' })
      }
      loadSettings()
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }

  const handleResetCloudSync = async () => {
    if (!confirm('Reset all cloud sync settings? This will clear the file path, password, and sync history. Your local data will not be affected.')) {
      return
    }
    setLoading(true)
    try {
      await clearCloudSyncSettings()
      await deleteStoredPassphrase()
      setSettings({ enabled: false, filePath: null, lastSyncTimestamp: null, syncMode: 'manual' })
      setHasPassword(false)
      setMessage({ type: 'success', text: 'Cloud sync settings reset. You can re-configure sync at any time.' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }

  const canSync = settings.enabled && !!settings.filePath && hasPassword

  const getPasswordModalTitle = () => {
    switch (passwordModalContext) {
      case 'verify-existing': return 'Verify Backup Password'
      case 'create-new': return 'Create Password for New Backup'
      default: return hasPassword ? 'Change Encryption Password' : 'Create Encryption Password'
    }
  }

  const getPasswordModalButtonLabel = () => {
    if (loading) return 'Processing...'
    switch (passwordModalContext) {
      case 'verify-existing': return 'Verify Password'
      case 'create-new': return 'Save Password'
      default: return 'Save Password'
    }
  }

  const handlePasswordModalPrimary = () => {
    if (passwordModalContext === 'verify-existing') {
      handleVerifyFilePassword()
    } else {
      handleSaveNewFilePassword()
    }
  }

  const showConfirmInModal = passwordModalContext !== 'verify-existing'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Cloud Sync</h3>
          <p className="text-sm text-gray-500">Sync your data with a shared backup file.</p>
        </div>
        <button
          onClick={handleToggle}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            settings.enabled ? 'bg-blue-600' : 'bg-gray-200'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              settings.enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {settings.enabled && (
        <>
          {/* File Path Card */}
          <div className="bg-gray-50 rounded-lg p-4 space-y-3">
            {fileMissing ? (
              <div className="bg-red-50 border border-red-200 rounded-md p-3 space-y-2">
                <p className="text-sm font-semibold text-red-800">Cloud Backup File Missing</p>
                <p className="text-xs text-red-700">
                  The backup file could not be found at the configured path. It may have been moved or deleted.
                </p>
                <p className="text-xs text-red-700 break-all">
                  Path: {settings.filePath || 'Not set'}
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-700">Backup File</p>
                  <p className="text-xs text-gray-500 break-all">{settings.filePath || 'Not set'}</p>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleSelectExisting}
                className="flex-1 px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Select Existing File
              </button>
              <button
                onClick={handleCreateNew}
                className="flex-1 px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Create New File
              </button>
            </div>

            {!fileMissing && settings.filePath && fileStatus && (
              <p className="text-xs text-gray-500">Status: {fileStatus}</p>
            )}

            {settings.lastSyncTimestamp && (
              <p className="text-xs text-gray-500">
                Last sync: {new Date(settings.lastSyncTimestamp).toLocaleString()}
              </p>
            )}
          </div>

          {/* Refresh Cloud Sync — always available */}
          {!fileMissing && (
            <div className="space-y-2">
              <button
                onClick={handleRefreshSync}
                disabled={loading || !canSync}
                className="w-full px-4 py-2 bg-green-600 text-white text-sm rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Syncing...' : 'Refresh Cloud Sync'}
              </button>
              <button
                onClick={handleForcePull}
                disabled={loading || !canSync}
                className="w-full px-4 py-2 bg-amber-600 text-white text-sm rounded-md hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Pull latest data from cloud regardless of timestamps. Use when cloud provider sync delays cause stale local file."
              >
                {loading ? 'Syncing...' : 'Force Pull from Cloud'}
              </button>
              {/* Debug timestamp display */}
              {cloudFileInfo.modifiedAt && (
                <div className="text-xs text-gray-500 bg-gray-50 rounded p-2 space-y-1">
                  <p>Cloud file modified: {new Date(cloudFileInfo.modifiedAt).toLocaleString()}</p>
                  {settings.lastSyncTimestamp && (
                    <p>Last app sync: {new Date(settings.lastSyncTimestamp).toLocaleString()}</p>
                  )}
                  <p>Cloud file size: {(cloudFileInfo.size || 0).toLocaleString()} bytes</p>
                </div>
              )}
            </div>
          )}

          {/* Auto / Manual Toggle */}
          <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
            <div className="flex-1 min-w-0 mr-3">
              <p className="text-sm font-medium text-gray-700">
                Sync Mode &mdash; {settings.syncMode === 'auto' ? 'Automatic' : 'Manual'}
              </p>
            </div>
            <button
              onClick={handleSyncModeToggle}
              disabled={fileMissing}
              className="relative inline-flex h-6 w-12 flex-shrink-0 items-center rounded-full transition-colors bg-blue-600 disabled:opacity-40"
              title="Toggle Auto / Manual"
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.syncMode === 'auto' ? 'translate-x-7' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Push / Pull Toggle + Sync Now (Manual mode only, hidden when file missing) */}
          {settings.syncMode === 'manual' && !fileMissing && (
            <div className="space-y-2">
              <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                <span className="text-sm font-medium text-gray-700">
                  {syncMode === 'pull' ? 'Pull from Cloud' : 'Push to Cloud'}
                </span>
                <button
                  onClick={() => setSyncMode(syncMode === 'pull' ? 'push' : 'pull')}
                  className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors bg-blue-600"
                  title="Toggle Push / Pull"
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      syncMode === 'pull' ? 'translate-x-1' : 'translate-x-6'
                    }`}
                  />
                </button>
              </div>

              <button
                onClick={doSync}
                disabled={loading || !canSync}
                className="w-full px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Syncing...' : 'Sync Now'}
              </button>

              {!canSync && (
                <p className="text-xs text-gray-500 text-center">
                  {!settings.filePath ? 'Set a backup file path to enable sync.' : 'Set a password to enable sync.'}
                </p>
              )}
            </div>
          )}

          {/* Auto mode info */}
          {settings.syncMode === 'auto' && !fileMissing && (
            <div className="bg-blue-50 rounded-md p-3">
              <p className="text-sm text-blue-800 font-medium">Automatic Sync Active</p>
              <p className="text-xs text-blue-700 mt-1">
                Your data is kept in sync automatically. Local changes are pushed to the cloud shortly after you make them, and cloud changes are pulled automatically.
              </p>
            </div>
          )}

          {/* Reset */}
          <div className="flex justify-end">
            <button
              onClick={handleResetCloudSync}
              disabled={loading}
              className="text-xs text-red-600 hover:text-red-800 underline disabled:opacity-50"
            >
              Reset Cloud Sync
            </button>
          </div>
        </>
      )}

      {/* Password Modal — context-aware */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-5 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">{getPasswordModalTitle()}</h3>

            {passwordModalContext === 'verify-existing' ? (
              <p className="text-sm text-gray-600">
                Enter the password for this backup file to verify ownership.
              </p>
            ) : (
              <p className="text-sm text-gray-600">
                This password encrypts your cloud backup files. Use the same password on all devices.
              </p>
            )}

            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">
                {passwordModalContext === 'verify-existing' ? 'Password' : 'New Password'}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder={passwordModalContext === 'verify-existing' ? 'Enter password' : 'Enter password (min 8 chars)'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className={`w-full px-3 py-2 border rounded-md text-sm pr-12 ${
                    verifyError ? 'border-red-500' : 'border-gray-300'
                  }`}
                />
                <button
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-blue-600"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {verifyError && (
                <p className="text-xs text-red-600">Incorrect password. Please try again.</p>
              )}
            </div>

            {showConfirmInModal && (
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-700">Confirm Password</label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="Confirm password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm pr-12"
                  />
                  <button
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-blue-600"
                  >
                    {showConfirmPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handlePasswordModalPrimary}
                disabled={loading || !password || (showConfirmInModal && !confirmPassword)}
                className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {getPasswordModalButtonLabel()}
              </button>
              <button
                onClick={() => { setShowPasswordModal(false); setPassword(''); setConfirmPassword(''); setVerifyError(false) }}
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Mobile Folder Browser Modal */}
      {showFolderBrowser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-5 space-y-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Select Folder</h3>
              <button
                onClick={() => setShowFolderBrowser(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <div className="text-sm text-gray-500 truncate">
              {folderBrowserPath ? `Documents/${folderBrowserPath}` : 'Documents'}
            </div>

            {folderBrowserPath && (
              <button
                onClick={navigateUp}
                className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
              >
                <span>←</span> Back
              </button>
            )}

            <div className="flex-1 overflow-y-auto min-h-[200px] border rounded-md divide-y">
              {folderBrowserLoading ? (
                <div className="p-4 text-center text-sm text-gray-500">Loading...</div>
              ) : folderBrowserItems.length === 0 ? (
                <div className="p-4 text-center text-sm text-gray-500">Empty folder</div>
              ) : (
                folderBrowserItems.map((item) => (
                  <button
                    key={item.name}
                    onClick={() =>
                      item.type === 'directory' ? navigateIntoFolder(item.name) : undefined
                    }
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                      item.type === 'directory' ? 'text-blue-600' : 'text-gray-600'
                    }`}
                  >
                    <span>{item.type === 'directory' ? '📁' : '📄'}</span>
                    <span className="truncate">{item.name}</span>
                  </button>
                ))
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={selectFolderBrowserPath}
                className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
              >
                Save Here
              </button>
              <button
                onClick={() => setShowFolderBrowser(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full-screen AppLock for password save */}
      {showAppLock && (
        <AppLock
          onUnlock={handleAppLockUnlock}
          onUnlockWithPin={handleAppLockUnlockWithPin}
        />
      )}

      {message && (
        <div className={`p-3 rounded-md text-sm ${
          message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {message.text}
        </div>
      )}
    </div>
  )
}

export default CloudSyncSettings
