import React, { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { Filesystem, Directory } from '@capacitor/filesystem'
import {
  getCloudSyncSettings,
  setCloudSyncEnabled,
  setCloudSyncPath,
  setCloudSyncDisplayName,
  setCloudSyncMode,
  clearCloudSyncSettings,
  checkCloudSyncStatus,
  getCloudFileInfo,
  pullCloudBackup,
  pushCloudBackup,
  refreshLocalPreferences,
  type CloudSyncMode,
} from '../services/syncEngine'
import {
  hasStoredPassphrase,
  storePassphrase,
  getSessionPassphrase,
  setSessionPassphrase,
  unlockPassphrase,
  deleteStoredPassphrase,
} from '../services/securePassphrase'
import { verifyBackupPassword, base64ToArrayBuffer } from '../utils/mobileBackup'
import CloudFile from '../plugins/CloudFilePlugin'
import AppLock from './AppLock'

const isNative = Capacitor.isNativePlatform()

type PasswordModalContext = 'create' | 'verify-existing' | 'create-new'
type SyncMode = 'push' | 'pull'

const CloudSyncSettings: React.FC = () => {
  const [settings, setSettings] = useState<{
    enabled: boolean
    filePath: string | null
    displayName: string | null
    lastSyncTimestamp: string | null
    syncMode: CloudSyncMode
  }>({ enabled: false, filePath: null, displayName: null, lastSyncTimestamp: null, syncMode: 'manual' })

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
  const [pendingDisplayName, setPendingDisplayName] = useState<string | null>(null)
  const [verifyError, setVerifyError] = useState(false)
  const [fileWarning, setFileWarning] = useState<string | null>(null)
  const [setupPin, setSetupPin] = useState('')

  // Backup & Restore state
  const [exportPassword, setExportPassword] = useState('')
  const [importPassword, setImportPassword] = useState('')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [showExportPassword, setShowExportPassword] = useState(false)
  const [showImportPassword, setShowImportPassword] = useState(false)
  const [resetting, setResetting] = useState(false)

  const displayFilePath = (path: string | null, displayName?: string | null) => {
    if (!path) return 'Not set'
    if (path.startsWith('content://')) {
      // Prefer stored display name from picker (actual filename, not URI path)
      if (displayName) return displayName
      // Fallback: try to extract from URI
      try {
        const decoded = decodeURIComponent(path)
        const withoutQuery = decoded.split('?')[0]
        const lastSlash = withoutQuery.lastIndexOf('/')
        if (lastSlash >= 0) {
          const name = withoutQuery.slice(lastSlash + 1)
          if (name) return name
        }
      } catch {}
      return 'Cloud file'
    }
    return path
  }

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
        newer: 'Cloud backup is newer',
        older: 'Ready to sync to cloud',
        same: 'Synced with cloud',
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

  // Recovery: if the app was killed during file pick (Android lifecycle),
  // restore the pending state from Preferences and show the password modal.
  useEffect(() => {
    setLoading(false)
    const recover = async () => {
      const { value } = await Preferences.get({ key: 'cloud_sync_pending_verify' })
      console.log('[CloudSync] Recovery check:', value ? 'found marker' : 'no marker')
      if (value) {
        try {
          const pending = JSON.parse(value)
          if (pending.stage === 'verify') {
            console.log('[CloudSync] Recovering verify modal for uri:', pending.uri)
            setPendingFileName(pending.uri || null)
            setPendingDisplayName(pending.name || null)
            setFileWarning(pending.warning || null)
            setPassword('')
            setConfirmPassword('')
            setSetupPin('')
            setVerifyError(false)
            setPasswordModalContext('verify-existing')
            setShowPasswordModal(true)
          } else if (pending.stage === 'picking') {
            console.log('[CloudSync] Cleaning up stale picking marker')
            await Preferences.remove({ key: 'cloud_sync_pending_verify' })
          }
        } catch {
          await Preferences.remove({ key: 'cloud_sync_pending_verify' })
        }
      }
    }
    recover()
  }, [])

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
          setSetupPin('')
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
    setLoading(true)
    setMessage(null)
    try {
      // Persist a marker BEFORE opening the picker. If Android kills our activity
      // while the picker is open, we'll recover on next mount.
      await Preferences.set({
        key: 'cloud_sync_pending_verify',
        value: JSON.stringify({ uri: '', warning: '', stage: 'picking' }),
      })

      const pick = await CloudFile.pickFile({ mimeType: '*/*' })
      console.log('[CloudSync] pickFile result:', pick.uri, pick.name)

      // Picker succeeded — store the real URI and show the password modal
      const fileName = (pick.name || pick.uri || '').toString()
      const hasBackupExt = fileName.toLowerCase().endsWith('.budgetbackup')
      const warning = hasBackupExt ? null : `This file does not have a .budgetbackup extension (${fileName}). Make sure it is a valid backup.`
      setFileWarning(warning)

      await Preferences.set({
        key: 'cloud_sync_pending_verify',
        value: JSON.stringify({ uri: pick.uri, warning, stage: 'verify', name: pick.name || null }),
      })

      setPendingFileBuffer(null)
      setPendingFileName(pick.uri)
      setPendingDisplayName(pick.name || null)
      setPassword('')
      setConfirmPassword('')
      setSetupPin('')
      setVerifyError(false)
      setPasswordModalContext('verify-existing')
      setShowPasswordModal(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg !== 'User cancelled') {
        console.error('[CloudSync] Select existing failed:', err)
        setMessage({ type: 'error', text: msg })
      }
      await Preferences.remove({ key: 'cloud_sync_pending_verify' })
    } finally {
      setLoading(false)
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
        setSetupPin('')
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
          setSetupPin('')
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
    if (!pendingFileName) return
    if (!password) return
    if (password !== confirmPassword) {
      setMessage({ type: 'error', text: 'Passwords do not match.' })
      return
    }

    // Close password modal and show App Lock for identity verification.
    // Actual file verification and saving happen after successful unlock.
    setShowPasswordModal(false)
    setAppLockAction('verify-file')
    setPendingAction('verify-file')
    setShowAppLock(true)
  }

  const saveVerifiedFile = async (pin?: string) => {
    if (!pendingFileName || !password) return
    setLoading(true)
    setVerifyError(false)
    try {
      // Read the file if we haven't already
      let buffer: ArrayBuffer
      if (pendingFileBuffer) {
        buffer = pendingFileBuffer
      } else if (isNative && pendingFileName.startsWith('content://')) {
        const readResult = await CloudFile.readFile({ uri: pendingFileName })
        buffer = base64ToArrayBuffer(readResult.data)
      } else if (isNative) {
        const result = await Filesystem.readFile({
          path: pendingFileName,
          directory: Directory.Documents,
          encoding: 'base64' as any,
        })
        buffer = base64ToArrayBuffer(result.data as string)
      } else {
        const electronAPI = (window as any).electronAPI
        const data = await electronAPI.readFile(pendingFileName)
        const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data)
        buffer = uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength)
      }

      const ok = await verifyBackupPassword(buffer, password)
      if (ok) {
        // Store passphrase: encrypted with PIN if available, otherwise session-only
        if (pin) {
          await storePassphrase(pin, password)
        } else {
          setSessionPassphrase(password)
        }
        setHasPassword(true)

        // Save the file path
        if (isNative && pendingFileName.startsWith('content://')) {
          await setCloudSyncPath(pendingFileName)
          if (pendingDisplayName) await setCloudSyncDisplayName(pendingDisplayName)
        } else if (isNative) {
          await ensureParentDirs(pendingFileName)
          const base64 = arrayBufferToBase64(buffer)
          await Filesystem.writeFile({
            path: pendingFileName,
            directory: Directory.Documents,
            data: base64,
            encoding: 'base64' as any,
          })
          await setCloudSyncPath(pendingFileName)
        } else {
          await setCloudSyncPath(pendingFileName)
        }
        setSettings(prev => ({ ...prev, filePath: pendingFileName, displayName: pendingDisplayName || prev.displayName }))

        // Clean up pending state
        setPendingFileBuffer(null)
        setPendingFileName(null)
        setPendingDisplayName(null)
        setPassword('')
        setConfirmPassword('')
        setSetupPin('')
        setFileWarning(null)
        setShowAppLock(false)
        setMessage({ type: 'success', text: 'Backup file verified and saved.' })
        await Preferences.remove({ key: 'cloud_sync_pending_verify' })
        loadSettings()
      } else {
        setVerifyError(true)
        setShowAppLock(false)
        setShowPasswordModal(true)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessage({ type: 'error', text: msg })
      setVerifyError(true)
      setShowAppLock(false)
      setShowPasswordModal(true)
      console.error('[CloudSync] verify failed:', err)
    } finally {
      setLoading(false)
      setPendingAction(null)
      setAppLockAction('save-password')
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
    if (!setupPin) {
      setMessage({ type: 'error', text: 'Please enter your app PIN.' })
      return
    }
    if (!pendingFileName) return

    setLoading(true)
    try {
      await storePassphrase(setupPin, password)
      setHasPassword(true)

      // Save the file path and display name
      const displayName = pendingFileName.split(/[\\/]/).pop() || pendingFileName
      if (isNative) {
        await ensureParentDirs(pendingFileName)
        await setCloudSyncPath(pendingFileName)
      } else {
        await setCloudSyncPath(pendingFileName)
      }
      await setCloudSyncDisplayName(displayName)
      setSettings(prev => ({ ...prev, filePath: pendingFileName, displayName }))

      // Create initial backup
      await createInitialBackup(pendingFileName)

      // Clean up
      setPassword('')
      setConfirmPassword('')
      setSetupPin('')
      setShowPasswordModal(false)
      setPendingFileName(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessage({ type: 'error', text: msg })
      console.error('[CloudSync] save new password failed:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleAppLockUnlock = useCallback(() => {
    if (appLockAction === 'verify-file') {
      saveVerifiedFile()
      return
    }
    setShowAppLock(false)
    setPendingAction(null)
    setAppLockAction('save-password')
  }, [appLockAction])

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
    setSetupPin('')
    setVerifyError(false)
    setShowPasswordModal(true)
  }

  const handleAppLockUnlockWithPin = useCallback(async (pin: string) => {
    if (!pendingAction) return
    setLoading(true)
    try {
      if (appLockAction === 'verify-file') {
        // App Lock passed — now verify the backup password and save everything
        await saveVerifiedFile(pin)
        return
      }

      // Unlocking passphrase for sync after app restart
      if (appLockAction === 'unlock-sync') {
        const ok = await unlockPassphrase(pin)
        if (!ok) {
          setMessage({ type: 'error', text: 'Invalid PIN. Could not unlock cloud sync password.' })
          return
        }
        setMessage({ type: 'success', text: 'Cloud sync password unlocked.' })
        if (pendingAction === 'force-pull') {
          await runForcePull()
        } else if (pendingAction === 'manual-sync') {
          await executeManualSync()
        }
        return
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessage({ type: 'error', text: msg })
      console.error('[CloudSync] AppLock unlock failed:', err)
    } finally {
      if (appLockAction !== 'verify-file') {
        setLoading(false)
        setPendingAction(null)
        setShowAppLock(false)
      }
    }
  }, [appLockAction, pendingAction])

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
      setSettings({ enabled: false, filePath: null, displayName: null, lastSyncTimestamp: null, syncMode: 'manual' })
      setHasPassword(false)
      setMessage({ type: 'success', text: 'Cloud sync settings reset. You can re-configure sync at any time.' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }

  // Backup & Restore handlers
  const EyeIcon = ({ open }: { open: boolean }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {open ? (
        <>
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        <>
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7c.78 0 1.53-.09 2.24-.26" />
          <line x1="2" x2="22" y1="2" y2="22" />
        </>
      )}
    </svg>
  )

  const handleExport = async (encrypted: boolean) => {
    setExporting(true)
    setMessage(null)
    try {
      const password = encrypted ? exportPassword : undefined
      if (encrypted && !exportPassword.trim()) {
        setMessage({ type: 'error', text: 'Please enter a password for encrypted export.' })
        setExporting(false)
        return
      }
      if (isNative) {
        const { exportMobileBackup, shareMobileBackup } = await import('../utils/mobileBackup')
        const data = await exportMobileBackup(password)
        const filename = encrypted ? 'budget-backup.budgetbackup' : 'budget-backup.json'
        await shareMobileBackup(data, filename)
        setMessage({ type: 'success', text: `Backup exported successfully${encrypted ? ' (encrypted)' : ' (unencrypted)'}` })
      } else {
        const response = await axios.post(
          'http://localhost:3001/api/backup/export',
          { passphrase: password },
          { responseType: 'blob' }
        )
        const blob = new Blob([response.data])
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = encrypted ? 'budget-backup.budgetbackup' : 'budget-backup.json'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        setMessage({ type: 'success', text: `Backup exported successfully${encrypted ? ' (encrypted)' : ' (unencrypted)'}` })
      }
      setExportPassword('')
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.response?.data?.error || error?.message || 'Export failed' })
    } finally {
      setExporting(false)
    }
  }

  const handleImport = async () => {
    if (!importFile) {
      setMessage({ type: 'error', text: 'Please select a backup file.' })
      return
    }
    setShowConfirm(false)
    setImporting(true)
    setMessage(null)
    try {
      const fileBuffer = await importFile.arrayBuffer()
      if (isNative) {
        const { importMobileBackup } = await import('../utils/mobileBackup')
        const password = importPassword.trim() || undefined
        const result = await importMobileBackup(fileBuffer, password)
        const counts = Object.entries(result.summary)
          .map(([table, count]) => `${table.replace(/_/g, ' ')}: ${count}`)
          .join(', ')
        setMessage({ type: 'success', text: `Restore complete! ${counts}. Refreshing page...` })
      } else {
        const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' }
        if (importPassword.trim()) { headers['X-Backup-Passphrase'] = importPassword }
        const response = await axios.post(
          'http://localhost:3001/api/backup/import',
          fileBuffer,
          { headers }
        )
        const { summary } = response.data
        const counts = Object.entries(summary)
          .map(([table, count]) => `${table.replace(/_/g, ' ')}: ${count}`)
          .join(', ')
        setMessage({ type: 'success', text: `Restore complete! ${counts}. Refreshing page...` })
      }
      setImportFile(null)
      setImportPassword('')
      setTimeout(() => window.location.reload(), 2000)
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.response?.data?.error || error?.message || 'Import failed' })
    } finally {
      setImporting(false)
    }
  }

  const handleReset = async () => {
    setShowResetConfirm(false)
    setResetting(true)
    setMessage(null)
    try {
      if (isNative) {
        const { resetMobileDatabase } = await import('../utils/mobileBackup')
        const result = await resetMobileDatabase()
        setMessage({ type: 'success', text: `${result.message} Refreshing page...` })
      } else {
        const response = await axios.post('http://localhost:3001/api/backup/reset')
        setMessage({ type: 'success', text: `${response.data.message} Refreshing page...` })
      }
      setTimeout(() => window.location.reload(), 2000)
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.response?.data?.error || error?.message || 'Reset failed' })
    } finally {
      setResetting(false)
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

  const showConfirmInModal = true

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
                  {displayFilePath(settings.filePath, settings.displayName)}
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-700">Backup File</p>
                  <p className="text-xs text-gray-500 break-all">{displayFilePath(settings.filePath, settings.displayName)}</p>
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

          {/* Force Pull — always available */}
          {!fileMissing && (
            <div className="space-y-2">
              <button
                onClick={handleForcePull}
                disabled={loading || !canSync}
                className="w-full px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
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

          {/* Export Backup — hidden when auto sync */}
          {settings.syncMode !== 'auto' && (
            <div className="border-t pt-5">
              <h3 className="text-md font-semibold text-gray-800 mb-3">Export Backup</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    Password <span className="text-gray-400">(for encrypted export)</span>
                  </label>
                  <div className="relative w-full max-w-sm">
                    <input
                      type={showExportPassword ? 'text' : 'password'}
                      className="input w-full pr-10"
                      placeholder="Enter a strong password..."
                      value={exportPassword}
                      onChange={(e) => setExportPassword(e.target.value)}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowExportPassword(v => !v)}
                      className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-600"
                      title={showExportPassword ? 'Hide password' : 'Show password'}
                    >
                      <EyeIcon open={showExportPassword} />
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    You will need this password to restore the backup. It is never stored.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleExport(true)}
                    disabled={exporting || !exportPassword.trim()}
                    className="btn-primary text-sm disabled:opacity-50"
                  >
                    {exporting ? 'Exporting...' : 'Export Encrypted Backup'}
                  </button>
                  <button
                    onClick={() => handleExport(false)}
                    disabled={exporting}
                    className="btn-secondary text-sm disabled:opacity-50"
                    title="Exports plain JSON without encryption — for local-only use"
                  >
                    Export Unencrypted
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Restore from Backup — hidden when auto sync */}
          {settings.syncMode !== 'auto' && (
            <div className="border-t pt-5">
              <h3 className="text-md font-semibold text-gray-800 mb-3">Restore from Backup</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Backup File</label>
                  <input
                    type="file"
                    accept=".budgetbackup,.json"
                    className="text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                  />
                </div>
                {importFile && importFile.name.endsWith('.budgetbackup') && (
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">
                      Password <span className="text-gray-400">(used during export)</span>
                    </label>
                    <div className="relative w-full max-w-sm">
                      <input
                        type={showImportPassword ? 'text' : 'password'}
                        className="input w-full pr-10"
                        placeholder="Enter the password used to export..."
                        value={importPassword}
                        onChange={(e) => setImportPassword(e.target.value)}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        onClick={() => setShowImportPassword(v => !v)}
                        className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-600"
                        title={showImportPassword ? 'Hide password' : 'Show password'}
                      >
                        <EyeIcon open={showImportPassword} />
                      </button>
                    </div>
                  </div>
                )}
                <button
                  onClick={() => setShowConfirm(true)}
                  disabled={importing || !importFile}
                  className="text-sm px-4 py-2 rounded font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {importing ? 'Restoring...' : 'Restore Backup'}
                </button>
                <p className="text-xs text-red-500">
                  Warning: Restoring a backup will replace ALL current data. This cannot be undone.
                </p>
              </div>
            </div>
          )}

          {/* Reset All Data — always last */}
          <div className="border-t pt-5">
            <h3 className="text-md font-semibold text-gray-800 mb-3">Reset All Data</h3>
            <div className="bg-red-50 border border-red-200 rounded p-4 space-y-3">
              <p className="text-sm text-red-800">
                This will <span className="font-bold">permanently delete</span> all accounts, budget items, categories, history, rules, and preferences.
                This action <span className="font-bold">cannot be undone</span>.
              </p>
              <p className="text-sm text-red-700">
                We strongly recommend exporting a backup first so you can restore your data if needed.
              </p>
              <button
                onClick={() => setShowResetConfirm(true)}
                disabled={resetting}
                className="text-sm px-4 py-2 rounded font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {resetting ? 'Resetting...' : 'Reset All Data'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Password Modal — context-aware */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-5 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">{getPasswordModalTitle()}</h3>

            {fileWarning && (
              <div className="bg-amber-50 border border-amber-200 rounded-md p-2">
                <p className="text-xs text-amber-700">{fileWarning}</p>
              </div>
            )}

            {passwordModalContext === 'verify-existing' ? (
              <p className="text-sm text-gray-600">
                Enter the password for <span className="font-medium">{pendingDisplayName || displayFilePath(pendingFileName)}</span> to verify ownership.
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

            {passwordModalContext === 'create-new' && (
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-700">App PIN</label>
                <input
                  type="password"
                  placeholder="Enter your app PIN"
                  value={setupPin}
                  onChange={e => setSetupPin(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
                <p className="text-xs text-gray-500">Your app PIN is used to securely store the backup password.</p>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handlePasswordModalPrimary}
                disabled={loading || !password || (showConfirmInModal && !confirmPassword) || (passwordModalContext === 'create-new' && !setupPin)}
                className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {getPasswordModalButtonLabel()}
              </button>
              <button
                onClick={async () => {
                  setShowPasswordModal(false)
                  setPassword('')
                  setConfirmPassword('')
                  setSetupPin('')
                  setVerifyError(false)
                  setFileWarning(null)
                  await Preferences.remove({ key: 'cloud_sync_pending_verify' })
                }}
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
          onCancel={
            appLockAction === 'verify-file'
              ? () => {
                  setShowAppLock(false)
                  setShowPasswordModal(true)
                }
              : undefined
          }
        />
      )}

      {/* Restore Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Confirm Restore</h3>
            <p className="text-sm text-gray-600 mb-4">
              This will <span className="font-bold text-red-600">permanently replace</span> all existing data
              (accounts, transactions, categories, history, rules, and preferences) with the contents of the backup file.
            </p>
            <p className="text-sm text-gray-600 mb-5">
              File: <span className="font-medium">{importFile?.name}</span>
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowConfirm(false)}
                className="btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                className="text-sm px-4 py-2 rounded font-medium bg-red-600 text-white hover:bg-red-700"
              >
                Yes, Replace All Data
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-bold text-red-700 mb-2">Confirm Reset</h3>
            <p className="text-sm text-gray-600 mb-4">
              This will <span className="font-bold text-red-600">permanently delete</span> all data including:
            </p>
            <ul className="text-sm text-gray-600 mb-4 list-disc pl-5 space-y-1">
              <li>All accounts and their balances</li>
              <li>All budget items and categories</li>
              <li>All historical transactions</li>
              <li>All auto-assign rules</li>
              <li>All user preferences</li>
            </ul>
            <p className="text-sm text-red-600 mb-5 font-medium">
              This cannot be undone. Export a backup first if you want to keep your data.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                className="text-sm px-4 py-2 rounded font-medium bg-red-600 text-white hover:bg-red-700"
              >
                Yes, Delete Everything
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
