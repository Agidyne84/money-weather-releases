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

  const [passphrase, setPassphrase] = useState('')
  const [confirmPassphrase, setConfirmPassphrase] = useState('')
  const [hasPassphrase, setHasPassphrase] = useState(false)
  const [sessionPassphrase, setSessionPassphrase] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showPassphraseSetup, setShowPassphraseSetup] = useState(false)
  const [pinForPassphrase, setPinForPassphrase] = useState('')
  const [showPinInput, setShowPinInput] = useState(false)
  const [pendingAction, setPendingAction] = useState<'push' | 'pull' | 'sync' | null>(null)
  const [pendingPathSetup, setPendingPathSetup] = useState<string | null>(null)
  const [showLocationPicker, setShowLocationPicker] = useState(false)
  const [fileStatus, setFileStatus] = useState<string>('')

  const loadSettings = useCallback(async () => {
    const s = await getCloudSyncSettings()
    setSettings(s)
    const hp = await hasStoredPassphrase()
    setHasPassphrase(hp)
    const sp = getSessionPassphrase()
    setSessionPassphrase(sp)

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
      setShowPassphraseSetup(true)
      return
    }

    // If passphrase exists but not in session, just save path and let user unlock later
    const sp = getSessionPassphrase()
    if (!sp) {
      setMessage({ type: 'success', text: 'Backup path set. Unlock passphrase to create the initial backup.' })
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
    const folderName = 'MoneyWeather'
    const fileName = 'cloud-backup.budgetbackup'
    const relativePath = `${folderName}/${fileName}`

    try {
      await Filesystem.mkdir({
        path: folderName,
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

    const passphrase = getSessionPassphrase()
    if (!passphrase) {
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
    if (!pinForPassphrase || !settings.filePath) return
    setLoading(true)
    try {
      // Import the passphrase unlock function dynamically to avoid circular deps
      const { unlockPassphrase } = await import('../services/securePassphrase')
      const ok = await unlockPassphrase(pinForPassphrase)
      if (ok) {
        setShowPinInput(false)
        setPinForPassphrase('')
        setSessionPassphrase(getSessionPassphrase())
        if (pendingAction) {
          await doSyncAction(pendingAction)
          setPendingAction(null)
        }
      } else {
        setMessage({ type: 'error', text: 'Incorrect PIN. Could not unlock passphrase.' })
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }

  const handleSavePassphrase = async () => {
    if (passphrase.length < 8) {
      setMessage({ type: 'error', text: 'Passphrase must be at least 8 characters.' })
      return
    }
    if (passphrase !== confirmPassphrase) {
      setMessage({ type: 'error', text: 'Passphrases do not match.' })
      return
    }
    // Prompt for PIN to encrypt the passphrase
    const pin = prompt('Enter your app PIN to encrypt the passphrase:')
    if (!pin) return
    setLoading(true)
    try {
      await storePassphrase(pin, passphrase)
      setHasPassphrase(true)
      setShowPassphraseSetup(false)
      setPassphrase('')
      setConfirmPassphrase('')
      setMessage({ type: 'success', text: 'Passphrase saved securely.' })
      setSessionPassphrase(getSessionPassphrase())

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

  const handleDeletePassphrase = async () => {
    if (!confirm('Are you sure you want to remove the saved passphrase?')) return
    await deleteStoredPassphrase()
    setHasPassphrase(false)
    setSessionPassphrase(null)
    setMessage({ type: 'success', text: 'Passphrase removed.' })
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
            <p className="text-sm font-medium text-gray-700">Encryption Passphrase</p>
            {hasPassphrase ? (
              <div className="flex items-center justify-between">
                <p className="text-xs text-green-600">
                  {sessionPassphrase ? 'Passphrase unlocked for this session.' : 'Passphrase stored (locked — enter PIN to unlock).'}
                </p>
                <div className="flex gap-2">
                  {!sessionPassphrase && (
                    <button
                      onClick={() => { setPendingAction(null); setShowPinInput(true) }}
                      className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                      Unlock
                    </button>
                  )}
                  <button
                    onClick={handleDeletePassphrase}
                    className="px-3 py-1.5 text-sm bg-red-50 text-red-600 border border-red-200 rounded-md hover:bg-red-100"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-xs text-gray-500 mb-2">No passphrase saved. Set one to encrypt your cloud backups.</p>
                <button
                  onClick={() => setShowPassphraseSetup(true)}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Set Passphrase
                </button>
              </div>
            )}
          </div>

          {settings.filePath && sessionPassphrase && (
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

          {settings.filePath && !sessionPassphrase && hasPassphrase && (
            <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded">
              Passphrase is encrypted. Click <strong>Unlock</strong> and enter your PIN to enable sync operations.
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
              Select where to save your encrypted cloud backup file on this device.
            </p>
            <div className="space-y-2">
              <button
                onClick={() => selectMobileLocation()}
                className="w-full text-left px-4 py-3 bg-gray-50 rounded-lg hover:bg-blue-50 border border-gray-200 hover:border-blue-300 transition-colors"
              >
                <div className="font-medium text-gray-900">Documents</div>
                <div className="text-xs text-gray-500">MoneyWeather/cloud-backup.budgetbackup</div>
              </button>
            </div>
            <button
              onClick={() => setShowLocationPicker(false)}
              className="w-full px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-md hover:bg-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showPassphraseSetup && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-semibold text-gray-900">Set Encryption Passphrase</h4>
          <p className="text-xs text-gray-500">
            This passphrase encrypts your cloud backup files. Use the same passphrase on all devices.
          </p>
          <input
            type="password"
            placeholder="Enter passphrase (min 8 chars)"
            value={passphrase}
            onChange={e => setPassphrase(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
          <input
            type="password"
            placeholder="Confirm passphrase"
            value={confirmPassphrase}
            onChange={e => setConfirmPassphrase(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSavePassphrase}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              Save Passphrase
            </button>
            <button
              onClick={() => { setShowPassphraseSetup(false); setPassphrase(''); setConfirmPassphrase('') }}
              className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-md hover:bg-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showPinInput && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-semibold text-gray-900">Unlock Passphrase</h4>
          <p className="text-xs text-gray-500">Enter your app PIN to decrypt the cloud sync passphrase.</p>
          <input
            type="password"
            placeholder="Enter PIN"
            value={pinForPassphrase}
            onChange={e => setPinForPassphrase(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            maxLength={6}
          />
          <div className="flex gap-2">
            <button
              onClick={handlePinSubmit}
              disabled={loading || !pinForPassphrase}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Unlocking...' : 'Unlock'}
            </button>
            <button
              onClick={() => { setShowPinInput(false); setPinForPassphrase(''); setPendingAction(null) }}
              className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-md hover:bg-gray-200"
            >
              Cancel
            </button>
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
