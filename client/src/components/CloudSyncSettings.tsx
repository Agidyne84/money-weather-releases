import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import {
  getCloudSyncSettings,
  setCloudSyncEnabled,
  setCloudSyncPath,
  performSync,
  checkCloudSyncStatus,
  pullCloudBackup,
  pushCloudBackup,
} from '../services/syncEngine'
import {
  hasStoredPassphrase,
  storePassphrase,
  deleteStoredPassphrase,
} from '../services/securePassphrase'
import AppLock from './AppLock'

const isNative = Capacitor.isNativePlatform()

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
  const [pendingPathSetup, setPendingPathSetup] = useState<string | null>(null)
  const [pendingPasswordSave, setPendingPasswordSave] = useState(false)
  const [showAppLock, setShowAppLock] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileStatus, setFileStatus] = useState<string>('')

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

  const finalizePathSelection = async (filePath: string) => {
    await setCloudSyncPath(filePath)
    setSettings(prev => ({ ...prev, filePath }))

    // Prompt for passphrase if not yet set
    const hp = await hasStoredPassphrase()
    if (!hp) {
      setPendingPathSetup(filePath)
      setShowPasswordModal(true)
      return
    }

    // Create initial encrypted backup
    await createInitialBackup(filePath)
  }

  const handlePickFile = async () => {
    if (!isNative) {
      // Desktop: use Electron folder picker
      const electronAPI = (window as any).electronAPI
      if (electronAPI?.showOpenDirectoryDialog) {
        const result = await electronAPI.showOpenDirectoryDialog({
          title: 'Choose folder for cloud backup',
        })
        if (!result.canceled && result.filePaths.length > 0) {
          const folderPath = result.filePaths[0]
          const separator = folderPath.includes('\\') ? '\\' : '/'
          const filePath = `${folderPath}${separator}cloud-backup.budgetbackup`
          await finalizePathSelection(filePath)
        }
      } else {
        // Fallback to prompt
        const path = prompt('Enter the full file path for your cloud backup:', settings.filePath || '')
        if (path) await finalizePathSelection(path)
      }
      return
    }

    // Mobile: trigger native file picker via hidden input
    fileInputRef.current?.click()
  }

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset input so same file can be selected again
    e.target.value = ''

    if (isNative) {
      // On mobile: copy selected file to Documents so we have a persistent path
      const filename = file.name.endsWith('.budgetbackup')
        ? file.name
        : 'cloud-backup.budgetbackup'
      try {
        const arrayBuffer = await file.arrayBuffer()
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
        await Filesystem.writeFile({
          path: filename,
          directory: Directory.Documents,
          data: base64,
          encoding: 'base64' as any,
        })
        await finalizePathSelection(filename)
      } catch (err) {
        console.error('[CloudSync] Failed to write selected file:', err)
        setMessage({ type: 'error', text: 'Could not save the selected file.' })
      }
    } else {
      // Desktop: not reachable here since desktop uses Electron API above
      await finalizePathSelection(file.name)
    }
  }

  const doSyncAction = async (action: 'push' | 'pull' | 'sync') => {
    if (!settings.filePath) {
      setMessage({ type: 'error', text: 'Please set a cloud backup file path first.' })
      return
    }

    setLoading(true)
    setMessage(null)
    try {
      let result: { action: string; message: string } | { success: boolean; message: string }
      if (action === 'push') {
        const r = await pushCloudBackup(settings.filePath)
        result = { action: 'pushed', message: `Pushed to cloud (${r.size} bytes).` }
      } else if (action === 'pull') {
        const r = await pullCloudBackup(settings.filePath)
        result = { action: 'pulled', message: `Pulled from cloud: ${r.summary.accounts} accounts, ${r.summary.transactions} transactions.` }
      } else {
        result = await performSync(settings.filePath)
      }
      setMessage({ type: 'success', text: (result as any).message || 'Done' })
      loadSettings()
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }

  const handleSavePassword = async () => {
    if (password.length < 8) {
      setMessage({ type: 'error', text: 'Password must be at least 8 characters.' })
      return
    }
    if (password !== confirmPassword) {
      setMessage({ type: 'error', text: 'Passwords do not match.' })
      return
    }
    // Show full-screen AppLock to verify PIN before encrypting password
    setShowPasswordModal(false)
    setPendingPasswordSave(true)
    setShowAppLock(true)
  }

  const handleAppLockUnlock = () => {
    // AppLock unlocked — if this was for password save, it already
    // called onUnlockWithPin which handled the save.
    setShowAppLock(false)
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

      if (pendingPathSetup) {
        await createInitialBackup(pendingPathSetup)
        setPendingPathSetup(null)
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
      setPendingPasswordSave(false)
    }
  }

  const handleDeletePassword = async () => {
    if (!confirm('Are you sure you want to remove the saved password?')) return
    await deleteStoredPassphrase()
    setHasPassword(false)
    setMessage({ type: 'success', text: 'Password removed.' })
  }

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
          <div className="bg-gray-50 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-700">Backup File Path</p>
                <p className="text-xs text-gray-500 break-all">{settings.filePath || 'Not set'}</p>
              </div>
              <button
                onClick={handlePickFile}
                className="ml-3 px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                {settings.filePath ? 'Change' : 'Set Path'}
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

          <div className="bg-gray-50 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">Encryption Password</p>
                <p className="text-xs text-gray-500">
                  {hasPassword ? 'Saved' : 'Not set'}
                </p>
              </div>
              <button
                onClick={() => setShowPasswordModal(true)}
                className="ml-3 px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                {hasPassword ? 'Edit Password' : 'Create Password'}
              </button>
            </div>
          </div>

          {settings.filePath && (
            <div className="flex gap-2">
              <button
                onClick={() => doSyncAction('sync')}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Syncing...' : 'Sync Now'}
              </button>
              <button
                onClick={() => doSyncAction('push')}
                disabled={loading}
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-md hover:bg-gray-200 disabled:opacity-50"
              >
                Push
              </button>
              <button
                onClick={() => doSyncAction('pull')}
                disabled={loading}
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-md hover:bg-gray-200 disabled:opacity-50"
              >
                Pull
              </button>
            </div>
          )}
        </>
      )}

      {/* Hidden native file input for mobile */}
      {isNative && (
        <input
          ref={fileInputRef}
          type="file"
          accept=".budgetbackup,.json"
          className="hidden"
          onChange={handleFileSelected}
        />
      )}

      {/* Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-5 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">
              {hasPassword ? 'Change Encryption Password' : 'Create Encryption Password'}
            </h3>
            <p className="text-sm text-gray-600">
              This password encrypts your cloud backup files. Use the same password on all devices.
            </p>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">New Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter password (min 8 chars)"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm pr-12"
                />
                <button
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-blue-600"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
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
            <div className="flex gap-2">
              <button
                onClick={handleSavePassword}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Save Password'}
              </button>
              <button
                onClick={() => { setShowPasswordModal(false); setPassword(''); setConfirmPassword('') }}
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
            </div>
            {hasPassword && (
              <button
                onClick={handleDeletePassword}
                className="w-full px-4 py-2 text-sm text-red-600 bg-red-50 rounded-md hover:bg-red-100"
              >
                Remove Saved Password
              </button>
            )}
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
