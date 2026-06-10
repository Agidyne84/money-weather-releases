import React, { useState, useEffect, useCallback } from 'react'
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
  getSessionPassphrase,
} from '../services/securePassphrase'

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
  const [sessionPassword, setSessionPassword] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [pinForPassword, setPinForPassword] = useState('')
  const [showPinInput, setShowPinInput] = useState(false)
  const [pendingAction, setPendingAction] = useState<'push' | 'pull' | 'sync' | null>(null)
  const [pendingPathSetup, setPendingPathSetup] = useState<string | null>(null)
  const [showLocationPicker, setShowLocationPicker] = useState(false)
  const [mobileFolderName, setMobileFolderName] = useState('MoneyWeather')
  const [mobileFileName, setMobileFileName] = useState('cloud-backup.budgetbackup')
  const [fileStatus, setFileStatus] = useState<string>('')

  const loadSettings = useCallback(async () => {
    const s = await getCloudSyncSettings()
    setSettings(s)
    const hp = await hasStoredPassphrase()
    setHasPassword(hp)
    const sp = getSessionPassphrase()
    setSessionPassword(sp)

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

    // If passphrase exists but not in session, just save path and let user unlock later
    const sp = getSessionPassphrase()
    if (!sp) {
      setMessage({ type: 'success', text: 'Backup path set. Unlock password to create the initial backup.' })
      loadSettings()
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

    // Mobile: show location picker
    setShowLocationPicker(true)
  }

  const selectMobileLocation = async () => {
    setShowLocationPicker(false)
    const relativePath = `${mobileFolderName}/${mobileFileName}`

    try {
      await Filesystem.mkdir({
        path: mobileFolderName,
        directory: Directory.Documents,
        recursive: true,
      }).catch(() => {})
    } catch {}

    await finalizePathSelection(relativePath)
  }

  const doSyncAction = async (action: 'push' | 'pull' | 'sync') => {
    if (!settings.filePath) {
      setMessage({ type: 'error', text: 'Please set a cloud backup file path first.' })
      return
    }

    const pw = getSessionPassphrase()
    if (!pw) {
      setPendingAction(action)
      setShowPinInput(true)
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

  const handlePinSubmit = async () => {
    if (!pinForPassword || !settings.filePath) return
    setLoading(true)
    try {
      // Import the password unlock function dynamically to avoid circular deps
      const { unlockPassphrase } = await import('../services/securePassphrase')
      const ok = await unlockPassphrase(pinForPassword)
      if (ok) {
        setShowPinInput(false)
        setPinForPassword('')
        setSessionPassword(getSessionPassphrase())
        if (pendingAction) {
          await doSyncAction(pendingAction)
          setPendingAction(null)
        }
      } else {
        setMessage({ type: 'error', text: 'Incorrect PIN. Could not unlock password.' })
      }
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
    // Prompt for PIN to encrypt the password
    const pin = prompt('Enter your app PIN to encrypt the password:')
    if (!pin) return
    setLoading(true)
    try {
      await storePassphrase(pin, password)
      setHasPassword(true)
      setShowPasswordModal(false)
      setPassword('')
      setConfirmPassword('')
      setMessage({ type: 'success', text: 'Password saved securely.' })
      setSessionPassword(getSessionPassphrase())

      // If this was triggered during path setup, create the initial backup
      if (pendingPathSetup) {
        await createInitialBackup(pendingPathSetup)
        setPendingPathSetup(null)
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }

  const handleDeletePassword = async () => {
    if (!confirm('Are you sure you want to remove the saved password?')) return
    await deleteStoredPassphrase()
    setHasPassword(false)
    setSessionPassword(null)
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
                  {hasPassword
                    ? (sessionPassword ? 'Unlocked for this session' : 'Locked — enter PIN to unlock')
                    : 'Not set'}
                </p>
              </div>
              <button
                onClick={() => setShowPasswordModal(true)}
                className="ml-3 px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                {hasPassword ? 'Edit Password' : 'Create Password'}
              </button>
            </div>
            {hasPassword && !sessionPassword && (
              <button
                onClick={() => { setPendingAction(null); setShowPinInput(true) }}
                className="w-full px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Unlock
              </button>
            )}
          </div>

          {settings.filePath && sessionPassword && (
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

          {settings.filePath && !sessionPassword && hasPassword && (
            <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded">
              Password is encrypted. Click <strong>Unlock</strong> and enter your PIN to enable sync operations.
            </p>
          )}
        </>
      )}

      {/* Mobile Location Picker */}
      {showLocationPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-5 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Choose Backup Location</h3>
            <p className="text-sm text-gray-600">
              Set the folder and filename for your encrypted cloud backup on this device.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Folder</label>
                <input
                  type="text"
                  value={mobileFolderName}
                  onChange={e => setMobileFolderName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder="Folder name"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">File Name</label>
                <input
                  type="text"
                  value={mobileFileName}
                  onChange={e => setMobileFileName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder="File name"
                />
              </div>
              <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
                Path: Documents/{mobileFolderName}/{mobileFileName}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={selectMobileLocation}
                className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
              >
                Save
              </button>
              <button
                onClick={() => setShowLocationPicker(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
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
            {hasPassword && (
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-700">Current Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={sessionPassword ? '••••••••' : 'Not unlocked'}
                    readOnly
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-gray-50"
                  />
                  {sessionPassword && (
                    <button
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-blue-600"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  )}
                </div>
              </div>
            )}
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

      {/* PIN Unlock Modal */}
      {showPinInput && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-5 space-y-4">
            <h4 className="text-sm font-semibold text-gray-900">Unlock Password</h4>
            <p className="text-xs text-gray-500">Enter your app PIN to decrypt the cloud sync password.</p>
            <input
              type="password"
              placeholder="Enter PIN"
              value={pinForPassword}
              onChange={e => setPinForPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              maxLength={6}
            />
            <div className="flex gap-2">
              <button
                onClick={handlePinSubmit}
                disabled={loading || !pinForPassword}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Unlocking...' : 'Unlock'}
              </button>
              <button
                onClick={() => { setShowPinInput(false); setPinForPassword(''); setPendingAction(null) }}
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
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
