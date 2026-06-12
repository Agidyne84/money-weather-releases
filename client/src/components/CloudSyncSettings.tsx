import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import {
  getCloudSyncSettings,
  setCloudSyncEnabled,
  setCloudSyncPath,
  checkCloudSyncStatus,
  pullCloudBackup,
  pushCloudBackup,
} from '../services/syncEngine'
import {
  hasStoredPassphrase,
  storePassphrase,
} from '../services/securePassphrase'
import { verifyBackupPassword } from '../utils/mobileBackup'
import AppLock from './AppLock'

const isNative = Capacitor.isNativePlatform()

type PasswordModalContext = 'create' | 'verify-existing' | 'create-new'
type SyncMode = 'push' | 'pull'

const CloudSyncSettings: React.FC = () => {
  const [settings, setSettings] = useState<{
    enabled: boolean
    filePath: string | null
    lastSyncTimestamp: string | null
  }>({ enabled: false, filePath: null, lastSyncTimestamp: null })

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [hasPassword, setHasPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [passwordModalContext, setPasswordModalContext] = useState<PasswordModalContext>('create')
  const [pendingPasswordSave, setPendingPasswordSave] = useState(false)
  const [showAppLock, setShowAppLock] = useState(false)
  const [appLockAction, setAppLockAction] = useState<'save-password' | 'verify-file'>('save-password')
  const [syncMode, setSyncMode] = useState<SyncMode>('pull')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileStatus, setFileStatus] = useState<string>('')

  // For verifying an existing file
  const [pendingFileBuffer, setPendingFileBuffer] = useState<ArrayBuffer | null>(null)
  const [pendingFileName, setPendingFileName] = useState<string | null>(null)
  const [verifyError, setVerifyError] = useState(false)

  const loadSettings = useCallback(async () => {
    const s = await getCloudSyncSettings()
    setSettings(s)
    const hp = await hasStoredPassphrase()
    setHasPassword(hp)
    if (s.enabled && s.filePath) {
      const status = await checkCloudSyncStatus(s.filePath)
      const statusMap: Record<string, string> = {
        newer: 'Cloud backup is newer than local',
        older: 'Local is newer than cloud backup',
        same: 'Cloud backup is up to date',
        missing: 'Cloud backup file not found',
        error: 'Error checking cloud backup',
      }
      setFileStatus(statusMap[status] || 'Unknown')
    } else {
      setFileStatus('')
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
    } else {
      loadSettings()
    }
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

    // Mobile: trigger native file picker via hidden input
    fileInputRef.current?.click()
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

    // Mobile: prompt for save path within Documents
    const defaultPath = 'cloud-backup.budgetbackup'
    const userPath = window.prompt(
      'Enter the save path for your new backup (within app Documents):',
      defaultPath
    )
    if (!userPath) return
    const safePath = userPath.endsWith('.budgetbackup') ? userPath : `${userPath}.budgetbackup`
    setPendingFileName(safePath)
    setPasswordModalContext('create-new')
    setPassword('')
    setConfirmPassword('')
    setVerifyError(false)
    setShowPasswordModal(true)
  }

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    if (!file.name.endsWith('.budgetbackup')) {
      setMessage({ type: 'error', text: 'Please select a .budgetbackup file.' })
      return
    }

    try {
      const buffer = await file.arrayBuffer()
      setPendingFileBuffer(buffer)
      setPendingFileName(file.name)
      setPassword('')
      setConfirmPassword('')
      setVerifyError(false)
      setPasswordModalContext('verify-existing')
      setShowPasswordModal(true)
    } catch {
      setMessage({ type: 'error', text: 'Could not read the selected file.' })
    }
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
        setPendingPasswordSave(true)
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
    setPendingPasswordSave(true)
    setShowAppLock(true)
  }

  const handleAppLockUnlock = () => {
    setShowAppLock(false)
    setPendingPasswordSave(false)
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

  const handleAppLockUnlockWithPin = async (pin: string) => {
    if (!pendingPasswordSave) return
    setLoading(true)
    try {
      await storePassphrase(pin, password)
      setHasPassword(true)
      setPassword('')
      setConfirmPassword('')
      setMessage({ type: 'success', text: 'Password saved securely.' })

      // Verifying existing file: copy it to Documents and set path
      if (appLockAction === 'verify-file' && pendingFileName && pendingFileBuffer) {
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
      setMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
      setPendingPasswordSave(false)
    }
  }

  const doSync = async () => {
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
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700">Backup File</p>
                <p className="text-xs text-gray-500 break-all">{settings.filePath || 'Not set'}</p>
              </div>
            </div>

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

            {settings.filePath && fileStatus && (
              <p className="text-xs text-gray-500">Status: {fileStatus}</p>
            )}

            {settings.lastSyncTimestamp && (
              <p className="text-xs text-gray-500">
                Last sync: {new Date(settings.lastSyncTimestamp).toLocaleString()}
              </p>
            )}
          </div>

          {/* Push / Pull Toggle + Sync Now */}
          <div className="space-y-2">
            <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
              <span className="text-sm font-medium text-gray-700">
                {syncMode === 'push' ? 'Push to Cloud' : 'Pull from Cloud'}
              </span>
              <button
                onClick={() => setSyncMode(syncMode === 'push' ? 'pull' : 'push')}
                className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors bg-blue-600"
                title="Toggle Push / Pull"
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    syncMode === 'pull' ? 'translate-x-6' : 'translate-x-1'
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
        </>
      )}

      {/* Hidden native file input for mobile (accept ALL files so .budgetbackup shows) */}
      {isNative && (
        <input
          ref={fileInputRef}
          type="file"
          accept="*/*"
          className="hidden"
          onChange={handleFileSelected}
        />
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
