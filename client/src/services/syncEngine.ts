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

export async function setLastSyncTimestamp(timestamp: string): Promise<void> {
  try {
    await Preferences.set({ key: CLOUD_SYNC_LAST_SYNC_KEY, value: timestamp })
    console.log('[SyncEngine] setLastSyncTimestamp:', timestamp)
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

/* ─── Mobile helpers ─── */

async function mobileFileInfo(filePath: string): Promise<CloudFileInfo> {
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

  if (isContentUri(filePath)) {
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

async function mobilePush(filePath: string, passphrase?: string): Promise<{ success: boolean; modifiedAt: string; size: number }> {
  const data = await exportMobileBackup(passphrase)
  const base64 = uint8ToBase64(data)

  if (isContentUri(filePath)) {
    await CloudFile.writeFile({ uri: filePath, data: base64 })
    return {
      success: true,
      modifiedAt: new Date().toISOString(),
      size: data.length,
    }
  }

  // Legacy path
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
  }
}

/* ─── Unified operations ─── */

export async function getCloudFileInfo(filePath: string): Promise<CloudFileInfo> {
  return isNative ? mobileFileInfo(filePath) : desktopFileInfo(filePath)
}

export async function pullCloudBackup(filePath: string): Promise<{ success: boolean; summary: Record<string, number> }> {
  const passphrase = getSessionPassphrase() || undefined
  const result = isNative
    ? await mobilePull(filePath, passphrase)
    : await desktopPull(filePath, passphrase)
  if (result.success) {
    await setLastSyncTimestamp(new Date().toISOString())
    clearDirty()
  }
  return result
}

export async function pushCloudBackup(filePath: string): Promise<{ success: boolean; modifiedAt: string; size: number }> {
  const passphrase = getSessionPassphrase() || undefined
  const result = isNative
    ? await mobilePush(filePath, passphrase)
    : await desktopPush(filePath, passphrase)
  if (result.success) {
    await setLastSyncTimestamp(result.modifiedAt)
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
    // Fall back to dirty-state heuristic: if local is dirty, push; otherwise pull.
    if (!info.modifiedAt) {
      // Content URIs (SAF) don't expose reliable modification time.
      // If we've synced before and nothing changed locally since, assume up to date.
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
    const status = await checkCloudSyncStatus(filePath)

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

    return { action: 'none', message: 'Cloud backup is already up to date.' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { action: 'error', message: msg }
  }
}
