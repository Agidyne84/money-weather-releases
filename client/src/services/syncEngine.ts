// Cloud Sync Engine
// Manages a single encrypted backup file that acts as the cloud sync target.
// On mobile: reads/writes via Capacitor Filesystem to a user-picked file path.
// On desktop: reads/writes via server API to a user-specified file path.

import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import axios from 'axios'
import {
  exportMobileBackup,
  importMobileBackup,
  base64ToArrayBuffer,
} from '../utils/mobileBackup'
import {
  getSessionPassphrase,
} from './securePassphrase'
import { isDirty, clearDirty } from './dirtyTracker'
import { preferencesApi } from './database'
import CloudFile from '../plugins/CloudFilePlugin'

const API_BASE_URL = 'http://localhost:3001/api'
const isNative = Capacitor.isNativePlatform()

const CLOUD_SYNC_ENABLED_KEY = 'cloud_sync_enabled'
const CLOUD_SYNC_PATH_KEY = 'cloud_sync_path'
const CLOUD_SYNC_DISPLAY_NAME_KEY = 'cloud_sync_display_name'
const CLOUD_SYNC_LAST_SYNC_KEY = 'cloud_sync_last_sync'
const CLOUD_SYNC_FILE_SIZE_KEY = 'cloud_sync_last_file_size'
const CLOUD_SYNC_FILE_HASH_KEY = 'cloud_sync_last_file_hash'
const CLOUD_SYNC_MODE_KEY = 'cloud_sync_mode'

export type CloudSyncMode = 'auto' | 'manual'

export interface CloudSyncSettings {
  enabled: boolean
  filePath: string | null
  displayName: string | null
  lastSyncTimestamp: string | null
  syncMode: CloudSyncMode
}

export interface CloudFileInfo {
  exists: boolean
  modifiedAt: string | null
  size?: number
}

/* ─── Settings persistence ─── */

export async function getCloudSyncSettings(): Promise<CloudSyncSettings> {
  const [enabled, path, displayName, lastSync, mode] = await Promise.all([
    Preferences.get({ key: CLOUD_SYNC_ENABLED_KEY }),
    Preferences.get({ key: CLOUD_SYNC_PATH_KEY }),
    Preferences.get({ key: CLOUD_SYNC_DISPLAY_NAME_KEY }),
    Preferences.get({ key: CLOUD_SYNC_LAST_SYNC_KEY }),
    Preferences.get({ key: CLOUD_SYNC_MODE_KEY }),
  ])
  console.log('[SyncEngine] getCloudSyncSettings lastSync:', lastSync.value)
  return {
    enabled: enabled.value === 'true',
    filePath: path.value || null,
    displayName: displayName.value || null,
    lastSyncTimestamp: lastSync.value || null,
    syncMode: (mode.value as CloudSyncMode) || 'manual',
  }
}

export async function setCloudSyncEnabled(enabled: boolean): Promise<void> {
  await Preferences.set({ key: CLOUD_SYNC_ENABLED_KEY, value: enabled ? 'true' : 'false' })
}

export async function setCloudSyncPath(filePath: string): Promise<void> {
  await Preferences.set({ key: CLOUD_SYNC_PATH_KEY, value: filePath })
}

export async function setCloudSyncDisplayName(displayName: string): Promise<void> {
  await Preferences.set({ key: CLOUD_SYNC_DISPLAY_NAME_KEY, value: displayName })
}

export async function setCloudSyncMode(mode: CloudSyncMode): Promise<void> {
  await Preferences.set({ key: CLOUD_SYNC_MODE_KEY, value: mode })
}

async function computeFileFingerprint(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function getStoredFileFingerprint(): Promise<string | null> {
  const { value } = await Preferences.get({ key: CLOUD_SYNC_FILE_HASH_KEY })
  return value || null
}

export async function setLastSyncTimestamp(timestamp: string, fileSize?: number, fileHash?: string): Promise<void> {
  try {
    await Preferences.set({ key: CLOUD_SYNC_LAST_SYNC_KEY, value: timestamp })
    if (typeof fileSize === 'number') {
      await Preferences.set({ key: CLOUD_SYNC_FILE_SIZE_KEY, value: fileSize.toString() })
    }
    if (fileHash) {
      await Preferences.set({ key: CLOUD_SYNC_FILE_HASH_KEY, value: fileHash })
    }
    console.log('[SyncEngine] setLastSyncTimestamp:', timestamp, 'size:', fileSize, 'hash:', fileHash?.slice(0, 16))
  } catch (e) {
    console.error('[SyncEngine] Failed to set last sync timestamp:', e)
    throw e
  }
}

export async function clearCloudSyncSettings(): Promise<void> {
  await Preferences.remove({ key: CLOUD_SYNC_ENABLED_KEY })
  await Preferences.remove({ key: CLOUD_SYNC_PATH_KEY })
  await Preferences.remove({ key: CLOUD_SYNC_DISPLAY_NAME_KEY })
  await Preferences.remove({ key: CLOUD_SYNC_LAST_SYNC_KEY })
  await Preferences.remove({ key: CLOUD_SYNC_FILE_SIZE_KEY })
  await Preferences.remove({ key: CLOUD_SYNC_FILE_HASH_KEY })
  await Preferences.remove({ key: CLOUD_SYNC_MODE_KEY })
}

/* ─── Desktop helpers ─── */

async function desktopFileInfo(filePath: string): Promise<CloudFileInfo> {
  const response = await axios.post(`${API_BASE_URL}/sync/file-info`, { filePath })
  return response.data
}

async function desktopPull(filePath: string, passphrase?: string): Promise<{ success: boolean; summary: Record<string, number> }> {
  const response = await axios.post(`${API_BASE_URL}/sync/pull`, { filePath, passphrase })
  return response.data
}

async function desktopPush(filePath: string, passphrase?: string): Promise<{ success: boolean; modifiedAt: string; size: number }> {
  const response = await axios.post(`${API_BASE_URL}/sync/push`, { filePath, passphrase })
  return response.data
}

function isContentUri(path: string): boolean {
  return path.startsWith('content://')
}

/* ─── Folder-tree file references ───
 * Some cloud providers (notably OneDrive's Android SAF document provider) do not
 * correctly overwrite a document in place; writing with "wt" (truncate) can leave
 * behind a separate conflicting copy instead of updating the original. To work
 * around this we let the user pick a *folder* (ACTION_OPEN_DOCUMENT_TREE) instead of
 * a single document, and resolve the backup file by name inside that folder on every
 * read/write. Writes delete the existing child document and create a fresh one, which
 * OneDrive handles correctly. The folder + filename pair is encoded into the stored
 * filePath string using the prefix below so the rest of the app can keep treating
 * filePath as an opaque string. */
const TREE_FILE_PREFIX = 'treefile:'

export interface TreeFileRef {
  treeUri: string
  fileName: string
}

export function encodeTreeFileRef(ref: TreeFileRef): string {
  return TREE_FILE_PREFIX + encodeURIComponent(JSON.stringify(ref))
}

function isTreeFilePath(path: string): boolean {
  return path.startsWith(TREE_FILE_PREFIX)
}

function decodeTreeFileRef(path: string): TreeFileRef {
  return JSON.parse(decodeURIComponent(path.slice(TREE_FILE_PREFIX.length)))
}

/* ─── Mobile helpers ─── */

async function mobileFileInfo(filePath: string): Promise<CloudFileInfo> {
  if (isTreeFilePath(filePath)) {
    const ref = decodeTreeFileRef(filePath)
    try {
      const info = await CloudFile.getFileInfoInFolder({ treeUri: ref.treeUri, fileName: ref.fileName })
      return {
        exists: info.exists,
        modifiedAt: info.modifiedAt,
        size: info.size >= 0 ? info.size : undefined,
      }
    } catch {
      return { exists: false, modifiedAt: null }
    }
  }

  if (isContentUri(filePath)) {
    try {
      const info = await CloudFile.getFileInfo({ uri: filePath })
      return {
        exists: info.exists,
        modifiedAt: info.modifiedAt,
        size: info.size >= 0 ? info.size : undefined,
      }
    } catch {
      return { exists: false, modifiedAt: null }
    }
  }

  // Legacy path: Filesystem API
  try {
    const stat = await Filesystem.stat({
      path: filePath,
      directory: Directory.Documents,
    })
    return {
      exists: true,
      modifiedAt: stat.mtime ? new Date(stat.mtime).toISOString() : null,
      size: stat.size,
    }
  } catch {
    return { exists: false, modifiedAt: null }
  }
}

async function mobilePull(filePath: string, passphrase?: string): Promise<{ success: boolean; summary: Record<string, number> }> {
  let base64: string

  if (isTreeFilePath(filePath)) {
    const ref = decodeTreeFileRef(filePath)
    const result = await CloudFile.readFileInFolder({ treeUri: ref.treeUri, fileName: ref.fileName })
    base64 = result.data
  } else if (isContentUri(filePath)) {
    const result = await CloudFile.readFile({ uri: filePath })
    base64 = result.data
  } else {
    const result = await Filesystem.readFile({
      path: filePath,
      directory: Directory.Documents,
      encoding: 'base64' as Encoding,
    })
    base64 = result.data as string
  }

  const buffer = base64ToArrayBuffer(base64)
  return await importMobileBackup(buffer, passphrase)
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

async function mobilePush(filePath: string, passphrase?: string): Promise<{ success: boolean; modifiedAt: string; size: number; hash: string }> {
  const data = await exportMobileBackup(passphrase)
  const base64 = uint8ToBase64(data)
  const hash = await computeFileFingerprint(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)

  // Log the state of the cloud file before we touch it.
  const beforeInfo = await getCloudFileInfo(filePath)
  console.log('[SyncEngine] mobilePush pre-write info:', { filePath, size: beforeInfo.size, exists: beforeInfo.exists, expectedBytes: data.length, expectedHash: hash.slice(0, 16) })

  const doWrite = async (): Promise<{ success: boolean; modifiedAt: string; size: number; hash: string }> => {
    if (isTreeFilePath(filePath)) {
      const ref = decodeTreeFileRef(filePath)
      console.log('[SyncEngine] mobilePush writing tree file:', ref.fileName, 'in folder:', ref.treeUri, 'bytes:', data.length, 'hash:', hash.slice(0, 16))
      const writeResult = await CloudFile.writeFileInFolder({
        treeUri: ref.treeUri,
        fileName: ref.fileName,
        data: base64,
        mimeType: 'application/octet-stream',
      })
      console.log('[SyncEngine] mobilePush tree file write complete, bytesWritten:', writeResult.bytesWritten, 'newUri:', writeResult.uri)
      return {
        success: true,
        modifiedAt: new Date().toISOString(),
        size: data.length,
        hash,
      }
    }

    if (isContentUri(filePath)) {
      console.log('[SyncEngine] mobilePush writing content URI:', filePath, 'bytes:', data.length, 'hash:', hash.slice(0, 16))
      const writeResult = await CloudFile.writeFile({ uri: filePath, data: base64 })
      console.log('[SyncEngine] mobilePush content URI write complete, bytesWritten:', writeResult.bytesWritten)
      return {
        success: true,
        modifiedAt: new Date().toISOString(),
        size: data.length,
        hash,
      }
    }

    // Legacy path
    console.log('[SyncEngine] mobilePush writing legacy file:', filePath, 'bytes:', data.length, 'hash:', hash.slice(0, 16))
    await Filesystem.writeFile({
      path: filePath,
      directory: Directory.Documents,
      data: base64,
      encoding: 'base64' as Encoding,
    })
    const stat = await Filesystem.stat({
      path: filePath,
      directory: Directory.Documents,
    })
    return {
      success: true,
      modifiedAt: stat.mtime ? new Date(stat.mtime).toISOString() : new Date().toISOString(),
      size: stat.size || data.length,
      hash,
    }
  }

  // Write once, then retry only the *verification* (not the write itself) with
  // increasing backoff. If verification never succeeds, surface a real error —
  // field testing showed the underlying write can genuinely fail to reach the
  // real cloud file for some providers even when the local fd.sync() succeeds,
  // so a failed verification must NOT be reported as success.
  const result = await doWrite()

  const VERIFY_DELAYS_MS = [500, 1000, 2000, 4000]
  let lastError = new Error('Cloud backup verification failed')
  for (let attempt = 1; attempt <= VERIFY_DELAYS_MS.length; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, VERIFY_DELAYS_MS[attempt - 1]))

    const afterInfo = await getCloudFileInfo(filePath)
    console.log('[SyncEngine] mobilePush post-write info:', { attempt, filePath, size: afterInfo.size, expected: data.length })
    if (afterInfo.exists && afterInfo.size !== data.length) {
      lastError = new Error(`Cloud backup size mismatch (attempt ${attempt}): wrote ${data.length} bytes but provider reports ${afterInfo.size}`)
      console.warn('[SyncEngine] mobilePush post-write size mismatch (retrying verification):', { attempt, size: afterInfo.size, expected: data.length })
      continue
    }

    const readBackHash = await getCloudFileFingerprint(filePath)
    if (readBackHash === hash) {
      console.log('[SyncEngine] mobilePush verification passed on attempt', attempt)
      return result
    }
    lastError = new Error(`Cloud backup verification failed (attempt ${attempt}): expected hash ${hash.slice(0, 16)}, got ${readBackHash ? readBackHash.slice(0, 16) : 'null'}`)
    console.warn('[SyncEngine] mobilePush verification FAILED on attempt', attempt, lastError.message)
  }

  throw lastError
}

async function getCloudFileFingerprint(filePath: string): Promise<string | null> {
  if (!isNative) return null // Desktop uses file modification time
  try {
    let base64: string
    if (isTreeFilePath(filePath)) {
      const ref = decodeTreeFileRef(filePath)
      const result = await CloudFile.readFileInFolder({ treeUri: ref.treeUri, fileName: ref.fileName })
      base64 = result.data
    } else if (isContentUri(filePath)) {
      const result = await CloudFile.readFile({ uri: filePath })
      base64 = result.data
    } else {
      const result = await Filesystem.readFile({
        path: filePath,
        directory: Directory.Documents,
        encoding: 'base64' as Encoding,
      })
      base64 = result.data as string
    }
    const buffer = base64ToArrayBuffer(base64)
    return await computeFileFingerprint(buffer)
  } catch (err) {
    console.warn('[SyncEngine] Could not fingerprint cloud file:', err)
    return null
  }
}

/* ─── Exclusive execution lock ───
 * Ensures push and pull never run concurrently. A concurrent push (which reads the
 * current DB state to export it) racing against a pull (which closes and reopens the
 * DB connection, then deletes and re-inserts every table) can corrupt or wipe local
 * data, or export a half-imported/empty snapshot that then overwrites a good cloud
 * backup. All sync entry points (auto-sync, force push/pull, pull-to-refresh) funnel
 * through pushCloudBackup/pullCloudBackup below, so locking there covers every path. */
let syncQueue: Promise<unknown> = Promise.resolve()

function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = syncQueue.then(fn, fn)
  syncQueue = run.then(() => undefined, () => undefined)
  return run
}

/* ─── Unified operations ─── */

export async function getCloudFileInfo(filePath: string): Promise<CloudFileInfo> {
  return isNative ? mobileFileInfo(filePath) : desktopFileInfo(filePath)
}

export function pullCloudBackup(filePath: string): Promise<{ success: boolean; summary: Record<string, number> }> {
  return runExclusive(() => pullCloudBackupImpl(filePath))
}

async function pullCloudBackupImpl(filePath: string): Promise<{ success: boolean; summary: Record<string, number> }> {
  const passphrase = getSessionPassphrase() || undefined
  console.log('[SyncEngine] pullCloudBackup:', { filePath, hasPassphrase: !!passphrase, isNative })
  // Capture the cloud file size before reading so we can track it for Content URI change detection
  let fileSize: number | undefined
  try {
    const info = await getCloudFileInfo(filePath)
    if (info.exists && typeof info.size === 'number') {
      fileSize = info.size
    }
  } catch (e) {
    console.warn('[SyncEngine] Could not get file info before pull:', e)
  }
  const result = isNative
    ? await mobilePull(filePath, passphrase)
    : await desktopPull(filePath, passphrase)
  console.log('[SyncEngine] pullCloudBackup result:', result)
  if (result.success) {
    // Fingerprint the file we just read so future checks can detect changes even when size is unchanged.
    const fingerprint = await getCloudFileFingerprint(filePath)
    await setLastSyncTimestamp(new Date().toISOString(), fileSize, fingerprint || undefined)
    clearDirty()
  }
  return result
}

export function pushCloudBackup(filePath: string): Promise<{ success: boolean; modifiedAt: string; size: number; hash?: string }> {
  return runExclusive(() => pushCloudBackupImpl(filePath))
}

async function pushCloudBackupImpl(filePath: string): Promise<{ success: boolean; modifiedAt: string; size: number; hash?: string }> {
  const passphrase = getSessionPassphrase() || undefined
  console.log('[SyncEngine] pushCloudBackup starting:', { filePath, hasPassphrase: !!passphrase, isNative })
  const result = isNative
    ? await mobilePush(filePath, passphrase)
    : await desktopPush(filePath, passphrase)
  console.log('[SyncEngine] pushCloudBackup result:', result)
  if (result.success) {
    // Use the hash returned by the push implementation (computed from the bytes we wrote).
    // Avoids re-reading the file, which can return stale cached content on some providers.
    const fingerprint = (result as any).hash || undefined
    await setLastSyncTimestamp(result.modifiedAt, result.size, fingerprint)
    clearDirty()
  }
  return result
}

/**
 * Check whether the cloud backup file is newer than our last sync.
 * Returns: 'newer' | 'older' | 'same' | 'missing' | 'error'
 */
export async function checkCloudSyncStatus(filePath: string): Promise<'newer' | 'older' | 'same' | 'missing' | 'error'> {
  try {
    const info = await getCloudFileInfo(filePath)
    if (!info.exists) return 'missing'

    const settings = await getCloudSyncSettings()
    const lastSync = settings.lastSyncTimestamp
    if (!lastSync) return 'newer'

    // Content URIs (SAF) do not expose reliable modification time.
    // Fall back to file size comparison, then content fingerprint, then dirty-state heuristic.
    if (!info.modifiedAt) {
      const lastSizeVal = (await Preferences.get({ key: CLOUD_SYNC_FILE_SIZE_KEY })).value
      const lastSize = lastSizeVal ? parseInt(lastSizeVal, 10) : null
      const currentSize = typeof info.size === 'number' ? info.size : null
      if (currentSize !== null && lastSize !== null && currentSize !== lastSize) {
        console.log('[syncEngine] Content URI size changed:', lastSize, '->', currentSize)
        return 'newer'
      }

      // If size is unchanged (or unknown), compare a SHA-256 fingerprint of the file content.
      const lastHash = await getStoredFileFingerprint()
      const currentHash = await getCloudFileFingerprint(filePath)
      if (lastHash && currentHash && lastHash !== currentHash) {
        console.log('[syncEngine] Content URI fingerprint changed')
        return 'newer'
      }

      if (lastSync && !isDirty()) return 'same'
      return isDirty() ? 'older' : 'newer'
    }

    const cloudTime = new Date(info.modifiedAt).getTime()
    const localTime = new Date(lastSync).getTime()

    if (cloudTime > localTime + 2000) return 'newer'   // 2s tolerance
    if (cloudTime < localTime - 2000) return 'older'
    return 'same'
  } catch (err) {
    console.error('[syncEngine] check status failed:', err)
    return 'error'
  }
}

/**
 * Read user_preferences from the database and sync them into localStorage
 * so React components that read from localStorage pick up changes after a pull.
 */
export async function refreshLocalPreferences(): Promise<void> {
  try {
    const prefs = await preferencesApi.getAll()
    if (prefs['forecast_start_date']) {
      localStorage.setItem('forecastStartDate', prefs['forecast_start_date'])
    }
    if (prefs['forecast_visible_accounts']) {
      localStorage.setItem('forecastVisibleAccounts', prefs['forecast_visible_accounts'])
    }
    console.log('[Sync] Refreshed local preferences from database:', Object.keys(prefs))
  } catch (err) {
    console.error('[Sync] Failed to refresh local preferences:', err)
  }
}

/**
 * Perform a full sync: pull if cloud is newer, push if local is dirty.
 * Returns the action taken.
 */
export async function performSync(filePath: string): Promise<{ action: 'pulled' | 'pushed' | 'none' | 'error'; message: string }> {
  try {
    let status = await checkCloudSyncStatus(filePath)

    // If the cloud appears newer but we have local changes, push first. Otherwise a
    // stale/conflict cloud copy can overwrite the changes we just made.
    if (status === 'newer' && isDirty()) {
      console.log('[SyncEngine] Cloud appears newer but local is dirty; pushing local changes first')
      const pushResult = await pushCloudBackup(filePath)
      window.dispatchEvent(new CustomEvent('sync:pushed', { detail: pushResult }))
      // Re-check status after pushing. If the cloud still has a different version, pull it.
      status = await checkCloudSyncStatus(filePath)
      if (status !== 'newer') {
        return {
          action: 'pushed',
          message: `Pushed backup to cloud (${pushResult.size} bytes).`,
        }
      }
    }

    if (status === 'newer') {
      const result = await pullCloudBackup(filePath)
      await refreshLocalPreferences()
      window.dispatchEvent(new CustomEvent('sync:pulled', { detail: result }))
      return {
        action: 'pulled',
        message: `Pulled ${result.summary.accounts} accounts, ${result.summary.transactions} transactions from cloud.`,
      }
    }

    // If local is dirty or cloud is older/missing, push
    if (status === 'older' || status === 'missing' || isDirty()) {
      const result = await pushCloudBackup(filePath)
      window.dispatchEvent(new CustomEvent('sync:pushed', { detail: result }))
      return {
        action: 'pushed',
        message: `Pushed backup to cloud (${result.size} bytes).`,
      }
    }

    if (status === 'error' && isDirty()) {
      console.warn('[SyncEngine] performSync status error but local is dirty; attempting push')
      const result = await pushCloudBackup(filePath)
      window.dispatchEvent(new CustomEvent('sync:pushed', { detail: result }))
      return {
        action: 'pushed',
        message: `Pushed backup to cloud (${result.size} bytes).`,
      }
    }

    return { action: 'none', message: 'Cloud backup is already up to date.' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { action: 'error', message: msg }
  }
}
